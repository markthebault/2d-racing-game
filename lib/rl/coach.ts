import * as tf from '@tensorflow/tfjs';
import { DrivingEnvironment, ACTIONS } from './environment.ts';
import { ProgressiveSteering } from '../steering.ts';
import { seededRandom } from './agent.ts';
import type { Preset } from './config.ts';
export type Lesson = { state: number[]; action: number };
export const COACH_SAMPLES = 12000;
export const COACH_UPDATES = 4000;
/** Instructor supplies training labels only. Never invoke this from model playback/evaluation. */
export function referenceAction(env: DrivingEnvironment){
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

export class DrivingCoach {
  readonly examples: Lesson[] = [];
  readonly environments: DrivingEnvironment[];
  readonly random: () => number;
  readonly optimizer = tf.train.adam(.001);
  updates = 0;
  loss: number | null = null;
  constructor(tracks: number[], preset: Preset, laps: number, minimum: number, seed: number) {
    this.random=seededRandom(seed+234);
    this.environments=tracks.map(track=>new DrivingEnvironment(track,preset,false,laps,minimum));
  }
  get done() { return this.updates >= COACH_UPDATES; }
  step(model: tf.Sequential) {
    if(this.done) return;
    const random=this.random;
    if(this.examples.length < COACH_SAMPLES) {
      const env=this.environments[this.examples.length%this.environments.length];
      env.reset({fraction:random(),offset:(random()*2-1)*(env.halfWidth-.8),heading:(random()*2-1)*.5});
      env.state.speed=random()*34;env.steering.value=random()*2-1;env.controls=ACTIONS[Math.floor(random()*9)];
      const state=env.observe(),action=referenceAction(env);
      // Vary irrelevant history so the policy cannot rely on grid-only observation values.
      state[28]=random();state[29]=random()*.2;state[30]=random()*.8;state[31]=random()*.15;state[32]=random();state[33]=random()*.3;
      state[34]=Math.floor(random()*env.targetLaps)/env.targetLaps;state[46]=random()*.8;state[47]=1;
      this.examples.push({state,action}); return;
    }
    const batch=Array.from({length:64},()=>this.examples[Math.floor(random()*this.examples.length)]);
    this.loss=tf.tidy(()=>this.optimizer.minimize(()=>tf.losses.softmaxCrossEntropy(tf.oneHot(tf.tensor1d(batch.map(r=>r.action),'int32'),9),model.apply(tf.tensor2d(batch.map(r=>r.state))) as tf.Tensor2D).mean() as tf.Scalar,true)!.dataSync()[0]);
    if(!Number.isFinite(this.loss)) throw new Error('Guided warm-up became unstable.');
    this.updates++;
  }
  dispose() { this.optimizer.dispose(); this.examples.length=0; }
}
