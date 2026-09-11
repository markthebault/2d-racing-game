import test from 'node:test';
import assert from 'node:assert/strict';
import * as tf from '@tensorflow/tfjs';
import {DQNAgent,initializeTensorflow} from '../lib/rl/agent.ts';
import {DrivingEnvironment,OBSERVATION_SIZE} from '../lib/rl/environment.ts';
import {migrateModel} from '../lib/rl/models.ts';
await initializeTensorflow();
test('three-step returns propagate failure backwards and flush without crossing episodes',()=>{
 const agent=new DQNAgent(42,true),state=new DrivingEnvironment(0).observe();
 try{
  const push=(reward,done,track=0)=>agent.remember({track,state,action:1,reward,next:state,done});
  push(1,false);push(2,false);assert.equal(agent.replay.length,0);push(-250,true);
  assert.equal(agent.replay.length,3);assert.ok(Math.abs(agent.replay[0].reward-(1+.995*2-.995**2*250))<1e-9);assert.ok(agent.replay.every(r=>r.done));
  push(7,false);agent.discardPending();push(9,true);assert.equal(agent.replay.at(-1).reward,9);
  push(11,false,0);push(13,true,1);assert.equal(agent.replay.at(-1).reward,13);
 }finally{agent.dispose();}
});
test('road preview warns about tight corners while keeping observations finite',()=>{
 const env=new DrivingEnvironment(2,'adaptive');let slow=40,fast=0;
 for(let i=0;i<60;i++){env.reset({fraction:i/60,offset:0,heading:0});const context=env.roadContext();slow=Math.min(slow,context.safeSpeed);fast=Math.max(fast,context.safeSpeed);assert.equal(env.observe().length,52);assert.ok(env.observe().every(Number.isFinite));}
 assert.ok(slow<10);assert.ok(fast>25);
});
test('new reward penalizes unsafe speed and never rewards idling',()=>{
 const safe=new DrivingEnvironment(2,'adaptive'),fast=new DrivingEnvironment(2,'adaptive');
 for(let i=0;i<60;i++){safe.reset({fraction:i/60,offset:0,heading:0});if(safe.roadContext().safeSpeed<10){fast.reset({fraction:i/60,offset:0,heading:0});break;}}
 safe.state.speed=7;fast.state.speed=35;safe.step(4);fast.step(4);assert.ok(fast.reward.safety<safe.reward.safety-1);
 const idle=new DrivingEnvironment(0,'adaptive');while(!idle.done)idle.step(4);assert.ok(idle.score<0);assert.equal(idle.reward.failure,-250);
});
test('36-input models preserve predictions and invalidate old evaluation scores',()=>{
 const agent=new DQNAgent(12);
 try{
  const weights=agent.exportWeights();weights[0]={shape:[36,64],values:weights[0].values.slice(0,36*64)};
  const saved={version:2,observationVersion:3,id:'previous',track:0,preset:'local',seed:12,episode:1700,trainedTracks:[0,1,2],parentId:null,evaluation:{version:3},evaluations:[{version:3}],weights};
  const original=JSON.stringify(saved),model=migrateModel(saved);agent.loadWeights(model.weights);assert.equal(model.evaluation,null);assert.deepEqual(model.evaluations,[]);assert.equal(model.weights[0].shape[0],OBSERVATION_SIZE);
  const state=new DrivingEnvironment(2,'local').observe();
  const expected=tf.tidy(()=>{let x=tf.tensor2d([state.slice(0,36)]);for(let i=0;i<3;i++){x=x.matMul(tf.tensor(weights[i*2].values,weights[i*2].shape)).add(tf.tensor(weights[i*2+1].values,weights[i*2+1].shape));if(i<2)x=x.relu();}return Array.from(x.dataSync());});
  const actual=tf.tidy(()=>Array.from(agent.online.predict(tf.tensor2d([state])).dataSync()));actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-6));assert.equal(JSON.stringify(saved),original);
 }finally{agent.dispose();}
});
test('legal inside-corner travel is not rejected by the old two-times projection limit',()=>{
 const env=new DrivingEnvironment(1,'adaptive');
 const index=env.curvatures.findIndex((k,i)=>i>5&&Math.abs(k)>.12&&Math.abs(k)<.13&&Math.abs(env.curvatures[i+2])>.12);
 assert.ok(index>0);env.reset({fraction:env.cumulative[index]/env.length,offset:Math.sign(env.curvatures[index])*4.6,heading:0});
 const arc=env.project().arc;env.state.speed=7;env.step(4);
 let delta=env.project().arc-arc;if(delta<0)delta+=env.length;
 assert.ok(delta>1,'centerline distance really exceeds the physical travel');
 assert.ok(Math.abs(env.distance-delta)<1e-8,'all legal progress remains eligible for checkpoints');
});
test('a missed checkpoint cannot show a completed race on the progress meter',()=>{
 const env=new DrivingEnvironment(0);env.furthest=env.length*4;assert.ok(env.frame().progress<1);
});
