import test from 'node:test';
import assert from 'node:assert/strict';
import * as tf from '@tensorflow/tfjs';
import { DrivingEnvironment, ACTIONS, OBSERVATION_SIZE } from '../lib/rl/environment.ts';
import { initializeTensorflow, DQNAgent } from '../lib/rl/agent.ts';
import { stepVehicle } from '../lib/vehicle.ts';
import { ProgressiveSteering } from '../lib/steering.ts';

await initializeTensorflow();
test('all circuits expose normalized, finite observations and the requested controls', () => {
  assert.equal(ACTIONS.length, 9);
  for (let track = 0; track < 3; track++) {
    const env = new DrivingEnvironment(track);
    for (let i = 0; i < 60 && !env.done; i++) {
      const result = env.step(i % 9);
      assert.equal(result.observation.length, OBSERVATION_SIZE);
      assert.ok(result.observation.every(v => Number.isFinite(v) && v >= -1.000001 && v <= 1.000001));
      assert.ok(Number.isFinite(result.reward));
    }
  }
});
test('agent controls use identical physics, speed limits and progressive steering', () => {
  const env = new DrivingEnvironment(0), state = { ...env.state }, steering = new ProgressiveSteering();
  for (let sub = 0; sub < 6; sub++) stepVehicle(state, ACTIONS[2], steering, 1 / 60, false, env.bounds);
  env.step(2);
  for (const field of ['x','z','heading','speed']) assert.ok(Math.abs(state[field] - env.state[field]) < 1e-10);
  assert.equal(env.steering.value, steering.value);
  assert.ok(steering.value > 0 && steering.value < .3);
});
test('stationary episodes cannot earn points; off-road movement cannot earn progress', () => {
  const idle = new DrivingEnvironment(0);
  while (!idle.done) idle.step(4);
  assert.equal(idle.reason, 'Stuck: insufficient movement over 1 second'); assert.ok(idle.score < -100); assert.equal(idle.completed, false);
  assert.throws(() => idle.step(1), /Reset/);
  const grass = new DrivingEnvironment(0); grass.state.x = 0; grass.state.z = 0;
  const result = grass.step(1);
  assert.ok(result.reward < 0); assert.equal(grass.reward.progress, 0); assert.equal(grass.reward.speed, 0); assert.ok(grass.reward.offroad < 0);
});
test('finish-line oscillation and a teleport cannot award a lap bonus', () => {
  const env = new DrivingEnvironment(0);
  const before = env.points[599], start = env.points[0];
  for (let i = 0; i < 10; i++) {
    if (env.done) env.reset();
    const p = i % 2 ? start : before;
    env.state.x = p.x; env.state.z = p.z; env.state.speed = 4;
    env.step(1); assert.equal(env.reward.finish, 0); assert.equal(env.completed, false);
  }
  env.reset(); env.state.x = env.points[350].x; env.state.z = env.points[350].z;
  env.step(1); assert.equal(env.reward.finish, 0); assert.equal(env.reward.progress, 0);
});
test('a full valid route earns exactly one finish bonus and checkpoints reject a shortcut', () => {
  // Advance through tiny physical moves on the centerline. No policy is used here.
  const env = new DrivingEnvironment(0);
  const increment = .75;
  for (let arc = 0; arc < env.length + .2 && !env.done; arc += increment) {
    const wrapped = arc % env.length;
    const i = Math.max(0, env.cumulative.findIndex(v => v > wrapped) - 1);
    const a = env.points[i], b = env.points[(i+1)%600], fraction=(wrapped-env.cumulative[i])/env.lengths[i];
    env.state.x=a.x+(b.x-a.x)*fraction; env.state.z=a.z+(b.z-a.z)*fraction;
    env.state.heading=Math.atan2(b.z-a.z,b.x-a.x); env.state.speed=8;
    // Keep this geometry test independent of the 90-second episode time limit.
    env.time=0;
    env.step(4);
  }
  assert.equal(env.completed,true); assert.equal(env.reward.finish,1000);
  assert.throws(()=>env.step(1));
});
test('Double DQN updates weights, replays saved predictions, rejects corrupt weights and frees tensors', () => {
  const baseline = tf.memory().numTensors;
  const agent = new DQNAgent(42), copy = new DQNAgent(7), env = new DrivingEnvironment(0);
  const input = env.observe(); const initial = agent.exportWeights();
  for (let i=0; i<320; i++) {
    agent.remember({state:input,action:1,reward:10,next:input,done:true}); agent.train();
  }
  assert.ok(Number.isFinite(agent.loss)); assert.ok(agent.updates>0);
  assert.notDeepEqual(agent.exportWeights(), initial);
  const serialized=JSON.parse(JSON.stringify(agent.exportWeights())); copy.loadWeights(serialized);
  assert.equal(copy.act(input),agent.act(input)); assert.deepEqual(copy.exportWeights(),serialized);
  const afterWarmup=tf.memory().numTensors;
  for(let i=0;i<120;i++){agent.remember({state:input,action:1,reward:10,next:input,done:true});agent.train();}
  assert.equal(tf.memory().numTensors,afterWarmup);
  assert.throws(()=>copy.loadWeights([]),/incompatible/);
  serialized[0].values[0]=NaN; assert.throws(()=>copy.loadWeights(serialized),/incompatible/);
  agent.dispose();copy.dispose();assert.equal(tf.memory().numTensors,baseline);
});

test('reward and termination history are visible even at an identical physical pose', () => {
  const env = new DrivingEnvironment(0), original = env.observe();
  env.time = 45; env.stalledTime = 3; env.distance = env.length * .2; env.furthest = env.length * .4;
  const changed = env.observe();
  assert.deepEqual(changed.slice(0,28), original.slice(0,28));
  assert.equal(changed[28], .5); assert.equal(changed[29], .5);
  assert.notEqual(changed[30],original[30]); assert.notEqual(changed[31],original[31]);
  const before = env.observe(); env.step(4);
  assert.ok(env.observe()[28] > before[28]);
});

test('all experiment stages keep the same shape; local masks absolute position only', async () => {
  const {PRESETS, progressRewards} = await import('../lib/rl/config.ts');
  for (let track=0;track<3;track++) {
    const local = new DrivingEnvironment(track,'local'), baseline = new DrivingEnvironment(track,'baseline');
    assert.deepEqual(local.observe().slice(20,24),[0,0,0,0]);
    assert.deepEqual(local.observe().slice(0,20),baseline.observe().slice(0,20));
    assert.deepEqual(local.observe().slice(24),baseline.observe().slice(24));
    for(const preset of Object.keys(PRESETS)) assert.equal(new DrivingEnvironment(track,preset).observe().length,OBSERVATION_SIZE);
    const reward=progressRewards(local.length,.5,40,local.length,'local');
    assert.equal(reward.progress,750);assert.equal(reward.speed,0);
    const old=progressRewards(1,1,40,local.length,'baseline');const noSpeed=progressRewards(1,1,40,local.length,'no-speed');
    assert.equal(old.progress,noSpeed.progress);assert.equal(old.speed,1);assert.equal(noSpeed.speed,0);
  }
});

test('varied starts require a full circuit back to their own start, with all checkpoints', () => {
  for (const track of [0,1,2]) for (const fraction of [0,1/3,2/3]) {
    const env = new DrivingEnvironment(track); env.reset({fraction,offset:0,heading:0});
    for (let arc=0;arc<env.length+.8&&!env.done;arc+=.75) {
      const wrapped=(env.startArc+arc)%env.length;
      const i=Math.max(0,env.cumulative.findIndex(v=>v>wrapped)-1),a=env.points[i],b=env.points[(i+1)%600];
      const t=(wrapped-env.cumulative[i])/env.lengths[i];
      env.state={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,heading:Math.atan2(b.z-a.z,b.x-a.x),speed:8};env.time=0;
      env.step(4);
      if(arc<env.length-2)assert.equal(env.completed,false);
    }
    assert.equal(env.completed,true,`track ${track}, start ${fraction}`);assert.equal(env.reward.finish,1000);
  }
});

test('evaluation separates successes, failure durations, off-road totals, and track identity', async () => {
  const {summarizeEvaluation,betterEvaluation,EVALUATION_STARTS,EvaluationSuite}=await import('../lib/rl/evaluation.ts');
  const runs=EVALUATION_STARTS.map((s,i)=>({name:s.name,score:i*10,progress:.5,completed:i<2,time:i<2?20+i*10:90,offroadTime:i,reason:''}));
  const result=summarizeEvaluation(0,runs);
  assert.equal(result.successRate,.4);assert.equal(result.meanLapTime,25);assert.equal(result.meanOffroadTime,2);
  const failure=summarizeEvaluation(0,runs.map(r=>({...r,completed:false,score:10000})));
  assert.equal(failure.meanLapTime,null);assert.ok(betterEvaluation(result,failure));
  assert.throws(()=>betterEvaluation(result,{...failure,track:1}),/different tracks/);
  const one=new EvaluationSuite(0,'local'),two=new EvaluationSuite(0,'local');
  while(!one.done)one.step(()=>4);while(!two.done)two.step(()=>4);
  assert.deepEqual(one.summary(),two.summary());assert.equal(one.summary().runs.length,5);
});

test('legacy migration preserves predictions and models can run on every circuit without mutating the source', async () => {
  const {migrateModel}=await import('../lib/rl/models.ts');
  const agent=new DQNAgent(42),target=new DQNAgent(3);
  try {
    const weights=agent.exportWeights();weights[0]={shape:[28,64],values:weights[0].values.slice(0,28*64)};
    const legacy={version:1,track:0,episode:400,score:1800,progress:1,completed:true,weights};
    const original=JSON.stringify(legacy),migrated=migrateModel(legacy);target.loadWeights(migrated.weights);
    assert.equal(migrated.preset,'baseline');assert.equal(migrated.evaluation,null);assert.deepEqual(migrated.trainedTracks,[0]);
    for(let track=0;track<3;track++) {
      const env=new DrivingEnvironment(track,'baseline'),state=env.observe();
      const expected=tf.tidy(()=>{
        let x=tf.tensor2d([state.slice(0,28)]);
        for(let layer=0;layer<3;layer++) {x=x.matMul(tf.tensor(weights[layer*2].values,weights[layer*2].shape)).add(tf.tensor(weights[layer*2+1].values,weights[layer*2+1].shape));if(layer<2)x=x.relu();}
        return Array.from(x.dataSync());
      });
      const actual=tf.tidy(()=>Array.from(target.online.predict(tf.tensor2d([state])).dataSync()));
      actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-6));
      for(let i=0;i<10&&!env.done;i++)env.step(target.act(env.observe()));
      assert.ok(Number.isFinite(env.score));
    }
    assert.equal(JSON.stringify(legacy),original);
  } finally {agent.dispose();target.dispose();}
});
