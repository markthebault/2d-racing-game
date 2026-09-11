# Investigating the 60% plateau

The reported table describes a saved-best checkpoint, not every subsequent learner. With three selected tracks and five evaluation starts each, 60% means 9 of 15 three-lap races completed. The screenshot alone cannot tell which circuits failed, and the user's trained weights were not available to the local test runner. This investigation therefore tests the implementation from reproducible fresh seeds; it does not claim to reproduce that exact checkpoint.

## What the audit found

- The old forward ray ends at 32 world units, and its furthest road-heading input is 24 units ahead. Rays show boundaries but do not explicitly describe the route through a bend or the speed needed to follow it.
- Maximum yaw rate is 1.85 radians/second. At 40 units/second the minimum turning radius is about 21.6 units, while the tightest centerline bends have radius 5.5. Braking before the bend matters more than accelerating through it.
- A single-step TD update gives delayed feedback for a sequence of late-braking decisions. The former target network also changed abruptly every 200 updates.
- A failure cost 100 points against a 1,000-point finish bonus plus another 1,000 checkpoint points per lap. This does not establish that the reward caused the plateau, but it motivates testing earlier feedback about unsafe speed.
- Interleaved scores from different tracks naturally create a sawtooth chart. They should be inspected by track. The best-model table alone cannot distinguish forgetting, lack of improvement, or one difficult track.
- Five layouts and fifteen selected-track evaluation attempts are too small to establish general driving ability on arbitrary future circuits.

## Research used

[Gymnasium CarRacing](https://gymnasium.farama.org/environments/box2d/car_racing/) rewards newly visited road tiles and penalizes elapsed time. This supports retaining our existing non-repeatable forward-progress rewards rather than adding rewards merely for wheel speed.

[AWS DeepRacer action spaces and rewards](https://docs.aws.amazon.com/solutions/latest/deepracer-on-aws/action-space-reward-function.html) treats steering and speed jointly. Our implementation adds explicit local road geometry and a braking-aware speed estimate derived from this game's yaw and braking dynamics.

[Rainbow](https://arxiv.org/abs/1710.02298) studies extensions to DQN including multi-step learning. We tested three-step Double DQN returns, gradient clipping and smooth target updates as an experimental package. It did not consistently improve completion, so it is not the default. This is not a full Rainbow implementation; it has no distributional head, noisy network or prioritized TD-error replay.

[Procgen](https://proceedings.mlr.press/v119/cobbe20a.html) shows the importance of varied environment distributions for training and evaluating generalization. We retain mixed-track training and varied starts, and add an explicit held-out evaluation that cannot influence model selection. Procedurally generated, geometry-validated training tracks remain a useful next experiment.

## Implemented changes

The default remains **Local inputs**, now with 52 observations. Sixteen appended features describe four car-relative waypoint positions, road width, a corner-speed estimate, movement-window information, forward-ray travel time, yaw rate and steering command. The first 36 retain their order. This is map-assisted driving. Rays alone cannot reliably distinguish the intended route through every bend, and the complete rolling motion history is still not observed.

A real checkpoint bug rejected valid progress on inside corners. The centerline arc can advance more than twice as far as the car travels along the inner edge. Closest-point projection onto sampled chords also jumps at chord boundaries. The progress bound now accounts for curvature and that discretization error. Shortcut and repeat-checkpoint protections remain tested. Displayed progress cannot reach 100% without completing the requested race.

New sessions enable **Guided warm-up before RL**. A geometric instructor labels 12,000 varied states on only the selected training tracks. The network learns them in 4,000 supervised updates, then continues Double DQN with a demonstration cross-entropy loss to reduce forgetting. This is imitation learning followed by reinforcement learning, not pure RL. The instructor never chooses actions during model evaluation or playback. The initial network is evaluated before RL and can become the saved best at episode zero.

[Deep Q-learning from Demonstrations](https://arxiv.org/abs/1704.03732) combines demonstrations, temporal-difference learning and a supervised objective. It inspired this approach; our implementation is not a reproduction of that paper. We use cross-entropy warm-up and a supervised regularizer during RL, without prioritized replay.

The optional **Corner rewards** preset adds penalties for unsafe speed, edge proximity and misalignment, raises failure cost to 250, and enables the experimental optimizer package. It remains available for experiments, but the results below do not justify recommending it over the default reward. Checkpoint and finish bonuses remain unchanged.

Saved 28/34/36-input models receive zero-weight new rows, preserving predictions before further training. Old evaluations are invalidated. Existing saves remain intact. Loading a model leaves guided warm-up disabled; enable its checkbox to teach the loaded network on the selected circuits.

The UI filters charts by circuit, reports evaluation failure causes and offers **Test all 5 tracks**. That check uses a frozen best-model snapshot and records held-out results separately. It does not update weights, replay memory or best selection. Warm-up progress and lesson loss are displayed separately from RL training loss.

## Test protocol

Before/after runs use the same seed, 60,000 training decisions, tracks 0/1/2, three requested laps, balanced replay memory and alternating grid/varied starts. Final weights are evaluated without exploration on five fixed starts per track. Tracks 3/4 are never trained on. Two seeds are tested. This tests the combined candidate; it does not isolate the contribution of each change.

The baseline source is retained in `experiments/plateau-baseline`. The candidate runner is `scripts/benchmark-plateau.mjs`. Both use JavaScript and TensorFlow.js CPU execution, matching the browser learner. Wall-clock times are affected by concurrent local tests and are not performance benchmarks.

A geometric reference driver completed all 25 three-lap attempts across the five layouts. This establishes physical drivability, not learned performance. Its policy now also supplies training labels for the explicitly labelled guided mode. It is never used for neural model evaluation or playback.

## Results

All counts below refer to completed three-lap races. Training tracks have 15 tests, held-out tracks have 10. These are final policies, not checkpoints selected using held-out results.

| Run | Seed | Training tracks | Held-out tracks |
| --- | ---: | ---: | ---: |
| Original RL, 60,000 decisions | 42 | 7/15 | 10/10 |
| Original RL, 60,000 decisions | 1337 | 5/15 | 5/10 |
| Experimental reward/optimizer package, 60,000 decisions | 42 | 6/15 | 7/10 |
| Experimental reward/optimizer package, 60,000 decisions | 1337 | 0/15 | 0/10 |
| Same experimental seed-42 weights, corrected lap accounting | 42 | 8/15 | 8/10 |
| Prototype supervised warm-up only | 42 | 15/15 | 10/10 |

The original and first experimental runs predate the lap-accounting correction. They are historical diagnostics, not a clean ablation of the final implementation. The prototype warm-up also predates the final chord correction. The current runners use the corrected environment. Original source is frozen under `experiments/plateau-baseline`; raw results are in `docs/benchmarks`.

The guided learner is tested separately before and after 10,000 further RL decisions, using the shipped `DrivingCoach` implementation and original local rewards. The first regularizer used a margin of 0.8 and weight 0.5. Both seeds completed 25/25 immediately after warm-up, but after RL seed 42 fell to 4/15 training and 3/10 held-out completions, and seed 1337 fell to 1/15 and 0/10. The successful warm-up networks remained usable fallback policies, but this exposed substantial learner forgetting. Those raw results are retained as `guided-margin-*`.

The revised regularizer uses cross-entropy on demonstrated actions with weight 5. Seed 42 retained 15/15 training-track and 10/10 held-out completions after 10,000 RL decisions. That retention run reused the successful seed-42 prototype warm-up weights; its before-RL evaluation again completed all 25 races. The reproducible runner can also generate the warm-up from scratch.

Seed 1337 was trained fresh with the shipped coach. It completed all 25 races after warm-up and retained 11/15 training-track and 8/10 held-out completions after RL. Forgetting is reduced, not eliminated.

The app saves the successful warm-up checkpoint separately from later improved RL models, so it remains available as a fallback. Best selection protects training-set completion; it cannot guarantee held-out completion. The table below distinguishes these from the final learners.

| Revised guided learner | Seed 42 | Seed 1337 |
| --- | ---: | ---: |
| After supervised warm-up, all five circuits | 25/25 | 25/25 |
| Latest learner after 10,000 RL decisions, training circuits | 15/15 | 11/15 |
| Latest learner after 10,000 RL decisions, held-out circuits | 10/10 | 8/10 |
| Successful warm-up checkpoint, all five circuits | 25/25 | 25/25 |

The guided instructor targets at most 16 world units/second, prioritizing completion over top speed. This test does not establish that RL improved on the instructor. It establishes a usable learned starting policy, transfer to the two excluded layouts, and partial retention during further RL. For longer training, monitor per-track completion and use the saved best policy; reduced learning rates or restoring a prior checkpoint after regression are further experiments, not validated fixes in this change.

The real Chromium UI completed guided warm-up, paused/resumed correctly, advanced live RL updates, and evaluated the saved neural checkpoint at 25/25 across all five circuits. The transfer check left learning counters unchanged while paused. Desktop and mobile layouts were inspected, with no horizontal mobile overflow or browser errors.

[Browser transfer-check screenshot](screenshots/transfer-check.png)


## Limits and next experiments

Two held-out handcrafted layouts do not establish arbitrary-track driving. They were used repeatedly as development validation, so they are not an untouched final test set. They were excluded from instructor examples, replay memory and automatic best-model selection. The strongest next evaluation is a large generated-track set with validated road geometry, split into fixed training and held-out layouts. New tracks must obey the car's physical turning limits. Broader randomized speeds, widths and grip would test robustness beyond layout transfer. Continuous-action SAC or PPO is another possible comparison, but replacing DQN without a matched benchmark would not establish an improvement.

The score plateau alone did not identify a bad reward. Diagnostics uncovered both a measurement bug and weak learned cornering. More rays alone would not address either. The default retains non-repeatable progress rewards and completion-first best-model selection; guided examples give the network a usable starting policy.

## Validation and reproduction

The final source passes 63 automated tests, TypeScript checking, focused lint and the production build. The browser test covers complete warm-up, pause/resume, live RL, held-out evaluation, per-track charts, and desktop/mobile layout. Worker tests cover legacy migration, independent playback, immutable saved models and comparison runs.

```bash
node --experimental-strip-types --test tests/*.test.mjs
node --experimental-strip-types scripts/guided-benchmark.mjs 42
node --experimental-strip-types scripts/guided-benchmark.mjs 1337
npm run build
node scripts/guided-worker.mjs
node scripts/plateau-browser.mjs
```

Production learning runs in a browser Web Worker using TensorFlow.js CPU. Node runs the same JavaScript code for repeatable local benchmarks. No Python training service is used.
