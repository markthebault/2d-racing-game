// Runs the identical browser learner without rendering for reproducible learning checks.
import { initializeTensorflow, DQNAgent } from '../lib/rl/agent.ts';
import { DrivingEnvironment } from '../lib/rl/environment.ts';
import * as tf from '@tensorflow/tfjs';
await initializeTensorflow();
const episodes = Number(process.argv[2] || 100), track = Number(process.argv[3] || 0);
const agent = new DQNAgent(42), env = new DrivingEnvironment(track);
let best = -Infinity, baseline = null;
function evaluate(episode) {
  const test = new DrivingEnvironment(track);
  while (!test.done) test.step(agent.act(test.observe()));
  const result = { episode, score: Math.round(test.score), progress: Number(test.frame().progress.toFixed(3)), completed: test.completed, loss: agent.loss, steps: agent.steps, tensors: tf.memory().numTensors };
  best = Math.max(best, test.score);
  console.log(JSON.stringify(result)); return result;
}
baseline = evaluate(0);
for (let episode = 1; episode <= episodes; episode++) {
  let state = env.reset();
  while (!env.done) {
    const action = agent.act(state, true), step = env.step(action);
    agent.remember({ state, action, reward: step.reward, next: step.observation, done: step.done });
    agent.train(); state = step.observation;
  }
  if (episode % 10 === 0) evaluate(episode);
}
agent.dispose();
console.log(JSON.stringify({ baseline, bestScore: Math.round(best), remainingTensors: tf.memory().numTensors }));
