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
    while(!predicate()) { const failure=messages.find(m=>m.type==='error');if(failure)throw new Error(failure.message);if(Date.now()>deadline)throw new Error('Worker timed out');await new Promise(r=>setTimeout(r,20)); }
  }};
}
const source=launch();let checkpoint;
try{
  source.worker.postMessage({type:'init',track:0,checkpoint:null,preset:'local',seed:42});
  await source.wait(()=>source.latest?.status==='ready');source.worker.postMessage({type:'speed',speed:0});source.worker.postMessage({type:'train'});
  await source.wait(()=>source.messages.some(m=>m.type==='checkpoint'));
  source.worker.postMessage({type:'pause'});await source.wait(()=>source.latest.status==='paused');
  const frozen=source.latest.steps,updates=source.latest.updates;
  checkpoint=source.messages.find(m=>m.type==='checkpoint').checkpoint;
  assert.equal(checkpoint.evaluation.runs.length,5);assert.equal(checkpoint.evaluation.track,0);
  await new Promise(r=>setTimeout(r,200));assert.equal(source.latest.steps,frozen);
  const frameCount=source.messages.filter(m=>m.type==='frame').length;
  source.worker.postMessage({type:'play'});await source.wait(()=>source.latest.status==='playing');
  await source.wait(()=>source.messages.filter(m=>m.type==='frame').length>frameCount+2);
  assert.equal(source.latest.steps,frozen);assert.equal(source.latest.updates,updates);
  source.worker.postMessage({type:'pause'});await source.wait(()=>source.latest.status==='paused');
  source.worker.postMessage({type:'train'});await source.wait(()=>source.latest.steps>frozen);
}finally{await source.worker.terminate();}
for(const track of [1,2]) {
  const target=launch(),original=JSON.stringify(checkpoint);
  try{
    target.worker.postMessage({type:'init',track,checkpoint});
    await target.wait(()=>target.messages.some(m=>m.type==='checkpoint'));
    const transferred=target.messages.find(m=>m.type==='checkpoint').checkpoint;
    assert.equal(transferred.evaluation.track,track);assert.equal(transferred.parentId,checkpoint.id);
    assert.notEqual(transferred.id,checkpoint.id);assert.deepEqual(transferred.weights,checkpoint.weights);
    assert.deepEqual(transferred.trainedTracks,[0]);
    assert.ok(target.messages.some(m=>m.type==='stats'&&m.stats.best&&m.stats.best.evaluation===null),'Source score must be cleared before target evaluation');
    assert.equal(target.latest.steps,0);assert.equal(target.latest.updates,0);assert.equal(JSON.stringify(checkpoint),original);
    target.worker.postMessage({type:'play'});await target.wait(()=>target.latest.status==='playing');
    target.worker.postMessage({type:'pause'});await target.wait(()=>target.latest.status==='paused');
    target.worker.postMessage({type:'speed',speed:0});target.worker.postMessage({type:'train'});await target.wait(()=>target.latest.steps>0);
    assert.equal(JSON.stringify(checkpoint),original);
  }finally{await target.worker.terminate();}
}
const comparison=launch();
try{
  comparison.worker.postMessage({type:'init',track:0,checkpoint:null});await comparison.wait(()=>comparison.latest?.status==='ready');
  comparison.worker.postMessage({type:'speed',speed:0});comparison.worker.postMessage({type:'compare',episodes:1});
  await comparison.wait(()=>comparison.messages.some(m=>m.type==='report'&&m.report.complete));
  const report=comparison.messages.find(m=>m.type==='report'&&m.report.complete).report;
  assert.equal(report.rows.length,12);assert.equal(new Set(report.rows.map(r=>`${r.preset}:${r.seed}`)).size,12);
  for(const row of report.rows){assert.equal(row.episodes,1);assert.equal(row.evaluation.runs.length,5);assert.equal(row.evaluation.track,0);}
  assert.equal(new Set(report.rows.map(r=>r.modelId)).size,12);
}finally{await comparison.worker.terminate();}
console.log('Bundled worker passed: HTTP URL, train/pause/play/resume, five-start evaluation, immutable transfers to both other tracks, fine-tuning, and 12 independent comparison runs.');
