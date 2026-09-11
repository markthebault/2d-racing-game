import {DQNAgent,initializeTensorflow} from '../lib/rl/agent.ts';
import {EvaluationSuite} from '../lib/rl/evaluation.ts';
import {readFile,writeFile} from 'node:fs/promises';
await initializeTensorflow();const path=process.argv[2],agent=new DQNAgent(42);agent.loadWeights(JSON.parse(await readFile(path,'utf8')));const results=[];
for(let track=0;track<5;track++){const suite=new EvaluationSuite(track,'adaptive',3);while(!suite.done)suite.step(state=>agent.act(state));results.push(suite.summary());console.log(JSON.stringify({track,success:suite.summary().successRate,progress:suite.summary().meanProgress}));}
await writeFile(process.argv[3],JSON.stringify({weights:path,results},null,2));agent.dispose();
