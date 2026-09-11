import test from 'node:test';
import assert from 'node:assert/strict';
import { DrivingEnvironment } from '../lib/rl/environment.ts';
import { CHECKPOINT_COUNTS, OBSERVATION_SIZE } from '../lib/rl/config.ts';
import { EvaluationSuite, summarizeEvaluation, EVALUATION_STARTS, betterEvaluation } from '../lib/rl/evaluation.ts';
import { DQNAgent, initializeTensorflow } from '../lib/rl/agent.ts';
import { migrateModel } from '../lib/rl/models.ts';

// Follow the centerline in small moves to test race rules independently of policy quality.
function driveAt(env, arc, direction=1) {
  const wrapped=((env.startArc+arc)%env.length+env.length)%env.length;
  const i=Math.max(0,env.cumulative.findIndex(v=>v>wrapped)-1), a=env.points[i],b=env.points[(i+1)%600];
  const t=(wrapped-env.cumulative[i])/env.lengths[i];
  env.state={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,heading:Math.atan2(b.z-a.z,b.x-a.x)+(direction<0?Math.PI:0),speed:8};
  env.time=0;env.stalledTime=0;env.step(4);
}
test('three-lap races award each checkpoint once per lap on all circuits',()=>{
  for(let track=0;track<3;track++) {
    const env=new DrivingEnvironment(track,'local',false,3);
    let checkpointTotal=0,finishTotal=0,events=0,lastLap=0;
    for(let arc=0;arc<env.length*3+1&&!env.done;arc+=.75){
      driveAt(env,arc);checkpointTotal+=env.reward.checkpoint;finishTotal+=env.reward.finish;
      if(env.reward.checkpoint)events++;
      if(env.completedLaps!==lastLap){lastLap=env.completedLaps;assert.equal(env.done,lastLap===3);if(lastLap<3)assert.equal(env.frame().checkpoints,0);}
    }
    assert.equal(env.completedLaps,3);assert.equal(env.completed,true);assert.equal(env.done,true);
    assert.equal(events,3*CHECKPOINT_COUNTS[track]);assert.ok(Math.abs(checkpointTotal-3000)<1e-7);assert.equal(finishTotal,3000);
    assert.equal(env.frame().progress,1);assert.equal(env.observe().length,OBSERVATION_SIZE);
  }
});
test('reversing and recrossing a rewarded checkpoint cannot farm points',()=>{
  // Isolate checkpoint accounting with the independent movement rule disabled.
  const env=new DrivingEnvironment(0,'local',false,3,0),gate=env.length/5;
  let total=0;
  for(let arc=0;arc<gate+3;arc+=.75){driveAt(env,arc);total+=env.reward.checkpoint;}
  assert.equal(total,250);
  for(let repeat=0;repeat<3;repeat++){
    for(let arc=gate+2;arc>gate-3;arc-=.5){driveAt(env,arc,-1);assert.equal(env.reward.checkpoint,0);}
    for(let arc=gate-3;arc<gate+3;arc+=.5){driveAt(env,arc);assert.equal(env.reward.checkpoint,0);}
  }
  assert.equal(env.frame().checkpoints,1);assert.equal(env.completedLaps,0);
});
test('jumping to an unearned checkpoint does not award it',()=>{
  const env=new DrivingEnvironment(0),gate=env.length/5;
  for(let arc=gate-1;arc<gate+2;arc+=.25){driveAt(env,arc);assert.equal(env.reward.checkpoint,0);}
});
test('lap targets extend time budget, enter observations, and constrain evaluation ranking',()=>{
  assert.throws(()=>new DrivingEnvironment(0,'local',false,0));assert.throws(()=>new DrivingEnvironment(0,'local',false,2.5));
  const env=new DrivingEnvironment(0,'local',false,3);env.time=90;env.step(1);assert.equal(env.done,false);
  assert.equal(env.observe().at(-1),.3);env.time=270;env.step(1);assert.equal(env.reason,'Time limit');
  const suite=new EvaluationSuite(0,'local',3);assert.equal(suite.environment.targetLaps,3);
  const runs=EVALUATION_STARTS.map(s=>({name:s.name,score:6000,progress:1,completed:true,time:60,offroadTime:0,reason:'Race complete'}));
  const result=summarizeEvaluation(0,runs,3);assert.equal(result.meanLapTime,20);assert.equal(result.targetLaps,3);
  assert.throws(()=>betterEvaluation(result,summarizeEvaluation(0,runs,1)));
});
test('34-input saved models retain learned rows and gain zero-weight lap inputs',async()=>{
  await initializeTensorflow();const agent=new DQNAgent(42);
  try{
    const weights=agent.exportWeights();weights[0]={shape:[34,64],values:weights[0].values.slice(0,34*64)};
    const saved={version:2,observationVersion:2,id:'old',track:0,preset:'local',seed:42,episode:50,trainedTracks:[0],parentId:null,evaluation:{version:1},weights};
    const original=JSON.stringify(saved),model=migrateModel(saved);
    assert.deepEqual(model.weights[0].values.slice(0,34*64),weights[0].values);assert.ok(model.weights[0].values.slice(34*64).every(v=>v===0));
    assert.equal(model.evaluation,null);assert.equal(model.observationVersion,3);agent.loadWeights(model.weights);
    assert.equal(JSON.stringify(saved),original);
  }finally{agent.dispose();}
});
