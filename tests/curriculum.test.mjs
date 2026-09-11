import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingStart, validateTrainingTracks } from '../lib/rl/curriculum.ts';
import { DQNAgent, initializeTensorflow, seededRandom } from '../lib/rl/agent.ts';
import { DrivingEnvironment } from '../lib/rl/environment.ts';
import { betterAcrossTracks, EvaluationSuite } from '../lib/rl/evaluation.ts';
import { sampleBatch } from '../lib/rl/batch.ts';
import { migrateModel } from '../lib/rl/models.ts';

test('three distinct tracks required and all five tracks are supported',()=>{
 assert.deepEqual(validateTrainingTracks([4,0,3]),[0,3,4]);
 for(const tracks of [[],[0,1],[0,0,1],[0,1,5],[0,1,2,3],[0,1,NaN]])assert.throws(()=>validateTrainingTracks(tracks));
});
test('practice starts are reproducible, alternate with the grid and spawn safely on every circuit',()=>{
 const a=seededRandom(15),b=seededRandom(15),fractions=[];
 for(let attempt=0;attempt<20;attempt++){
  const start=trainingStart(attempt,true,a);assert.deepEqual(start,trainingStart(attempt,true,b));
  if(attempt%2===0)assert.deepEqual(start,{fraction:0,offset:0,heading:0});else fractions.push(start.fraction);
  for(let track=0;track<5;track++){
   const env=new DrivingEnvironment(track);env.reset(start);assert.ok(env.project().distance<env.halfWidth);assert.equal(env.distance,0);assert.equal(env.frame().checkpoints,0);
  }
 }
 assert.ok(new Set(fractions).size===10);assert.deepEqual(trainingStart(1,false,a),{fraction:0,offset:0,heading:0});
});
test('per-track memory reserves capacity and changing the set retains weights and shared experience',async()=>{
 await initializeTensorflow();const agent=new DQNAgent(1);
 try{
  agent.setTrainingTracks([0,3,4]);const observation=new DrivingEnvironment(0).observe();
  const experience=track=>({track,state:observation,next:observation,action:1,reward:1,done:false});
  for(const track of [0,3,4])for(let i=0;i<7000;i++)agent.remember(experience(track));
  assert.deepEqual(agent.replayCounts.map(r=>r.count),[6666,6666,6666]);assert.equal(agent.replay.length,19998);
  for(let i=0;i<1000;i++)agent.remember(experience(4));assert.equal(agent.replayCounts[0].count,6666);
  const weights=agent.exportWeights(),steps=agent.steps;agent.setTrainingTracks([0,1,4]);
  assert.deepEqual(agent.exportWeights(),weights);assert.equal(agent.steps,steps);assert.equal(agent.replayCounts[1].count,0);assert.ok(agent.replay.every(r=>r.track!==3));
  do { agent.remember(experience(1)); } while(agent.steps%4);assert.ok(Number.isFinite(agent.train()));
  const saved={version:2,observationVersion:4,id:'five-track',track:4,preset:'local',seed:1,episode:1,trainedTracks:[0,3,4],parentId:null,evaluation:null,weights};assert.equal(migrateModel(saved).track,4);
 }finally{agent.dispose();}
});
test('shared evaluation rejects mismatched sets and ranks across all selected tracks',()=>{
 const result=(track,successRate,meanScore)=>({track,version:3,targetLaps:1,minDistance:1,successRate,meanScore,runs:[],meanProgress:0,meanOffroadTime:0,meanLapTime:null});
 const old=[result(0,1,1000),result(3,1,1000),result(4,0,0)];
 assert.equal(betterAcrossTracks([result(0,0,0),result(3,0,0),result(4,1,9999)],old),false);
 assert.equal(betterAcrossTracks([result(0,.8,800),result(3,.8,800),result(4,.8,800)],old),true);
 assert.throws(()=>betterAcrossTracks([result(1,1,1000),...old.slice(1)],old));
 for(let track=0;track<5;track++){const suite=new EvaluationSuite(track,'local');while(!suite.done)suite.step(()=>4);assert.equal(suite.summary().runs.length,5);}
});
test('mixed-track replays never project another circuit cars onto the viewed circuit',()=>{
 const runs=[0,3,4].map((track,i)=>({track,episode:i+1,completed:false,poses:[{x:track,z:0,heading:0,time:0},{x:track+1,z:0,heading:0,time:1}]}));
 for(const track of [0,3,4]){const frame=sampleBatch(runs,0,track);assert.equal(frame.poses.length,1);assert.equal(frame.poses[0].x,track);assert.equal(frame.first,1);assert.equal(frame.last,3);}
 assert.equal(sampleBatch(runs,0,2).poses.length,0);
});
