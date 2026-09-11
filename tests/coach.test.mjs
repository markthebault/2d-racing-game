import test from 'node:test';
import assert from 'node:assert/strict';
import {DrivingCoach,COACH_SAMPLES} from '../lib/rl/coach.ts';
import {DQNAgent,initializeTensorflow} from '../lib/rl/agent.ts';
await initializeTensorflow();
test('instructor uses selected tracks and supplies finite observations for supervised and RL updates',()=>{
 const agent=new DQNAgent(42),coach=new DrivingCoach([1,2,4],'local',3,1,42);
 try{
  assert.deepEqual(coach.environments.map(e=>e.track),[1,2,4]);
  for(let i=0;i<12;i++)coach.step(agent.online);
  assert.ok(coach.examples.every(e=>e.state.length===52&&e.state.every(Number.isFinite)&&Number.isInteger(e.action)&&e.action>=0&&e.action<9));
  const originals=[...coach.examples];while(coach.examples.length<COACH_SAMPLES)coach.examples.push(originals[coach.examples.length%originals.length]);
  const before=JSON.stringify(agent.exportWeights());coach.step(agent.online);assert.equal(coach.updates,1);assert.ok(Number.isFinite(coach.loss));assert.notEqual(JSON.stringify(agent.exportWeights()),before);
  agent.lessons=coach.examples;assert.equal(agent.epsilon,.15);
  for(let i=0;i<256;i++){const e=originals[i%originals.length];agent.remember({track:1,state:e.state,action:e.action,reward:1,next:e.state,done:i%20===0});}
  assert.ok(Number.isFinite(agent.train()));assert.equal(agent.updates,1);
 }finally{coach.dispose();agent.dispose();}
});
