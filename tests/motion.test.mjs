import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionWindow } from '../lib/rl/motion.ts';
import { DrivingEnvironment } from '../lib/rl/environment.ts';
import { EvaluationSuite, betterEvaluation } from '../lib/rl/evaluation.ts';

test('rolling net displacement catches oscillation and starts only at one second', () => {
  const motion = new MotionWindow(); motion.reset({x:0,z:0});
  for(let i=1;i<60;i++) assert.equal(motion.step({x:Math.sin(i*Math.PI/30)*2,z:0}),null);
  assert.ok(motion.step({x:0,z:0}) < 1);
  for(let i=1;i<=60;i++) motion.step({x:i/10,z:0});
  assert.ok(Math.abs(motion.distance-6)<1e-9);
  for(let i=0;i<51;i++) motion.step({x:6,z:0});
  assert.ok(motion.distance<1,'checks the rolling window between whole-second boundaries');
  motion.reset({x:100,z:100});assert.equal(motion.distance,null);
});
test('idle training and playback fail at one second with one failure penalty', () => {
  for(const playback of [false,true]) {
    const env=new DrivingEnvironment(0,'local',playback);
    for(let i=0;i<9;i++){env.step(4);assert.equal(env.done,false);}
    env.step(4);assert.equal(env.done,true);assert.ok(Math.abs(env.time-1)<1e-9);
    assert.match(env.reason,/Stuck/);assert.equal(env.reward.failure,-100);
    assert.throws(()=>env.step(4));env.reset();assert.equal(env.motion.distance,null);
    for(let i=0;i<10;i++)env.step(1);
    assert.equal(env.done,false);assert.ok(env.motion.distance>7);
  }
});
test('rocking despite nonzero speed ends playback and overrides off-road grace',()=>{
  const env=new DrivingEnvironment(0,'local',true),spawn={...env.state};
  for(let i=0;i<10&&!env.done;i++) {
    env.state={...spawn,x:spawn.x+(i%2)*.1,speed:2};env.step(4);
  }
  assert.equal(env.done,true);assert.match(env.reason,/Stuck/);assert.ok(env.state.speed>0);
  const offroad=new DrivingEnvironment(0,'local',true);offroad.state.x=0;offroad.state.z=0;
  for(let i=0;i<21&&!offroad.done;i++)offroad.step(4);
  assert.match(offroad.reason,/Stuck/);assert.ok(offroad.offroadTime<5);
});
test('threshold validation, disabled rule and evaluation metadata',()=>{
  for(const threshold of [-1,NaN,Infinity,6]) assert.throws(()=>new DrivingEnvironment(0,'local',false,1,threshold));
  const env=new DrivingEnvironment(0,'local',false,1,0);
  for(let i=0;i<20;i++)env.step(4);assert.equal(env.done,false);
  const summaries=[.5,2].map(threshold=>{
    const suite=new EvaluationSuite(0,'local',1,threshold);
    while(!suite.done)suite.step(()=>4);
    assert.equal(suite.summary().minDistance,threshold);return suite.summary();
  });
  assert.throws(()=>betterEvaluation(summaries[0],summaries[1]));
});
