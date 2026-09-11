import test from 'node:test';
import assert from 'node:assert/strict';
import * as tf from '@tensorflow/tfjs';
import { DQNAgent, initializeTensorflow } from '../lib/rl/agent.ts';
import { DrivingEnvironment } from '../lib/rl/environment.ts';
import { DecisionLab } from '../lib/rl/decision-lab.ts';
await initializeTensorflow();
test('network readings match inference without changing weights, randomness or tensor count', () => {
  const a = new DQNAgent(42),
    b = new DQNAgent(42),
    state = new DrivingEnvironment(0).observe();
  try {
    const count = tf.memory().numTensors,
      weights = JSON.stringify(a.exportWeights());
    for (let i = 0; i < 20; i++) {
      const reading = a.inspect(state);
      assert.deepEqual(
        reading.hidden.map((layer) => layer.length),
        [64, 64],
      );
      assert.equal(reading.inputs.length, 52);
      assert.equal(
        reading.values.indexOf(Math.max(...reading.values)),
        a.act(state),
      );
      assert.equal(a.act(state, true), b.act(state, true));
      assert.equal(a.lastExploratory, b.lastExploratory);
    }
    assert.equal(tf.memory().numTensors, count);
    assert.equal(JSON.stringify(a.exportWeights()), weights);
  } finally {
    a.dispose();
    b.dispose();
  }
});
test('diagnostic sampling preserves the exact gradient update and reports real predictions', () => {
  const a = new DQNAgent(42),
    b = new DQNAgent(42),
    state = new DrivingEnvironment(0).observe();
  a.captureLearning = true;
  try {
    for (let i = 0; i < 256; i++) {
      const e = {
        track: 0,
        state,
        action: i % 9,
        reward: (i % 3) - 1,
        next: state,
        done: i % 4 === 0,
      };
      a.remember(e);
      b.remember(e);
    }
    a.train();
    b.train();
    assert.deepEqual(a.exportWeights(), b.exportWeights());
    assert.equal(a.lastUpdate.samples.length, 8);
    assert.equal(a.lastUpdate.batchSize, 32);
    assert.equal(a.lastUpdate.update, 1);
    const outputs = a.inspect(state).values;
    for (const row of a.lastUpdate.samples) {
      assert.equal(row.after, outputs[row.action]);
      if (row.terminal)
        assert.ok(Math.abs(row.target - row.reward * 0.01) < 1e-7);
      assert.ok(Number.isFinite(row.prediction));
    }
  } finally {
    a.dispose();
    b.dispose();
  }
});
test('walkthrough and best comparison are frozen and do not mutate the learner', () => {
  const agent = new DQNAgent(42),
    best = new DQNAgent(9),
    weights = JSON.stringify(agent.exportWeights()),
    lab = new DecisionLab(agent, best, 2, 'local', 3, 1, 1 / 3);
  try {
    const first = lab.read();
    assert.equal(first.source, 'walkthrough');
    assert.deepEqual(
      first.bestValues,
      best.inspect(lab.environment.observe()).values,
    );
    assert.equal(first.after, null);
    const next = lab.read(1, true);
    assert.equal(next.manual, true);
    assert.ok(next.after.time > 0);
    assert.equal(next.action, 1);
    assert.equal(next.before.time, 0);
    assert.equal(agent.steps, 0);
    assert.equal(agent.updates, 0);
    assert.equal(agent.replay.length, 0);
    assert.equal(JSON.stringify(agent.exportWeights()), weights);
    const frozen = lab.read().network;
    agent.loadWeights(best.exportWeights());
    assert.deepEqual(lab.read().network, frozen);
  } finally {
    lab.dispose();
    agent.dispose();
    best.dispose();
  }
});
