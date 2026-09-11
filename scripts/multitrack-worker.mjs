import { Worker } from 'node:worker_threads';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const folder=resolve('dist/client/_next/static');
const file=(await readdir(folder)).find(n=>/^training\.worker-.*\.js$/.test(n));
const script=`import {parentPort} from 'node:worker_threads';globalThis.self=globalThis;globalThis.process=undefined;globalThis.WorkerGlobalScope=class{};globalThis.postMessage=m=>parentPort.postMessage(m);await import(${JSON.stringify(pathToFileURL(resolve(folder,file)).href)});parentPort.on('message',data=>globalThis.onmessage({data}));`;
const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(script)),{type:'module'});
let stats,error;const messages=[];
worker.on('error',e=>error=e);worker.on('message',m=>{messages.push(m);if(m.type==='stats')stats=m.stats;if(m.type==='error')error=new Error(m.message);});
const send=m=>worker.postMessage(m);
async function wait(predicate){const deadline=Date.now()+180000;while(!predicate()){if(error)throw error;if(Date.now()>deadline)throw new Error('Timed out '+JSON.stringify(stats));await new Promise(r=>setTimeout(r,20));}}
try{
 send({type:'init',track:0,trainingTracks:[0,3,4],variedStarts:true,checkpoint:null,laps:1});await wait(()=>stats?.status==='ready');
 send({type:'speed',speed:0});send({type:'train'});await wait(()=>stats.episode>=60&&stats.evaluations.length===3);
 send({type:'pause'});await wait(()=>stats.status==='paused');
 const history=stats.history.slice(0,60), counts=[0,3,4].map(t=>history.filter(r=>r.track===t).length);
 assert.deepEqual(counts,[20,20,20]);assert.deepEqual(stats.trainingTracks,[0,3,4]);assert.equal(stats.track,0);
 for(const track of [0,3,4]){const rows=history.filter(r=>r.track===track);assert.equal(rows.filter(r=>r.startFraction===0).length,10);assert.equal(rows.filter(r=>r.startFraction>0).length,10);}
 assert.ok(stats.replayCounts.every(r=>r.count>0));assert.ok(stats.updates>0);assert.ok(Number.isFinite(stats.loss));
 assert.deepEqual(stats.evaluations.map(r=>r.track),[0,3,4]);assert.ok(stats.best.evaluations.length===3);
 const fleets=messages.filter(m=>m.type==='fleet'&&m.frame);assert.ok(fleets.some(m=>m.frame.first===1&&m.frame.last===50&&m.frame.poses.length===17));
 const frozen={steps:stats.steps,episode:stats.episode,replay:stats.replaySize,trainingTrack:stats.trainingTrack,startFraction:stats.startFraction};
 send({type:'track',track:3});await wait(()=>stats.track===3);
 assert.equal(stats.status,'paused');assert.equal(stats.steps,frozen.steps);assert.equal(stats.episode,frozen.episode);assert.equal(stats.replaySize,frozen.replay);assert.equal(stats.trainingTrack,frozen.trainingTrack);assert.equal(stats.startFraction,frozen.startFraction);
 send({type:'track',track:2});await wait(()=>stats.track===2);assert.deepEqual(stats.trainingTracks,[0,3,4]);assert.equal(stats.evaluation,null);
 send({type:'play'});await wait(()=>messages.some(m=>m.type==='frame'&&m.track===2));await wait(()=>stats.steps>frozen.steps);assert.ok(stats.backgroundLearning);
 send({type:'pause'});await wait(()=>stats.status==='paused');const before=stats.steps;
 send({type:'plan',tracks:[1,3,4],variedStarts:true});await wait(()=>stats.status==='ready'&&stats.evaluations.every(r=>[1,3,4].includes(r.track))&&stats.evaluations.length===3);
 assert.deepEqual(stats.trainingTracks,[1,3,4]);assert.equal(stats.steps,before);assert.ok(stats.replayCounts.find(r=>r.track===3).count>0);assert.equal(stats.replayCounts.find(r=>r.track===1).count,0);
 console.log(JSON.stringify({result:'PASS',episodes:history.length,episodesPerTrack:counts,gridStarts:30,variedStarts:30,updates:stats.updates,evaluation:stats.evaluations.map(r=>({track:r.track,completion:r.successRate,progress:r.meanProgress}))}));
}finally{await worker.terminate();}
