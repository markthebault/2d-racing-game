import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleBatch } from '../lib/rl/batch.ts';
import { DrivingEnvironment } from '../lib/rl/environment.ts';

test('fifty recorded cars interpolate together, stop individually and retain terminal poses', () => {
  const runs = Array.from({length:50}, (_,i) => ({episode:i+1,completed:i===0,poses:[
    {x:0,z:0,heading:Math.PI-.1,time:0}, {x:i+1,z:1,heading:-Math.PI+.1,time:.1},
  ]}));
  const midway=sampleBatch(runs,.05,2);
  assert.equal(midway.poses.length,50);assert.equal(midway.first,1);assert.equal(midway.last,50);assert.equal(midway.track,2);
  assert.equal(midway.poses[49].x,25);assert.ok(Math.abs(midway.poses[0].heading-Math.PI)<1e-9);
  assert.ok(midway.poses.every(p=>!p.done));
  const end=sampleBatch(runs,10,2);assert.ok(end.poses.every(p=>p.done));assert.equal(end.poses[49].x,50);
  assert.equal(end.poses[0].completed,true);assert.equal(end.duration,.1);
});
test('playback allows five continuous seconds even far off-road and after earlier stalled time', () => {
  const env=new DrivingEnvironment(0,'local',true);
  env.state.x=0;env.state.z=0;env.stalledTime=5.5;
  for(let i=0;i<49;i++){env.step(4);assert.equal(env.done,false);}
  while(!env.done)env.step(4);
  assert.ok(env.offroadTime>=5&&env.offroadTime<5.11);
  assert.equal(env.reason,'Left the track');
  const training=new DrivingEnvironment(0);training.state.x=0;training.state.z=0;training.step(4);
  assert.equal(training.done,true,'training retains its distance limit');
});
test('returning to the track resets the playback grace period', () => {
  const env=new DrivingEnvironment(0,'local',true),start={...env.state};
  env.state.x=0;env.state.z=0;for(let i=0;i<30;i++)env.step(4);
  env.state={...start};env.step(4);assert.equal(env.offroadTime,0);assert.equal(env.done,false);
  env.state.x=0;env.state.z=0;for(let i=0;i<30;i++)env.step(4);
  assert.equal(env.done,false);
});
