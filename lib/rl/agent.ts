import type { NetworkReading, UpdateReading } from './insights.ts';
import * as tf from '@tensorflow/tfjs';
import { ACTIONS, OBSERVATION_SIZE } from './environment.ts';

export type Weights = { shape: number[]; values: number[] }[];
export type Experience = { track?: number; state: number[]; action: number; reward: number; next: number[]; done: boolean; discount?: number };
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
  captureLearning = false;
  lastExploratory = false;
  lastUpdate: UpdateReading | null = null;
  advanced: boolean;
  lessons: { state: number[]; action: number }[] = [];
  readonly online: tf.Sequential;
  readonly target: tf.Sequential;
  readonly optimizer = tf.train.adam(.0005);
  readonly random: () => number;
  replay: Experience[] = [];
  private cursor = 0;
  private pending: Experience[] = [];
  private explorationRestart = 0;
  discardPending() { this.pending = []; }
  renewExploration() { this.explorationRestart = this.steps; }

  private trainingTracks: number[] = [];
  private buckets = new Map<number, { items: Experience[]; slots: number[]; cursor: number }>();
  setTrainingTracks(tracks: number[]) {
    const existing = this.replay;
    this.trainingTracks = [...tracks]; this.clearReplay(); this.renewExploration();
    if (!tracks.length) { this.replay = existing; this.cursor = existing.length % 20000; return; }
    for (const item of existing) if (item.track !== undefined && tracks.includes(item.track)) this.store(item);
  }
  get replayCounts() { return this.trainingTracks.map(track => ({ track, count: this.buckets.get(track)?.items.length ?? 0 })); }
  private store(experience: Experience) {
    const track = experience.track ?? this.trainingTracks[0];
    if (!this.trainingTracks.includes(track)) return;
    let bucket = this.buckets.get(track);
    if (!bucket) { bucket = { items: [], slots: [], cursor: 0 }; this.buckets.set(track, bucket); }
    if (bucket.slots[bucket.cursor] === undefined) { bucket.slots[bucket.cursor] = this.replay.length; this.replay.push(experience); }
    else this.replay[bucket.slots[bucket.cursor]] = experience;
    bucket.items[bucket.cursor] = experience;
    bucket.cursor = (bucket.cursor + 1) % Math.floor(20000 / this.trainingTracks.length);
  }
  updates = 0;
  steps = 0;
  loss: number | null = null;
  constructor(seed = 42, advanced = false) {
    this.advanced = advanced;
    this.random = seededRandom(seed); this.online = network(seed); this.target = network(seed + 10);
    this.target.setWeights(this.online.getWeights());
  }
  clearReplay() { this.lastUpdate = null; this.replay = []; this.cursor = 0; this.buckets.clear(); this.discardPending(); }
  get epsilon() { if(this.lessons.length) return Math.max(.04,.15*Math.exp(-this.steps/20000)); if(!this.advanced) return Math.max(.04,Math.exp(-this.steps/16000)); return Math.max(.08, Math.exp(-this.steps / 40000), .3 * Math.exp(-(this.steps-this.explorationRestart)/8000)); }
  inspect(state: number[]): NetworkReading {
    return tf.tidy(() => {
      let current = tf.tensor2d([state]);
      const layers = this.online.layers.map(layer => { current = layer.apply(current) as tf.Tensor2D; return Array.from(current.dataSync()); });
      return { inputs: [...state], hidden: layers.slice(0, 2), values: layers[2] };
    });
  }
  act(state: number[], explore = false) {
    this.lastExploratory = false;
    if (explore && this.random() < this.epsilon) {
      // Favor movement when exploring. Uniform braking at rest otherwise fills memory with stationary failures.
      this.lastExploratory = true;
      const pedal = this.random(), bank = pedal < (this.advanced ? .55 : .7) ? 0 : pedal < (this.advanced ? .8 : .9) ? 1 : 2;
      return bank * 3 + Math.floor(this.random() * 3);
    }
    return tf.tidy(() => (this.online.predict(tf.tensor2d([state])) as tf.Tensor2D).argMax(1).dataSync()[0]);
  }
  remember(experience: Experience) {
    if(!this.advanced) { this.steps++; if(this.trainingTracks.length) this.store(experience); else { this.replay[this.cursor]=experience;this.cursor=(this.cursor+1)%20000; } return; }
    if (this.pending.length && this.pending[0].track !== experience.track) this.discardPending();
    this.steps++; this.pending.push(experience);
    while (this.pending.length >= 3 || (experience.done && this.pending.length)) {
      const sequence=this.pending.slice(0,3), last=sequence[sequence.length-1];
      const item={...this.pending[0], reward:sequence.reduce((sum,e,i)=>sum+Math.pow(.995,i)*e.reward,0), next:last.next, done:last.done, discount:Math.pow(.995,sequence.length)};
      if (this.trainingTracks.length) this.store(item);
      else { this.replay[this.cursor]=item; this.cursor=(this.cursor+1)%20000; }
      this.pending.shift();
    }
  }
  train() {
    if (this.replay.length < 256 || this.steps % 4 !== 0) return this.loss;
    const buckets = [...this.buckets.values()].filter(bucket => bucket.items.length);
    const batch = Array.from({ length: 32 }, () => {
      const pool = buckets.length ? buckets[Math.floor(this.random() * buckets.length)].items : this.replay;
      return pool[Math.floor(this.random() * pool.length)];
    });
    const demonstrations=this.lessons.length ? Array.from({length:16},()=>this.lessons[Math.floor(this.random()*this.lessons.length)]) : [];
    let captured: UpdateReading | null = null;
    const loss = tf.tidy(() => {
      const states = tf.tensor2d(batch.map(e => e.state)), next = tf.tensor2d(batch.map(e => e.next));
      const actions = tf.oneHot(tf.tensor1d(batch.map(e => e.action), 'int32'), ACTIONS.length);
      // Double DQN: online chooses the next action; the delayed target values it.
      const bestNext = (this.online.predict(next) as tf.Tensor2D).argMax(1);
      const future = (this.target.predict(next) as tf.Tensor2D).mul(tf.oneHot(bestNext, ACTIONS.length)).sum(1);
      const target = tf.tensor1d(batch.map(e => e.reward * .01)).add(future.mul(tf.tensor1d(batch.map(e => e.done ? 0 : e.discount ?? .995))));
      if (this.captureLearning) {
        const predicted = (this.online.predict(states) as tf.Tensor2D).mul(actions).sum(1);
        const predictions = Array.from(predicted.dataSync()), targets = Array.from(target.dataSync());
        const demoLoss = demonstrations.length ? tf.losses.softmaxCrossEntropy(tf.oneHot(tf.tensor1d(demonstrations.map(row=>row.action),'int32'),ACTIONS.length),this.online.predict(tf.tensor2d(demonstrations.map(row=>row.state))) as tf.Tensor2D).mean().dataSync()[0] : 0;
        captured = { update: this.updates + 1, tdLoss: tf.losses.huberLoss(target,predicted).mean().dataSync()[0], demonstrationLoss: demoLoss * 5, batchSize: batch.length,
          samples: batch.slice(0,8).map((item,i)=>({track:item.track??null,action:item.action,reward:item.reward,terminal:item.done,prediction:predictions[i],target:targets[i],after:predictions[i]})) };
      }
      const objective = () => {
        const prediction = (this.online.apply(states) as tf.Tensor2D).mul(actions).sum(1);
        let loss=tf.losses.huberLoss(target, prediction).mean();
        if(demonstrations.length) {
          const labels=tf.oneHot(tf.tensor1d(demonstrations.map(row=>row.action),'int32'),ACTIONS.length);
          const q=this.online.apply(tf.tensor2d(demonstrations.map(row=>row.state))) as tf.Tensor2D;
          // Keep useful demonstrated decisions while TD values adapt to driving rewards.
          const imitation=tf.losses.softmaxCrossEntropy(labels,q).mean();
          loss=loss.add(imitation.mul(5));
        }
        return loss as tf.Scalar;
      };
      if(!this.advanced) return this.optimizer.minimize(objective,true)!.dataSync()[0];
      const { value: cost, grads } = this.optimizer.computeGradients(objective);
      const norm=tf.addN(Object.values(grads).map(gradient=>gradient.square().sum())).sqrt();
      const scale=tf.minimum(1,tf.div(5,norm.add(1e-8)));
      this.optimizer.applyGradients(Object.fromEntries(Object.entries(grads).map(([name,gradient])=>[name,gradient.mul(scale)])));
      return cost.dataSync()[0];
    });
    if (!Number.isFinite(loss)) throw new Error('Training became unstable. Start a new training session.');
    if (captured) {
      const reading = captured as UpdateReading;
      tf.tidy(() => { const q = this.online.predict(tf.tensor2d(batch.slice(0,8).map(item=>item.state))) as tf.Tensor2D;
        const values = q.arraySync(); reading.samples.forEach((sample,i)=>sample.after=values[i][sample.action]); });
      this.lastUpdate = reading;
    }
    this.loss = loss; this.updates++;
    if(!this.advanced) { if(this.updates%200===0)this.target.setWeights(this.online.getWeights()); }
    else tf.tidy(()=>{ const online=this.online.getWeights(); this.target.setWeights(this.target.getWeights().map((weight,i)=>weight.mul(.995).add(online[i].mul(.005)))); });
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
