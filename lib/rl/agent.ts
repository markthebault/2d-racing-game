import * as tf from '@tensorflow/tfjs';
import { ACTIONS, OBSERVATION_SIZE } from './environment.ts';

export type Weights = { shape: number[]; values: number[] }[];
export type Experience = { state: number[]; action: number; reward: number; next: number[]; done: boolean };
export function seededRandom(seed = 42) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let n = Math.imul(seed ^ seed >>> 15, 1 | seed); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
export async function initializeTensorflow() { await tf.setBackend('cpu'); await tf.ready(); }
function network(seed: number) {
  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [OBSERVATION_SIZE], units: 64, activation: 'relu', kernelInitializer: tf.initializers.glorotUniform({ seed }) }));
  model.add(tf.layers.dense({ units: 64, activation: 'relu', kernelInitializer: tf.initializers.glorotUniform({ seed: seed + 1 }) }));
  model.add(tf.layers.dense({ units: ACTIONS.length, kernelInitializer: tf.initializers.glorotUniform({ seed: seed + 2 }) }));
  return model;
}
export class DQNAgent {
  readonly online: tf.Sequential;
  readonly target: tf.Sequential;
  readonly optimizer = tf.train.adam(.0005);
  readonly random: () => number;
  replay: Experience[] = [];
  private cursor = 0;
  updates = 0;
  steps = 0;
  loss: number | null = null;
  constructor(seed = 42) {
    this.random = seededRandom(seed); this.online = network(seed); this.target = network(seed + 10);
    this.target.setWeights(this.online.getWeights());
  }
  get epsilon() { return Math.max(.04, Math.exp(-this.steps / 16000)); }
  act(state: number[], explore = false) {
    if (explore && this.random() < this.epsilon) {
      // Favor movement when exploring. Uniform braking at rest otherwise fills memory with stationary failures.
      const pedal = this.random(), bank = pedal < .7 ? 0 : pedal < .9 ? 1 : 2;
      return bank * 3 + Math.floor(this.random() * 3);
    }
    return tf.tidy(() => (this.online.predict(tf.tensor2d([state])) as tf.Tensor2D).argMax(1).dataSync()[0]);
  }
  remember(experience: Experience) {
    this.replay[this.cursor] = experience; this.cursor = (this.cursor + 1) % 20000; this.steps++;
  }
  train() {
    if (this.replay.length < 256 || this.steps % 4 !== 0) return this.loss;
    const batch = Array.from({ length: 32 }, () => this.replay[Math.floor(this.random() * this.replay.length)]);
    const loss = tf.tidy(() => {
      const states = tf.tensor2d(batch.map(e => e.state)), next = tf.tensor2d(batch.map(e => e.next));
      const actions = tf.oneHot(tf.tensor1d(batch.map(e => e.action), 'int32'), ACTIONS.length);
      // Double DQN: online chooses the next action; the delayed target values it.
      const bestNext = (this.online.predict(next) as tf.Tensor2D).argMax(1);
      const future = (this.target.predict(next) as tf.Tensor2D).mul(tf.oneHot(bestNext, ACTIONS.length)).sum(1);
      const target = tf.tensor1d(batch.map(e => e.reward * .01)).add(future.mul(tf.tensor1d(batch.map(e => e.done ? 0 : .995))));
      const cost = this.optimizer.minimize(() => {
        const prediction = (this.online.apply(states) as tf.Tensor2D).mul(actions).sum(1);
        return tf.losses.huberLoss(target, prediction).mean() as tf.Scalar;
      }, true);
      return cost!.dataSync()[0];
    });
    if (!Number.isFinite(loss)) throw new Error('Training became unstable. Start a new training session.');
    this.loss = loss; this.updates++;
    if (this.updates % 200 === 0) this.target.setWeights(this.online.getWeights());
    return loss;
  }
  exportWeights(): Weights { return this.online.getWeights().map(t => ({ shape: [...t.shape], values: Array.from(t.dataSync()) })); }
  loadWeights(weights: Weights) {
    const expected = this.online.getWeights();
    if (!Array.isArray(weights) || weights.length !== expected.length || weights.some((w, i) =>
      !Array.isArray(w.shape) || JSON.stringify(w.shape) !== JSON.stringify(expected[i].shape) ||
      !Array.isArray(w.values) || w.values.length !== expected[i].size || w.values.some(v => !Number.isFinite(v)))) throw new Error('The saved model is incompatible.');
    tf.tidy(() => this.online.setWeights(weights.map(w => tf.tensor(w.values, w.shape))));
    this.target.setWeights(this.online.getWeights());
  }
  dispose() { this.online.dispose(); this.target.dispose(); this.optimizer.dispose(); this.replay = []; }
}
