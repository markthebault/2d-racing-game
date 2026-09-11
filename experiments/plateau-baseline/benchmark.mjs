import {writeFile} from 'node:fs/promises';
import {DQNAgent,initializeTensorflow} from './lib/rl/agent.ts';
import {DrivingEnvironment} from './lib/rl/environment.ts';
import {EvaluationSuite} from './lib/rl/evaluation.ts';
import {trainingStart} from './lib/rl/curriculum.ts';
import {seededRandom} from './lib/rl/agent.ts';
await initializeTensorflow();
const seed=Number(process.argv[3]||42),output=process.argv[4]||'/tmp/plateau-baseline.json';
const agent=new DQNAgent(seed),tracks=[0,1,2],random=seededRandom(seed+101),budget=Number(process.argv[2]||60000),envs=tracks.map(t=>new DrivingEnvironment(t,'local',false,3));
agent.setTrainingTracks(tracks);let episode=0;const started=Date.now(),results=[];
while(agent.steps<budget){const env=envs[episode%3];let state=env.reset(trainingStart(Math.floor(episode/3),true,random));
 while(!env.done&&agent.steps<budget){const action=agent.act(state,true),r=env.step(action);agent.remember({track:env.track,state,action,reward:r.reward,next:r.observation,done:r.done});agent.train();state=r.observation;}
 episode++;
 if(episode%50===0)console.log(JSON.stringify({episode,steps:agent.steps,seconds:(Date.now()-started)/1000}));
}
for(let track=0;track<5;track++){const suite=new EvaluationSuite(track,'local',3);while(!suite.done)suite.step(s=>agent.act(s));results.push(suite.summary());}
await writeFile(output,JSON.stringify({seed,budget,episode,seconds:(Date.now()-started)/1000,results},null,2));
console.log(JSON.stringify(results.map(r=>({track:r.track,success:r.successRate,progress:r.meanProgress,reasons:r.runs.map(s=>s.reason)}))));agent.dispose();
