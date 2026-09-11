# Frozen comparison baseline

This is the browser learner and simulation copied before the plateau investigation changes on 2026-09-11. It is not imported by the game. It preserves the previous 36-input network, one-step Double DQN, rewards, exploration and track geometry for repeatable before/after measurements.

From the repository root:

```sh
node --experimental-strip-types experiments/plateau-baseline/benchmark.mjs 60000 42 /tmp/baseline-42.json
node --experimental-strip-types scripts/benchmark-plateau.mjs 60000 42 adaptive /tmp/candidate-42.json
```

Both use tracks 0/1/2, three-lap attempts, alternating grid/varied starts, balanced track memory and the specified number of training decisions. The final policy is evaluated without exploration from the same five starts on every track. Tracks 3/4 are held out from training. Scores across different rewards are not comparable; compare completion and progress. This benchmark evaluates final weights, not the best-of-training checkpoint.

The Node process runs the same JavaScript/TensorFlow.js CPU code as the browser. It is a repeatable test runner, not a Python or server-side training feature in the app.
