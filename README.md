# Pocket Circuit

A top-down, single-car Three.js racer with five closed circuits and 1–10 lap races.

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

Choose **Train AI → Start training**. Training runs locally in JavaScript using TensorFlow.js in a Web Worker with the CPU backend. No Python training server, API key, GPU, cross-origin isolation, or external model download is required. New sessions train across Park oval, Pine bend and Desert switchback with guided warm-up enabled. Choose your lap count and use Fastest for long runs. Training speed changes how quickly attempts are collected; best-model playback runs in real time.

Pause retains weights, optimizer state, experience memory, the current attempt, evaluation, and group replay position in this tab. Run best model drives a frozen snapshot while the learner continues training independently. Playback experiences never enter the learning buffer. Pause all and Resume all control learning and playback together. Hiding the tab pauses the worker. Creating another session or refreshing ends the live session; saved model weights remain available.

### How the car learns

The default has two learning phases:

1. **Guided warm-up.** A geometric instructor labels 12,000 randomized driving states on the selected training tracks. A 52-input neural network learns the instructor's nine possible actions with cross-entropy loss, batches of 64 and Adam at 0.001 for 4,000 updates. The instructor targets at most 16 world units/second and slows for corners. It supplies training examples only.
2. **Reinforcement learning.** The network observes the road and car state, chooses steering and a pedal action, drives for 0.1 simulated seconds, then receives a reward. Double DQN learns from stored transitions containing the observation, action, reward, next observation and termination flag. A supervised loss on instructor examples continues alongside the reward-based loss to reduce forgetting.

The network architecture is **52 inputs → 64 ReLU units → 64 ReLU units → 9 action values**. During RL, each output estimates the discounted future reward for an action. Double DQN uses the online network to choose the next action and a delayed target network to value it. Exploration occasionally chooses a random action; evaluation and playback choose the highest-valued action without exploration.

The default RL objective is:

```text
TD target = 0.01 × reward + 0.995 × target_Q(next_state, argmax online_Q(next_state))
            # the future-value term is zero for terminal transitions
loss = Huber(TD target, Q(state, action)) + 5 × demonstration cross-entropy
```

The demonstration term is present only when instructor examples are available. Disable **Guided warm-up before RL** before starting to learn solely from rewards. Controlled P1/P2 comparisons also disable demonstrations. The default guided method combines imitation learning with reinforcement learning; model playback always uses the network alone. The warm-up checkpoint is evaluated before episode 1 and kept as a separate library entry when subsequent RL produces a better model.

An **episode** is one driving attempt, ending after the requested laps, a failure or timeout. It is different from a gradient update: the 4,000 warm-up updates are not 4,000 driving episodes. Warm-up loss measures action-label prediction; RL loss combines reward-value error and the demonstration term. Neither is driving accuracy. **Evaluation success** measures the fraction of complete races, including every requested lap. Training scores include exploration and should be filtered by circuit when comparing progress.

### See how the AI learns

Open **Train AI → See how the AI learns** for a visual explanation connected to the real learner. Three views keep the explanation manageable:

![Live neural-network view with grouped inputs, two 64-neuron activation grids and nine action values](docs/screenshots/learning-network.png)

- **Decision** shows a road close-up with the actual ray intersections, the nine action values, whether the action came from the network or random exploration, and the points actually earned by that step. Switch to the whole-circuit view for context. Before RL has trained, outputs are labelled as uncalibrated action scores.
- **Network** groups the 52 inputs and shows all 64 neurons in each hidden layer as compact activation grids, followed by the nine outputs. Click an input group and expand its details to inspect the normalized values. Brightness is relative within each layer. It shows activation, not feature importance or a causal explanation. Structural arrows avoid drawing thousands of overlapping connections.
- **Learning update** shows eight of the actual 32 replay experiences sampled for an optimizer update. Select one to compare its predicted action value before the update, its learning target, and its value afterward. Expanded details separate the reward-value loss from the weighted demonstration loss. These samples can come from earlier decisions and different training circuits. The displayed batch stays still while learning continues; use **Refresh sampled update** to inspect a newer one.

[View the decision walkthrough](docs/screenshots/learning-decision.png).

**Walk through a run** pauses learning and playback, copies the current learner into an isolated environment on the viewed circuit, and freezes its weights. Choose the finish line or a position one-third/two-thirds around the circuit. Select a pedal/steering action, or accept the network's choice, then advance by 0.1 simulated seconds. The copy uses the real physics and reward rules but never contributes experiences or gradient updates. A manual choice is labelled separately from a network choice. **Resume learning** discards the copy and continues the original session. Closing the walkthrough leaves the session paused until resumed.

If a saved best model exists, the Network view can compare its action values with the learner's using exactly the same inputs. This is a comparison of preferences in one situation, not a full-race benchmark. Use the existing evaluation and playback controls to compare driving success.

Live diagnostics are opt-in and sampled at most four times per second. Opening the panel does not consume the training random-number stream or alter gradient results. During guided warm-up the panel explains instructor learning; replay-update data appears only after actual RL updates. The views use real readings rather than illustrative, fabricated training numbers.

Browser and worker checks for this feature, after building and starting the preview:

```sh
node scripts/insights-browser.mjs
node scripts/insights-worker.mjs
```

### Fifty-car replays

Each episode is one driving attempt. The circuit stays empty while attempts 1–50 are recorded, then the recorded cars replay their actual paths together, filtered to the viewed circuit at real-time speed. A separate replay-speed control offers 2×, 4× and 8×. Each car stops at its own endpoint; failed cars dim while longer runs continue. Learning continues during the replay, including scheduled evaluations. The next group shows attempts 51–100, then 101–150, and so on. Evaluations do not enter these recordings.

The panel shows the recording count, replay time and number of cars still driving. Pause all freezes both learning and replay; Skip this replay advances the display without changing training. Run best model remains available and replaces the group display. The display retains its active group and up to two waiting groups, plus the group being recorded. If learning outruns playback, older waiting groups are replaced by newer ones; the UI reports skipped groups. Recordings stay in memory, not browser storage. Three.js renders the fleet with instanced car parts.

### Models across circuits

In the default three-track mode, the circuit menu changes the view only. Episodes rotate across the selected training set; use **Training circuits → Apply training setup** to change which circuits teach the shared model. Selected tracks share one learner, with balanced experience sampling. The two unselected layouts can be evaluated without adding their experiences to training.

In single-track mode, selecting another circuit transfers the live weights to that destination, restarts the attempt and evaluates again. Active learning then resumes there. A new training setup rebuilds instructor examples when guided warm-up is enabled. Changing settings ends an active controlled comparison so its results cannot silently mix different experiments.

Open **Models & experiments**, choose any saved model, then **Load on [selected circuit]**. Loading copies the weights into a new session with the default three-track training set and evaluates them across that set. The selected circuit determines the view and playback destination. Change the training setup if you want a different set or one circuit. Loaded sessions start with fresh optimizer and replay memory, and guided warm-up is initially off; enable it to teach the loaded network using the selected tracks. The source save remains unchanged, and copies retain their parent ID and training-track history.

Version 1 models remain in their original browser-storage keys. Loading one adds zero-weight input rows to its first layer, preserving its original predictions under the corrected-baseline observations. New history features can acquire weights during subsequent training. These older models retain their position-aware baseline preset; they do not silently become local-input models. Incompatible saves are not overwritten.

New checkpoints use observation version 4 and model format version 2 and are saved by model ID, not a single slot per circuit. Experiment preset, seed, parent, trained tracks, episode and target evaluation travel with the weights. Browser storage failures are reported and the current page retains the in-memory models. Different browsers and origins have separate libraries. Optimizer state, replay memory and unfinished comparisons are not persisted. Completed comparison rows are persisted after each run.

Successful loading does not imply successful driving on a different circuit. Transfer performance is measured on the destination track.

### Inputs and shared physics

All 52 observation slots have a stable order, shared by training and playback. Indices below are zero-based.

| Slots | Count | ML features | Purpose |
| --- | ---: | --- | --- |
| 0–11 | 12 | Front/rear ray distance divided by each ray's range | Sense nearby road boundaries |
| 12–15 | 4 | Speed / 40, smoothed steering, accelerator and brake | Describe current motion and controls |
| 16–19 | 4 | Signed lateral offset / road half-width, relative heading sine/cosine, off-road flag | Locate and orient the car relative to the road |
| 20–23 | 4 | Normalized X/Z and absolute lap-position sine/cosine | Position-aware comparison features; **zeroed in Local inputs and Corner rewards** |
| 24–27 | 4 | Relative map headings 5/12/24 units ahead and off-road duration | Anticipate turns and termination |
| 28–31 | 4 | Elapsed-time fraction, stalled-time fraction, signed progress, distance behind furthest rewarded progress | Expose reward and termination history |
| 32–35 | 4 | Checkpoint fraction, relative distance to next checkpoint, completed-lap fraction, requested laps / 10 | Track the current race objective |
| 36–43 | 8 | Car-relative forward/lateral waypoint coordinates 4/8/16/32 units ahead, scaled by lookahead distance | Describe upcoming road shape |
| 44–45 | 2 | Road half-width / 5, estimated safe corner speed / 40 | Adapt to narrow roads and braking distance |
| 46–48 | 3 | Recent net movement, movement-window age, minimum movement threshold / 5 | Detect blocked or oscillating behavior |
| 49–51 | 3 | Forward-ray travel-time estimate, normalized yaw rate, requested steering | Relate obstacles and steering response to speed |

Signed accumulated progress, recovery distance and recent movement use bounded `x / (1 + abs(x))` normalization. The full rolling position history is not observed. Heading, waypoints and corner-speed estimates use known circuit geometry, so this is **map-assisted driving**, not a ray-only policy. Inputs describe local road shape across tracks, but feature sharing alone does not guarantee generalization.

The nine actions combine accelerate/coast/brake with left/straight/right steering. Decisions occur every 0.1 simulated seconds, each advancing six 1/60-second steps through the same progressive steering and vehicle dynamics as manual driving.

### Checkpoints and multiple laps

Choose 1–10 laps in the paddock before or during AI training. Training, best-model playback, five-start evaluation, and the 50-car recordings all use that race distance. Changing it restarts the unfinished attempt and visual group, clears destination scores, and evaluates again while retaining the learner and experience memory.

Cyan lines marked CP 1, CP 2, and so on divide each circuit. Easy has four checkpoints worth 250 points each, medium six worth 166⅔ each, and hard eight worth 125 each. These interior checkpoints share 1,000 points per lap. Crossing the finish line after all of them adds another 1,000 points. The existing progress rewards and penalties still apply.

Checkpoints must be crossed forward, on-road, in order, with enough valid driving progress. A checkpoint cannot pay twice in the same lap. Only completing that lap unlocks its checkpoints for the next one. Three laps therefore offer 3,000 checkpoint points and 3,000 finish bonuses, plus progress rewards and penalties. Passing the finish line after lap one or two does not end a three-lap attempt.

Observation slots 34 and 35 encode completed-lap fraction and requested lap count. Older 28-, 34- and 36-input models load with zero-weight rows added, retain learned weights, and receive fresh evaluation scores under these rules. Completion metrics now mean the entire requested race; successful mean lap time divides completed-race time by its lap count. Varied-start evaluations place their checkpoint sequence relative to each test start and require the full requested distance back to that start.

### Default rewards

| Event | Local-input preset reward |
| --- | ---: |
| Each full forward lap after all its checkpoints | +1,000 |
| New forward road progress | +750 spread over one track length |
| Each checkpoint, once per lap | +1,000 divided by checkpoint count |
| Extra speed bonus | None |
| Off-road travel | −50 per simulated second |
| Reverse road progress | −750 per track length |
| Time | −1 per simulated second |
| Failure or timeout | −100 |

For example, one clean easy-track lap can earn 4 × 250 checkpoint points + 1,000 finish points + 750 progress points = 2,750 points before time and other penalties. Standing still or repeatedly crossing the same checkpoint cannot earn these points.

Forward progress uses a high-water mark and is capped to the requested race distance. Driving the same segment repeatedly cannot earn repeated progress points. Off-road travel earns no progress. Time penalties use actual physics time, including partial terminal decisions. Episodes end after the requested number of full laps, one continuous second off-road, moving more than three units beyond the road edge, net movement below the selected minimum over one simulated second, six seconds without forward progress, or 90 simulated seconds per requested lap. Road state is measured at the car center.

Grid-start training and normal playback start at the finish line. Varied training and evaluation starts require a full loop back to that start, not a shorter run to the painted line. Checkpoints are relative to the starting position.

**Run best model** allows five continuous seconds off-road to recover. Its distance-from-road cutoff is disabled, and the older forward-progress timer cannot shorten that off-road grace period. The new minimum-movement rule still ends stuck playback after one second. Returning to the road resets the grace period. The time limit of 90 seconds per requested lap still applies. Training and five-start evaluations retain the stricter one-second and distance limits, so evaluation scores remain comparable.

### Evaluation and best models

Every evaluation uses the same five poses: normal start line, left/right offsets of 0.8 units with heading offsets of 0.10 radians, and starts one-third/two-thirds around the circuit with smaller offsets. Exploration and gradient updates are disabled. These tests are independent of the learner's random-number stream.

The dashboard separates exploratory training completion from evaluation completion. Evaluation reports success rate across five runs, mean progress, mean off-road time across all runs, successful lap time, and individual attempts. If no full race finishes, lap time is shown as unavailable, not zero. Evaluation occurs after guided warm-up, after episode 1, every ten episodes, and at the end of a comparison budget. You can also evaluate the saved best model explicitly.

Within one preset and circuit, best selection prioritizes completion rate, then mean reward. Reports every 100 episodes contain the best evaluation score and success rate. Five fixed poses are a small repeatable evaluation suite, not a guarantee of robustness to every start or unseen layout.

### Controlled P1/P2 comparisons

The browser's **Controlled comparison** runs four sequential experiment stages with independent training seeds 42, 1337 and 2026. All twelve runs start from random weights, use the same training start and episode budget, and use the same five evaluation poses. Pause/resume is supported. Saved models are retained.

| Stage | Change relative to previous stage |
| --- | --- |
| Corrected baseline | Original speed/position-aware setup, with explicit history inputs and five-start evaluation |
| Remove speed bonus | Remove only the extra speed reward |
| Normalize progress | Scale forward and reverse progress by circuit length |
| Local inputs | Mask only absolute X/Z and absolute lap-position inputs |

Final-policy evaluation at the chosen episode budget is recorded separately from saved best checkpoints. Tables aggregate the three seeds and show per-seed results. Compare completion rate, off-road time and successful lap time across stages; raw reward scales differ. Episode budgets match, but decision counts can differ because attempts have different lengths; counts are reported. Short budgets test the pipeline but cannot establish which configuration learns best. A new comparison replaces the displayed report for this track; exported source code includes the headless comparison command below for reproducible JSON reports.

### Learner and checks

Double DQN uses two 64-unit ReLU layers and nine outputs, Adam at 0.0005, a 20,000-transition replay buffer, batches of 32, discount 0.995, and updates every four decisions after 256 experiences. The default uses one-step targets, target copies every 200 updates, Huber loss and rewards scaled by 0.01 internally. Without demonstrations, exploration decays over 16,000 decisions to 4%. With demonstrations, it starts at 15% and decays over 20,000 decisions to a 4% floor, and each update includes a cross-entropy loss on 16 instructor-labelled examples, weighted by 5. A separate experimental preset uses three-step returns, clipped gradients and soft target updates. It was not consistently better in our tests.

```sh
node --experimental-strip-types --test tests/*.test.mjs
node --experimental-strip-types scripts/train-smoke.mjs 100 0
# All four stages, three seeds, identical evaluation starts; optional JSON output.
node --experimental-strip-types scripts/compare-training.mjs 400 0 /tmp/comparison.json
# After npm run build, test the actual bundled worker and cross-track transfer.
node --experimental-strip-types scripts/worker-smoke.mjs
# Chromium UI checks against the running local/Tailscale build.
npx playwright install --with-deps chromium
node scripts/browser-smoke.mjs
node scripts/multitrack-browser.mjs
node --experimental-strip-types scripts/multitrack-worker.mjs
# Check checkpoint counts and changing AI race distance.
node scripts/checkpoints-browser.mjs
# Override the default URL with RACING_URL if needed.
```

Checks cover reward history, normalization, full laps from varied starts on all circuits, checkpoint exploits, evaluation aggregation, legacy prediction preservation, inference and fine-tuning across tracks, tensor cleanup, five-second playback recovery, fleet interpolation and worker scheduling. The separate Chromium check trains two real groups of 50, exercises replay pause/resume and skipping, checks live learner retention across the original tracks, runs best-model playback, and checks mobile overflow and browser errors. These workflow checks do not establish policy convergence or guarantee successful laps on unseen circuits.

### Stuck-car detection

**Minimum movement / 1 s** defaults to 1 world unit and can be adjusted or disabled. Every physics step compares the car position with its position exactly 60 steps earlier. The first second gathers samples; thereafter the window rolls continuously. Small back-and-forth movements do not accumulate distance. Falling below the threshold ends training, evaluation, or best-model playback with a −250 failure penalty in the experimental corner-reward preset, or −100 in earlier presets. Pausing freezes simulated time. Normal acceleration from rest travels about 8 units in its first second.

Changing the threshold retains weights and optimizer state, but restarts the attempt and evaluation and clears old experience memory and replay recordings. Evaluation results record the threshold and cannot be ranked against a different threshold. Track changes retain the setting; new sessions default to 1 unit. Existing models remain loadable through zero-weight observation padding. Recent net movement, the window age and threshold are inputs; the full position history is not supplied to the network.

### Training across circuits

There are five layouts: Park oval, Pine bend, Desert switchback, Coastal sweep and Slate canyon. The new coastal layout has flowing curves; Slate canyon has angular bends and a deep infield detour. The existing checkpoint rules apply, with six checkpoints on Coastal sweep and eight on Slate canyon.

In **Train AI**, choose exactly three circuits under **Training circuits**, then **Apply training setup**. The default set is the original three tracks. The learner rotates circuits after every episode and shares a single network and optimizer. Each circuit reserves one third of the 20,000-experience capacity, and training samples choose among populated circuit buffers with equal probability. Changing the set retains learned weights and experience for circuits that remain selected.

**Mix in starts around the circuit** alternates grid starts with reproducible random positions on each selected track, with small lateral and heading offsets. These practice attempts still require the requested number of complete circuits from their own starting position; checkpoint progress is measured relative to that start. Best-model playback starts at the actual finish line. Five fixed evaluation starts per selected circuit remain independent of the training-start random generator.

Every evaluation tests the same frozen policy across the selected set. Shared best selection ranks mean completion first, then completion on the weakest circuit, then mean score. The UI shows evaluation and replay-memory counts per circuit. The circuit menu only changes the view in three-track mode, so the two unselected layouts can be used for playback transfer checks. It does not silently add them to training.

Groups of 50 attempts can contain recordings from several circuits. The replay displays only the cars recorded on the viewed circuit; switching the view reveals the others at the same replay time. Training continues in the background. Pause stops both learning and replay. Switching off three-track training retains the single-track workflow; controlled comparisons use single-track grid starts.

This trains and tests the mechanics of multi-track learning. Completing races or generalizing to unseen layouts still depends on training time, exploration and the learned policy; a successful integration test is not evidence of driving proficiency.

### Investigating a learning plateau

New sessions use **Local inputs** with **Guided warm-up before RL** enabled. The instructor generates 12,000 labelled states on the selected training tracks, and the network learns them over 4,000 supervised updates before reinforcement learning begins. This is imitation learning followed by RL, not pure RL. Playback and evaluation use network predictions only. Warm-up progress and lesson loss are displayed separately from TD loss. Pause freezes both phases. Loading an existing model leaves warm-up off; enable the checkbox to teach that model on the selected tracks. Changing the training setup rebuilds lessons when enabled.

**Corner rewards** is an optional experimental preset. Existing saved weights can be loaded and upgraded using **Use corner-aware rewards**. Upgrading retains the weights, clears previous experiences and evaluations, and creates fresh scores under the new objective. Original saved models remain available. An old model with zero-weight new inputs needs more training to use those inputs.

Sixteen new observation slots append four car-relative waypoint positions at 4/8/16/32 world units, road half-width, a curvature-and-braking-based speed estimate, recent net movement, motion-window age, minimum movement threshold, forward-ray travel time, normalized yaw rate and the steering command. The first 36 slots keep their order. Road geometry comes from the known circuit: this remains map-assisted simulation, not a lidar-only driver.

The new preset preserves checkpoint and finish rewards and adds nonpositive penalties for exceeding the estimated corner speed, moving near the road edge and pointing away from the road direction. These penalties provide feedback before leaving the road. The failure penalty is −250. Earlier presets retain their reward definitions for comparison. A safe-speed estimate is a training feature and reward term; it does not override model actions or secretly brake during playback.

**Chart circuit** separates the interleaved episode scores by track and recomputes their rolling means. Evaluation details report failure reason, terminal speed and position around the circuit. A flat best-model history does not mean every later learner snapshot has identical behavior.

**Test all 5 tracks** evaluates the frozen best model from five fixed starts per track, including the two circuits outside a three-track training set. It does not update the learner, alter best selection, or put held-out experiences into replay memory. Results are labelled with the evaluated model episode. These 25 tests do not establish that a model can drive every possible future layout.

Research and controlled local results are recorded in [the plateau investigation](docs/plateau-investigation.md).

Valid inside-corner driving now uses curvature-aware progress bounds. Checkpoint accounting no longer rejects legal progress just because the centerline arc advances faster than the car travels along the inside of a bend. Progress cannot display 100% before the requested race is completed.

To reproduce the guided-learning check using the same JavaScript learner outside the UI:

```bash
node --experimental-strip-types scripts/guided-benchmark.mjs 42
node --experimental-strip-types scripts/guided-benchmark.mjs 1337
```

Each run trains on the first three tracks, evaluates all five after warm-up, runs 10,000 RL decisions and evaluates all five again. Results are written to `/tmp/plateau-guided-SEED.json`. Node is only the reproducible test runner; interactive training runs inside the browser worker with TensorFlow.js CPU.

In the two-seed investigation, both guided warm-up networks completed all 25 three-lap evaluation races, including two circuits excluded from training. After another 10,000 RL decisions, the latest learners completed 25/25 and 19/25. The warm-up checkpoint is kept as a separate library entry when a later RL model improves on its training-set evaluation. Held-out performance can still regress. Continued RL can still forget skills; these five-layout results do not establish arbitrary-track driving. See the investigation report for failed experiments and raw results.
