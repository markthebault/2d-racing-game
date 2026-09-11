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
    const deadline=Date.now()+90000;
    while(!predicate()) { const failure=messages.find(m=>m.type==='error');if(failure)throw new Error(failure.message);if(Date.now()>deadline)throw new Error('Worker timed out: '+JSON.stringify({episode:latest?.episode,status:latest?.status,steps:latest?.steps,paused:latest?.pausedActivity}));await new Promise(r=>setTimeout(r,20)); }
  }};
}
const run=launch();
try {
  const weights=[{shape:[36,64],values:Array(36*64).fill(0)},{shape:[64],values:Array(64).fill(0)},{shape:[64,64],values:Array(64*64).fill(0)},{shape:[64],values:Array(64).fill(0)},{shape:[64,9],values:Array(64*9).fill(0)},{shape:[9],values:Array(9).fill(0)}];weights.at(-1).values[4]=1;
  const saved={version:2,observationVersion:3,id:'old-1700',track:0,preset:'local',seed:42,episode:1700,trainedTracks:[0,1,2],parentId:null,evaluation:null,weights};const original=JSON.stringify(saved);
  run.worker.postMessage({type:'init',track:0,trainingTracks:[0,1,2],variedStarts:true,checkpoint:saved});
  await run.wait(()=>run.latest?.status==='ready'&&run.latest.best?.evaluations?.length===3);
  assert.equal(run.latest.best.observationVersion,4);
  const migrated=run.messages.filter(m=>m.type==='checkpoint').at(-1).checkpoint;assert.equal(migrated.weights[0].shape[0],52);
  run.worker.postMessage({type:'upgrade'});await run.wait(()=>run.latest.status==='ready'&&run.latest.preset==='adaptive'&&run.latest.best.evaluations.length===3);
  const before=JSON.stringify(run.latest.best);assert.ok(run.latest.evaluations.every(result=>result.runs.every(r=>r.score<-250)));
  run.worker.postMessage({type:'validate'});await run.wait(()=>run.latest.status==='ready'&&run.latest.validation?.results.length===5);
  assert.equal(run.latest.steps,0);assert.equal(run.latest.replaySize,0);assert.equal(JSON.stringify(run.latest.best),before);assert.equal(run.latest.best.evaluations.length,3);
  assert.equal(JSON.stringify(saved),original);assert.ok(run.latest.validation.results.every(r=>r.runs.every(s=>Number.isFinite(s.terminalSpeed))));
  run.worker.postMessage({type:'speed',speed:0});run.worker.postMessage({type:'train'});await run.wait(()=>run.latest.updates>2);
  run.worker.postMessage({type:'pause'});await run.wait(()=>run.latest.status==='paused');const steps=run.latest.steps,updates=run.latest.updates;
  run.worker.postMessage({type:'validate'});await run.wait(()=>run.latest.status==='ready');assert.equal(run.latest.steps,steps);assert.equal(run.latest.updates,updates);
  console.log('PASS: legacy migration, reward upgrade, train-only best selection, read-only held-out evaluation, finite terminal diagnostics and live gradient updates.');
}finally{await run.worker.terminate();}
