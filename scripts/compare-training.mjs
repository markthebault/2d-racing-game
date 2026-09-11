// The browser comparison uses the same presets, seeds, learner, and evaluation suite.
import {writeFile} from 'node:fs/promises';
import {initializeTensorflow,DQNAgent} from '../lib/rl/agent.ts';
import {DrivingEnvironment} from '../lib/rl/environment.ts';
import {EvaluationSuite} from '../lib/rl/evaluation.ts';
import {COMPARISON_SEEDS,PRESETS} from '../lib/rl/config.ts';
await initializeTensorflow();
const budget=Number(process.argv[2]||100),track=Number(process.argv[3]||0),output=process.argv[4];
if(!Number.isInteger(budget)||budget<1||budget>5000||![0,1,2,3,4].includes(track))throw new Error('Usage: compare-training.mjs <episodes 1–5000> <track 0–4> [output.json]');
const rows=[];
for(const preset of Object.keys(PRESETS).filter(preset=>preset!=='adaptive'))for(const seed of COMPARISON_SEEDS){
  const agent=new DQNAgent(seed),env=new DrivingEnvironment(track,preset);
  try{
    for(let episode=1;episode<=budget;episode++){
      let state=env.reset();
      while(!env.done){const action=agent.act(state,true),step=env.step(action);agent.remember({state,action,reward:step.reward,next:step.observation,done:step.done});agent.train();state=step.observation;}
    }
    const suite=new EvaluationSuite(track,preset);while(!suite.done)suite.step(state=>agent.act(state));
    const evaluation=suite.summary();rows.push({preset,seed,episodes:budget,steps:agent.steps,updates:agent.updates,loss:agent.loss,evaluation});
    console.log(JSON.stringify({preset,seed,episodes:budget,steps:agent.steps,updates:agent.updates,successRate:evaluation.successRate,offroad:evaluation.meanOffroadTime,lapTime:evaluation.meanLapTime,progress:evaluation.meanProgress}));
    if(output)await writeFile(output,JSON.stringify({track,budget,rows,complete:rows.length===12},null,2));
  }finally{agent.dispose();}
}
