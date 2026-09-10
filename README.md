# Pocket Circuit

A top-down, single-car Three.js racer with three closed circuits and 1–10 lap races.

![Pocket Circuit showing the Park Oval track, ray sensors, and circuit selection menu](docs/images/pocket-circuit.png)

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by the dev server. Requires WebGL and hardware acceleration.

## Controls

- Up: accelerate
- Down: brake, then reverse
- Left / right: progressive steering while moving. Hold for 0.35 seconds to reach full lock; short taps make small corrections.
- Escape: pause or resume
- R: return to the nearest point on the track

Choose a circuit and lap count, then start the race. Follow the painted arrows clockwise. Top speed on asphalt is 200 on the km/h display. Grass slows the car and does not earn lap progress. Losing window focus pauses an active race. Touch controls are available on narrow screens.

## Checks

```sh
npm run build
npx tsc --noEmit
node --experimental-strip-types --test tests/*.test.mjs
```

Park Oval uses a closed cubic B-spline. Pine Bend has 12 corners with radius 8. Desert Switchback has an asymmetric outer section with diagonal bends and three infield hairpins. Its road is 30% narrower and its corner radius is 5.5, requiring slower turns and more precise positioning. Straight sections meet tangent circular corners without folded kerbs. Asphalt, kerbs, shoulders, start-line width, sensor boundaries, off-road slowdown, and lap validation all follow each circuit's road scale. Camera framing, movement limits, and menu previews fit each circuit. The road, kerbs, shoulders, menu maps, and ray boundaries share that geometry. Geometry tests check that offset edges never reverse direction or intersect themselves.

Track definitions and lap logic are in `lib/race.ts`; rendering is in `lib/engine.ts` and shared driving physics are in `lib/vehicle.ts`. The orthographic camera presents the Three.js scene as a 2D game. All game assets are generated geometry, with no external image downloads.

The optional `start_race` WebMCP action uses the selected race settings. It is feature-detected and does not affect normal keyboard play. No supported browser WebMCP validation context was available during development.

## Ray sensors

Rays are on by default. The foldable debug menu on the right displays readings while driving and retains them while paused. **Hide rays** hides the drawing only; sensing and readouts continue.

- Nine front rays use angles −75°, −50°, −30°, −15°, 0°, +15°, +30°, +50°, +75°, with fixed ranges of 10, 16, 24, 30, 32, 30, 24, 16, 10 world units.
- Three rear rays use angles −135°, 180°, +135°, with ranges of 10, 16, 10 units.
- Angles are relative to the car's nose; positive means right. Front origins sit 1.65 units ahead of the center, rear origins 1.65 units behind. Distances are measured from these bumper origins, not from the car center.
- Both asphalt boundaries come from the same offset geometry as the visible road. Exact 2D ray/segment intersections return the nearest forward crossing within range, including when the car is off-road. Kerbs, center markings, scenery, and the car itself are not sensor targets.
- Solid lines end at the measured point; white dots indicate hits. Faint dashed extensions show the remaining fixed range. Gray dots mean no edge was found within range. IDs at the range tips match the table.

`lib/sensors.ts` contains the pure sensing function and the fixed `RAY_DEFINITIONS` configuration. `senseTrack(position, headingRadians, edges)` returns readings in stable F1–F9, B1–B3 order. Each includes `distance`, `maxRange`, `normalizedDistance`, `hit`, `origin`, `end`, and `limit`. A miss returns the maximum distance, normalized value 1, and `hit: false`; a boundary exactly at maximum range has `hit: true`. Distances use the game's world units, not calibrated meters.

The engine calculates readings after movement each frame and publishes the same readings through `RaceStats.rays` to the UI about 15 times per second. Resetting or changing a circuit updates readings immediately. The sensing function also supplies the browser reinforcement-learning environment.

The debug menu also shows accelerator and brake/reverse positions, car position in world X/Z coordinates, heading in degrees clockwise from +X, steering input from -1 to +1, and a virtual steering-wheel angle. Steering uses a nearly linear exponential curve with exponent 0.35, reaching full lock in 0.35 seconds from center. Releasing the key returns linearly to center in at most 0.12 seconds; changing direction passes through center before ramping into the opposite turn. Both arrow keys together request centered steering. Keyboard auto-repeat does not restart the ramp. The same smoothed value drives turning and the wheel display. The wheel display maps full left/right steering to -90°/+90°; it is an input visualization, not a physical steering-rack angle. Pedals and steering use the same input values as the driving logic, and return to zero on pause or reset. Folding the menu does not stop the simulation or sensors.


## Reinforcement learning in the browser

Choose **Train AI → Start training**. Training runs locally in JavaScript using TensorFlow.js in a Web Worker with the CPU backend. No Python training server, API key, GPU, cross-origin isolation, or external model download is required. Start with Park Oval and use Fastest for long runs. Lower speeds let you watch individual attempts; evaluation runs as quickly as the device allows and playback runs in real time.

Pause retains weights, optimizer state, replay memory, the current attempt, and any partial evaluation in this tab. Run best model performs inference without updating the learner. Resume training continues the preserved learning session. Hiding the tab pauses the worker. Switching circuits, creating another session, or refreshing ends the live session; saved model weights remain available.

### Models across circuits

Open **Models & experiments**, choose any saved model, then **Load on [selected circuit]**. Models are not restricted to their training track. Loading copies the weights, clears the source evaluation score, and runs the five-start evaluation on the selected circuit. You can play that model there or continue training it with a fresh optimizer and replay buffer. The source save remains unchanged; fine-tuned copies retain their parent ID and training-track history.

Version 1 models remain in their original browser-storage keys. Loading one adds six zero-weight input rows to its first layer, preserving its original predictions under the corrected-baseline observations. New history features can acquire weights during subsequent training. These older models retain their position-aware baseline preset; they do not silently become local-input models. Incompatible saves are not overwritten.

New checkpoints use observation/model version 2 and are saved by model ID, not a single slot per circuit. Experiment preset, seed, parent, trained tracks, episode and target evaluation travel with the weights. Browser storage failures are reported and the current page retains the in-memory models. Different browsers and origins have separate libraries. Optimizer state, replay memory and unfinished comparisons are not persisted. Completed comparison rows are persisted after each run.

Successful loading does not imply successful driving on a different circuit. Transfer performance is measured on the destination track.

### Inputs and shared physics

The network has 34 input slots. The original 28 slots contain twelve normalized ray distances, speed, smoothed steering, accelerator, brake, signed lateral road offset, relative heading sine/cosine, off-road state, normalized X/Z, absolute lap-position sine/cosine, relative map headings 5/12/24 world units ahead, and off-road duration.

Six additional slots expose reward and termination history: elapsed time, stalled time, signed accumulated progress, distance back to the furthest rewarded progress, checkpoint count, and signed relative distance to the next checkpoint. Signed progress and recovery distance use bounded, invertible normalization. The **Local inputs** preset masks the four absolute X/Z and lap-position slots to zero; relative task progress remains available. Road-heading lookahead is still map knowledge, so this is map-assisted rather than sensor-only driving.

The nine actions combine accelerate/coast/brake with left/straight/right steering. Decisions occur every 0.1 simulated seconds, each advancing six 1/60-second steps through the same progressive steering and vehicle dynamics as manual driving.

### Default rewards

| Event | Local-input preset reward |
| --- | ---: |
| Full forward circuit through three checkpoints | +1,000 |
| New forward road progress | +750 spread over one track length |
| Extra speed bonus | None |
| Off-road travel | −50 per simulated second |
| Reverse road progress | −750 per track length |
| Time | −1 per simulated second |
| Failure or timeout | −100 |

Forward progress uses a high-water mark and is capped to one circuit's distance. Driving the same segment repeatedly cannot earn repeated progress points. Off-road travel earns no progress. Time penalties use actual physics time, including partial terminal decisions. Episodes end after a full circuit, one continuous second off-road, moving more than three units beyond the road edge, six seconds without forward progress, or 90 simulated seconds. Road state is measured at the car center.

Normal training and playback start at the finish line. Evaluation starts elsewhere require a full loop back to that start, not a shorter run to the painted line. Checkpoints are relative to the starting position.

### Evaluation and best models

Every evaluation uses the same five poses: normal start line, left/right offsets of 0.8 units with heading offsets of 0.10 radians, and starts one-third/two-thirds around the circuit with smaller offsets. Exploration and gradient updates are disabled. These tests are independent of the learner's random-number stream.

The dashboard separates exploratory training completion from evaluation completion. Evaluation reports success rate across five runs, mean progress, mean off-road time across all runs, successful lap time, and individual attempts. If no lap finishes, lap time is shown as unavailable, not zero. Evaluation occurs after episode 1, every ten episodes, and at the end of a comparison budget. You can also evaluate the saved best model explicitly.

Within one preset and circuit, best selection prioritizes completion rate, then mean reward. Reports every 100 episodes contain the best evaluation score and success rate. Five fixed poses are a small repeatable evaluation suite, not a guarantee of robustness to every start or unseen layout.

### Controlled P1/P2 comparisons

The browser's **Controlled comparison** runs four sequential experiment stages with independent training seeds 42, 1337 and 2026. All twelve runs start from random weights, use the same training start and episode budget, and use the same five evaluation poses. Pause/resume is supported. Saved models are retained.

| Stage | Change relative to previous stage |
| --- | --- |
| Corrected baseline | Original speed/position-aware setup, with explicit history inputs and five-start evaluation |
| Remove speed bonus | Remove only the extra speed reward |
| Normalize progress | Scale forward and reverse progress by circuit length |
| Local inputs, default | Mask only absolute X/Z and absolute lap-position inputs |

Final-policy evaluation at the chosen episode budget is recorded separately from saved best checkpoints. Tables aggregate the three seeds and show per-seed results. Compare completion rate, off-road time and successful lap time across stages; raw reward scales differ. Episode budgets match, but decision counts can differ because attempts have different lengths; counts are reported. Short budgets test the pipeline but cannot establish which configuration learns best. A new comparison replaces the displayed report for this track; exported source code includes the headless comparison command below for reproducible JSON reports.

### Learner and checks

Double DQN uses two 64-unit ReLU layers and nine outputs, Adam at 0.0005, a 20,000-transition replay buffer, batches of 32, discount 0.995, and updates every four decisions after 256 warm-up experiences. The target network synchronizes every 200 updates. Huber loss uses rewards scaled by 0.01 internally; scores retain their original points. Exploration decays over 16,000 decisions to a 4% floor. Random pedals favor acceleration 70%, coast 20%, and brake 10%; random steering is balanced. There is no scripted driving controller.

```sh
node --experimental-strip-types --test tests/*.test.mjs
node --experimental-strip-types scripts/train-smoke.mjs 100 0
# All four stages, three seeds, identical evaluation starts; optional JSON output.
node --experimental-strip-types scripts/compare-training.mjs 400 0 /tmp/comparison.json
# After npm run build, test the actual bundled worker and cross-track transfer.
node scripts/worker-smoke.mjs
```

Checks cover reward history, normalization, full laps from varied starts on all circuits, checkpoint exploits, evaluation aggregation, legacy prediction preservation, inference and fine-tuning across tracks, tensor cleanup, and worker pause/play/resume and comparison scheduling. The worker smoke check uses Node with browser-like globals; it is not a browser UI test.
