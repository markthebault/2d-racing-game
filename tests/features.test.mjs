import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_GROUPS, configureFeatures, DEFAULT_FEATURES, SENSOR_FEATURES, currentFeatures } from '../lib/rl/features.ts';
import { DrivingEnvironment } from '../lib/rl/environment.ts';
import { DrivingCoach } from '../lib/rl/coach.ts';

test('feature groups cover every observation slot exactly once',()=>{
  assert.deepEqual(FEATURE_GROUPS.flatMap(g=>[...g.indices]).sort((a,b)=>a-b),Array.from({length:52},(_,i)=>i));
});
test('mask applies to training, playback and instructor examples without changing rewards',()=>{
  try {
    configureFeatures(DEFAULT_FEATURES);
    const full=new DrivingEnvironment(0); const original=full.observe();
    const reward=full.step(1).reward;
    configureFeatures(SENSOR_FEATURES);
    const env=new DrivingEnvironment(0), playback=new DrivingEnvironment(0,'local',true);
    for(const observation of [env.observe(),playback.observe()]) for(const group of FEATURE_GROUPS) for(const i of group.indices) assert.equal(observation[i],SENSOR_FEATURES[group.id]?original[i]:0);
    assert.equal(env.step(1).reward,reward);
    const coach=new DrivingCoach([0],'local',1,1,42);
    try {coach.step(null);for(const group of FEATURE_GROUPS) if(!SENSOR_FEATURES[group.id]) for(const i of group.indices) assert.equal(coach.examples[0].state[i],0);} finally {coach.dispose();}
    const saved=currentFeatures(); configureFeatures(); configureFeatures(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(currentFeatures(),SENSOR_FEATURES);
    assert.throws(()=>configureFeatures({rays:false}),/Invalid/);
  } finally {configureFeatures();}
});
