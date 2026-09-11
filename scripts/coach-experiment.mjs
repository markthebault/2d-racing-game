// Experimental imitation warm-up. The instructor labels training states only; evaluation uses network predictions only.
import * as tf from '@tensorflow/tfjs';
import {DQNAgent,initializeTensorflow,seededRandom} from '../lib/rl/agent.ts';
import {DrivingEnvironment,ACTIONS} from '../lib/rl/environment.ts';
import {EvaluationSuite} from '../lib/rl/evaluation.ts';
import {referenceAction} from './reference-driver.mjs';
import {writeFile} from 'node:fs/promises';
await initializeTensorflow();
const seed=Number(process.argv[2]||42),agent=new DQNAgent(seed),random=seededRandom(seed+234),envs=[0,1,2].map(t=>new DrivingEnvironment(t,'adaptive',false,3)),data=[],optimizer=tf.train.adam(.001);
for(let i=0;i<12000;i++){
 const env=envs[i%3];env.reset({fraction:random(),offset:(random()*2-1)*(env.halfWidth-.8),heading:(random()*2-1)*.5});env.state.speed=random()*34;env.steering.value=random()*2-1;env.controls=ACTIONS[Math.floor(random()*9)];
 const state=env.observe(),action=referenceAction(env);
 // Random nuisance history prevents a stationary/grid-only training distribution.
 state[28]=random();state[29]=random()*.2;state[30]=random()*.8;state[31]=random()*.15;state[32]=random();state[33]=random()*.3;state[34]=Math.floor(random()*3)/3;state[46]=random()*.8;state[47]=1;
 data.push({state,action});
}
for(let update=0;update<4000;update++){
 const batch=Array.from({length:64},()=>data[Math.floor(random()*data.length)]);
 const loss=tf.tidy(()=>optimizer.minimize(()=>tf.losses.softmaxCrossEntropy(tf.oneHot(tf.tensor1d(batch.map(r=>r.action),'int32'),9),agent.online.apply(tf.tensor2d(batch.map(r=>r.state)))).mean(),true).dataSync()[0]);
 if(update%500===0)console.log(JSON.stringify({update,loss}));
}
const results=[];
for(let track=0;track<5;track++){const suite=new EvaluationSuite(track,'adaptive',3);while(!suite.done)suite.step(s=>agent.act(s));results.push(suite.summary());console.log(JSON.stringify({track,success:suite.summary().successRate,progress:suite.summary().meanProgress}));}
await writeFile(`/tmp/plateau-coach-${seed}.json`,JSON.stringify({seed,examples:data.length,updates:4000,results},null,2));await writeFile(`/tmp/plateau-coach-${seed}-weights.json`,JSON.stringify(agent.exportWeights()));optimizer.dispose();agent.dispose();
