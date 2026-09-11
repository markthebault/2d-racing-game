import { Worker } from 'node:worker_threads';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const folder = resolve('dist/client/_next/static');
const file = (await readdir(folder)).find(name => /^training\.worker-.*\.js$/.test(name));
assert.ok(file, 'Training worker must be included in the build');
const chunks = await readdir(resolve(folder, 'chunks'));
const page = (await Promise.all(chunks.filter(name => /^page-.*\.js$/.test(name)).map(name => readFile(resolve(folder, 'chunks', name), 'utf8')))).join('\n');
const constructor = page.match(/new Worker\(new URL\([^)]*\)/)?.[0];
assert.ok(constructor?.includes('window.location.href'), 'Resolve the worker against the HTTP page, not a build-time file URL');
assert.ok(!constructor.includes('file:')); assert.ok(page.includes(file));
const script = `import {parentPort} from 'node:worker_threads'; globalThis.self=globalThis; globalThis.process=undefined; globalThis.WorkerGlobalScope=class {}; globalThis.postMessage=(message)=>parentPort.postMessage(message); await import(${JSON.stringify(pathToFileURL(resolve(folder, file)).href)}); parentPort.on('message',data=>globalThis.onmessage({data}));`;
function launch() {
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(script)), { type: 'module' });
  const messages = []; let latest;
  worker.on('error', error => messages.push({ type: 'error', message: error.message }));
  worker.on('message', m => { messages.push(m); if (m.type === 'stats') latest = m.stats; });
  return { worker, messages, get latest(){return latest;}, async wait(predicate) {
    const deadline=Date.now()+600000;
    while(!predicate()) { const failure=messages.find(m=>m.type==='error');if(failure)throw new Error(failure.message);if(Date.now()>deadline)throw new Error('Worker timed out: '+JSON.stringify({episode:latest?.episode,status:latest?.status,steps:latest?.steps,paused:latest?.pausedActivity}));await new Promise(r=>setTimeout(r,20)); }
  }};
}
const run=launch();
try {
 run.worker.postMessage({type:'init',coach:true,track:0,trainingTracks:[0,1,2],variedStarts:true,preset:'local',seed:42,laps:3});await run.wait(()=>run.latest?.status==='ready');
 run.worker.postMessage({type:'speed',speed:0});run.worker.postMessage({type:'train'});await run.wait(()=>run.latest.status==='coaching');
 run.worker.postMessage({type:'pause'});await run.wait(()=>run.latest.status==='paused');const count=run.latest.coachUpdates;await new Promise(r=>setTimeout(r,200));assert.equal(run.latest.coachUpdates,count);
 run.worker.postMessage({type:'resume'});await run.wait(()=>run.latest.coachUpdates===4000&&run.latest.best&&run.latest.updates>2);
 assert.equal(run.latest.best.guided,true);assert.deepEqual(run.latest.best.trainedTracks,[0,1,2]);assert.ok(run.latest.best.evaluations.every(r=>r.successRate===1));
 run.worker.postMessage({type:'pause'});await run.wait(()=>run.latest.status==='paused');const steps=run.latest.steps;
 run.worker.postMessage({type:'play'});await run.wait(()=>run.latest.status==='playing'&&run.latest.steps>steps);assert.equal(run.latest.backgroundLearning,true);
 console.log('PASS: final bundled guided learner, pause/resume, 15/15 three-lap evaluations, guided model provenance and independent background RL during playback.');
}finally{await run.worker.terminate();}
