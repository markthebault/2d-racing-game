// Diagnostic geometric controller, not a learned policy and never used by model playback.
import {EvaluationSuite} from '../lib/rl/evaluation.ts';
import {ProgressiveSteering} from '../lib/steering.ts';
import {writeFile} from 'node:fs/promises';
export function referenceAction(env){
 const context=env.roadContext(),speed=env.state.speed;
 const point=env.pointAhead(Math.max(4,Math.min(8,speed*.45))),dx=point.x-env.state.x,dz=point.z-env.state.z;
 const lateral=-Math.sin(env.state.heading)*dx+Math.cos(env.state.heading)*dz;
 const yaw=2*Math.max(7,speed)*lateral/Math.max(1,dx*dx+dz*dz);
 const desired=Math.max(-1,Math.min(1,yaw/1.85));
 let steer=0,error=Infinity;
 for(const input of [-1,0,1]){const test=new ProgressiveSteering();test.value=env.steering.value;const value=test.update(input,.1),difference=Math.abs(value-desired);if(difference<error){error=difference;steer=input;}}
 const target=Math.min(16,context.safeSpeed);
 const pedal=speed<target-.5?0:speed>target+.8?2:1;
 return pedal*3+steer+1;
}
if(process.argv[1]?.endsWith('reference-driver.mjs')){
 const results=[];
 for(let track=0;track<5;track++){const suite=new EvaluationSuite(track,'adaptive',3);while(!suite.done)suite.step(()=>referenceAction(suite.environment));results.push(suite.summary());console.log(JSON.stringify({track,success:suite.summary().successRate,progress:suite.summary().meanProgress,reasons:suite.runs.map(r=>r.reason)}));}
 await writeFile('/tmp/plateau-reference.json',JSON.stringify(results,null,2));
}
