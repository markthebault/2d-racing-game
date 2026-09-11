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
const source=launch();let checkpoint;
try{
  source.worker.postMessage({type:'init',track:0,checkpoint:null,preset:'local',seed:42});
  await source.wait(()=>source.latest?.status==='ready');source.worker.postMessage({type:'speed',speed:0});source.worker.postMessage({type:'train'});
  await source.wait(()=>source.messages.some(m=>m.type==='checkpoint'));
  await source.wait(()=>source.latest.steps>=320);
  source.worker.postMessage({type:'pause'});await source.wait(()=>source.latest.status==='paused');
  const frozen=source.latest.steps,updates=source.latest.updates;
  checkpoint=source.messages.filter(m=>m.type==='checkpoint').at(-1).checkpoint;
  assert.equal(checkpoint.evaluation.runs.length,5);assert.equal(checkpoint.evaluation.track,0);
  await new Promise(r=>setTimeout(r,200));assert.equal(source.latest.steps,frozen);
  const frameCount=source.messages.filter(m=>m.type==='frame').length;
  source.worker.postMessage({type:'play'});await source.wait(()=>source.latest.status==='playing');
  await source.wait(()=>source.messages.filter(m=>m.type==='frame').length>frameCount+2);
  await source.wait(()=>source.latest.steps>frozen&&source.latest.updates>updates);
  assert.equal(source.latest.backgroundLearning,true);
  const {DQNAgent,initializeTensorflow}=await import('../lib/rl/agent.ts');
  const {DrivingEnvironment}=await import('../lib/rl/environment.ts');
  await initializeTensorflow();const snapshot=new DQNAgent(42);snapshot.loadWeights(checkpoint.weights);
  const expected=new DrivingEnvironment(0,'local',true);
  try{for(const m of source.messages.filter(m=>m.type==='frame').slice(frameCount)){
    if(m.frame.time>0)expected.step(snapshot.act(expected.observe()));
    assert.equal(m.frame.action,expected.frame().action);assert.ok(Math.abs(m.frame.x-expected.state.x)<1e-7);assert.ok(Math.abs(m.frame.z-expected.state.z)<1e-7);
  }}finally{snapshot.dispose();}
  source.worker.postMessage({type:'pause'});await source.wait(()=>source.latest.status==='paused');
  source.worker.postMessage({type:'train'});await source.wait(()=>source.latest.steps>frozen);
  await source.wait(()=>source.messages.some(m=>m.type==='fleet'&&m.frame?.poses.length===50));
  const duringBatch=source.latest.steps;
  await source.wait(()=>source.latest.status==='replaying'&&source.latest.steps>duringBatch+12);
  source.worker.postMessage({type:'pause'});await source.wait(()=>source.latest.status==='paused');
  assert.ok(source.latest.episode>=50);assert.ok(source.latest.batchCount<50);assert.equal(source.latest.pausedActivity,'batch');
  assert.equal(source.messages.filter(m=>m.type==='frame').length>0,true);
  const beforeBatch=source.latest.steps, fleetCount=source.messages.filter(m=>m.type==='fleet'&&m.frame).length;
  await new Promise(r=>setTimeout(r,150));assert.equal(source.latest.steps,beforeBatch);
  assert.equal(source.messages.filter(m=>m.type==='fleet'&&m.frame).length,fleetCount);
  source.worker.postMessage({type:'resume'});await source.wait(()=>source.latest.status==='replaying');
  source.worker.postMessage({type:'skip-replay'});await source.wait(()=>source.latest.episode>=51&&source.latest.status!=='replaying');
  source.worker.postMessage({type:'pause'});await source.wait(()=>source.latest.status==='paused');
  const transferSteps=source.latest.steps, transferUpdates=source.latest.updates, transferReplay=source.latest.replaySize, transferEpisode=source.latest.episode;
  source.worker.postMessage({type:'track',track:1});await source.wait(()=>source.latest.track===1&&source.latest.status==='ready');
  assert.equal(source.latest.steps,transferSteps);assert.equal(source.latest.updates,transferUpdates);assert.equal(source.latest.replaySize,transferReplay);assert.equal(source.latest.episode,transferEpisode);assert.equal(source.latest.batchCount,0);
  source.worker.postMessage({type:'train'});await source.wait(()=>source.latest.steps>transferSteps);
  assert.deepEqual(source.latest.trainedTracks,[0,1]);
  source.worker.postMessage({type:'track',track:2});await source.wait(()=>source.latest.track===2&&source.latest.trainedTracks.includes(2));
  assert.deepEqual(source.latest.trainedTracks,[0,1,2]);
  source.worker.postMessage({type:'pause'});await source.wait(()=>source.latest.status==='paused');
  const oldSteps=source.latest.steps, oldMemory=source.latest.replaySize;
  source.worker.postMessage({type:'track',track:2,laps:3});await source.wait(()=>source.latest.targetLaps===3&&source.latest.status==='ready');
  assert.equal(source.latest.steps,oldSteps);assert.equal(source.latest.replaySize,oldMemory);
  assert.equal(source.latest.checkpointCount,8);assert.equal(source.latest.best.evaluation.targetLaps,3);
  source.worker.postMessage({type:'play'});await source.wait(()=>source.latest.status==='playing');
  await source.wait(()=>source.messages.some(m=>m.type==='frame'&&m.frame.targetLaps===3));


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
// A fixed coast policy makes playback termination independent of training quality.
const idle=launch();
try {
  const weights=checkpoint.weights.map(w=>({shape:[...w.shape],values:w.values.map(()=>0)}));weights.at(-1).values[4]=1;
  idle.worker.postMessage({type:'init',track:0,checkpoint:{...checkpoint,weights}});
  await idle.wait(()=>idle.latest?.status==='ready');
  idle.worker.postMessage({type:'speed',speed:0});idle.worker.postMessage({type:'play'});
  await idle.wait(()=>idle.latest.lastPlayback!==null);
  assert.equal(idle.latest.lastPlayback.reason,'No forward progress');assert.equal(idle.latest.backgroundLearning,true);
  const steps=idle.latest.steps;await idle.wait(()=>idle.latest.steps>steps);
}finally{await idle.worker.terminate();}
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
console.log('Bundled worker passed: HTTP URL, concurrent training/playback, frozen-policy predictions, pause/resume, persistent playback results, 50-car replay and skipping, live learner retention across all tracks, five-start evaluation, immutable saved-model transfers, fine-tuning, and 12 independent comparison runs.');
