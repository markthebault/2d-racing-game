import {readFile,writeFile} from 'node:fs/promises';
import {DQNAgent,initializeTensorflow,seededRandom} from '../lib/rl/agent.ts';
import {DrivingCoach} from '../lib/rl/coach.ts';
import {DrivingEnvironment} from '../lib/rl/environment.ts';
import {EvaluationSuite} from '../lib/rl/evaluation.ts';
import {trainingStart} from '../lib/rl/curriculum.ts';
await initializeTensorflow();
const seed=Number(process.argv[2]||42), agent=new DQNAgent(seed), coach=new DrivingCoach([0,1,2],'local',3,1,seed);
if(process.env.WARMUP_WEIGHTS){while(coach.examples.length<12000)coach.step(agent.online);agent.loadWeights(JSON.parse(await readFile(process.env.WARMUP_WEIGHTS,'utf8')));}else{while(!coach.done)coach.step(agent.online);await writeFile(`/tmp/guided-warmup-${seed}-weights.json`,JSON.stringify(agent.exportWeights()));}
agent.target.setWeights(agent.online.getWeights());agent.lessons=coach.examples;agent.setTrainingTracks([0,1,2]);
function evaluate(){return Array.from({length:5},(_,track)=>{const suite=new EvaluationSuite(track,'local',3);while(!suite.done)suite.step(s=>agent.act(s));return suite.summary();});}
const before=evaluate();console.log(JSON.stringify({phase:'warmup',seed,success:before.map(r=>r.successRate)}));
const random=seededRandom(seed+101);let episode=0;
while(agent.steps<Number(process.env.RL_DECISIONS||10000)){const env=new DrivingEnvironment(episode%3,'local',false,3);let state=env.reset(trainingStart(Math.floor(episode/3),true,random));while(!env.done&&agent.steps<Number(process.env.RL_DECISIONS||10000)){const action=agent.act(state,true),r=env.step(action);agent.remember({track:env.track,state,action,reward:r.reward,next:r.observation,done:r.done});agent.train();state=r.observation;}episode++;}
const after=evaluate();console.log(JSON.stringify({phase:'after RL',seed,success:after.map(r=>r.successRate)}));
await writeFile(`/tmp/plateau-guided-${seed}.json`,JSON.stringify({seed,examples:12000,warmupUpdates:4000,decisions:agent.steps,updates:agent.updates,before,after},null,2));coach.dispose();agent.dispose();
