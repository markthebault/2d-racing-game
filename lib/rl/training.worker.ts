import { DQNAgent, initializeTensorflow } from './agent.ts';
import { DrivingEnvironment, DECISION_SECONDS } from './environment.ts';
import { COMPARISON_SEEDS, DEFAULT_PRESET, OBSERVATION_VERSION, PRESETS, type Preset } from './config.ts';
import { EvaluationSuite, betterEvaluation } from './evaluation.ts';
import { MODEL_VERSION, migrateModel, type Checkpoint } from './models.ts';
import { emptyTrainingStats, type WorkerCommand, type WorkerMessage } from './protocol.ts';
import { sampleBatch, type RecordedRun, type Pose } from './batch.ts';

const send = (message: WorkerMessage) => self.postMessage(message);
const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let playbackAgent: DQNAgent | null = null;
let agent: DQNAgent, bestAgent: DQNAgent, environment: DrivingEnvironment;
let evaluation: EvaluationSuite | null = null;
let evaluateBest = false;
let evaluationResume: 'train' | 'idle' = 'train';
let playback: DrivingEnvironment | null = null;
let best: Checkpoint | null = null;
let modelId = id(), parentId: string | null = null, trainedTracks: number[] = [];
const stats = emptyTrainingStats();
let mode: 'idle' | 'train' | 'evaluate' = 'idle';
let display: 'none' | 'play' | 'batch' = 'none';
let paused = false, nextTrain = 0, nextPlayback = 0, lastDisplay = 0;
let activeRuns: RecordedRun[] = [], queuedRuns: RecordedRun[][] = [];
let skippedGroups = 0, playbackEpisode: number | null = null;
let pausedMode: 'idle' | 'train' | 'evaluate' | 'play' | 'batch' = 'idle';
let runs: RecordedRun[] = [], poses: Pose[] = [], batchTime = 0;
let pendingTrack: number | null = null;
let targetLaps = 1;
let pendingLaps: number | null = null;
function recordPose(): Pose { return { ...environment.state, time: environment.time }; }
function stopDisplay() {
  display = 'none'; activeRuns = []; playback = null; playbackAgent?.dispose(); playbackAgent = null; playbackEpisode = null;
  send({ type: 'fleet', frame: null });
}
function clearBatch() { stats.lastPlayback = null; runs = []; queuedRuns = []; skippedGroups = 0; poses = [recordPose()]; stats.batchCount = 0; stopDisplay(); }
function startQueuedBatch() {
  if (paused || display !== 'none' || !queuedRuns.length) return;
  activeRuns = queuedRuns.shift()!; batchTime = 0; display = 'batch'; lastDisplay = performance.now();
  send({ type: 'fleet', frame: sampleBatch(activeRuns, 0, environment.track, replaySpeed) });
}
function finishBatch() { stopDisplay(); startQueuedBatch(); }

function switchTrack(track: number, laps = targetLaps) {
  if (!Number.isInteger(laps) || laps < 1 || laps > 10) throw new Error("Choose 1–10 laps.");
  if (track === environment.track && laps === environment.targetLaps) return;
  targetLaps = laps;
  if (stats.comparison && !stats.comparison.complete) { stats.comparison.complete = true; send({ type: 'report', report: stats.comparison }); comparisonJobs = []; }
  const resume = !paused && (mode === 'train' || (mode === 'evaluate' && evaluationResume === 'train'));
  paused = false;
  environment = new DrivingEnvironment(track, stats.preset, false, targetLaps); observation = environment.reset();
  playback = null; evaluation = null; pausedMode = 'idle'; paused = false; clearBatch();
  parentId = best?.id ?? parentId; modelId = id();
  best = { version: MODEL_VERSION, observationVersion: OBSERVATION_VERSION, id: modelId, parentId, track, preset: stats.preset, seed: stats.seed,
    episode: stats.episode, trainedTracks: [...trainedTracks], evaluation: null, weights: agent.exportWeights() };
  bestAgent.loadWeights(best.weights); summaryOfBest(); stats.evaluation = null; stats.milestones = [];
  beginEvaluation(true, resume ? 'train' : 'idle');
}
let speed = 4, replaySpeed = 1, lastPublish = 0;
let observation: number[];
let initialized = false, booting = false, discard = false, completedEpisodes = 0;
let comparisonJobs: { preset: Preset; seed: number }[] = [];
function publish() {
  if (!initialized) return;
  stats.steps = agent.steps; stats.updates = agent.updates; stats.epsilon = agent.epsilon;
  stats.loss = agent.loss; stats.replaySize = agent.replay.length;
  stats.track = environment.track; stats.batchCount = runs.length; stats.trainedTracks = [...trainedTracks]; stats.pausedActivity = pausedMode;
  stats.currentScore = environment.score;
  stats.targetLaps = targetLaps; stats.completedLaps = environment.completedLaps; stats.checkpoints = environment.frame().checkpoints; stats.checkpointCount = environment.checkpointCount;
  stats.backgroundLearning = !paused && (mode === 'train' || (mode === 'evaluate' && evaluationResume === 'train'));
  stats.queuedGroups = queuedRuns.length; stats.skippedGroups = skippedGroups; stats.playbackEpisode = playbackEpisode;
  if (paused) stats.status = 'paused';
  else if (display === 'play') stats.status = 'playing';
  else if (display === 'batch') stats.status = 'replaying';
  else if (mode === 'train') stats.status = 'training';
  else if (mode === 'evaluate') stats.status = 'evaluating';
  stats.evaluationCase = evaluation ? `${evaluation.index + 1}/5 · ${evaluation.label}` : '';
  send({ type: 'stats', stats }); lastPublish = performance.now();
}
function show() { if (display === 'play') send({ type: 'frame', track: environment.track, frame: playback!.frame() }); }
function summaryOfBest() { if (best) { const { weights: _weights, ...summary } = best; stats.best = summary; } else stats.best = null; }
function beginEvaluation(useBest: boolean, resume: 'train' | 'idle') {
  evaluation = new EvaluationSuite(environment.track, stats.preset, targetLaps); evaluateBest = useBest; evaluationResume = resume;
  mode = 'evaluate'; stats.status = 'evaluating'; stats.message = 'Five varied starts, with exploration and learning disabled.'; publish();
}
function setupRun(track: number, preset: Preset, seed: number) {
  agent?.dispose(); bestAgent?.dispose();
  agent = new DQNAgent(seed); bestAgent = new DQNAgent(seed);
  environment = new DrivingEnvironment(track, preset, false, targetLaps); observation = environment.reset();
  best = null; evaluation = null; playback = null; parentId = null; trainedTracks = []; modelId = id(); completedEpisodes = 0;
  Object.assign(stats, { episode: 0, preset, seed, best: null, evaluation: null, history: [], milestones: [], mean: null, completion: null, evaluationCase: '' });
  pausedMode = 'idle'; paused = false; clearBatch();
}
function finishEvaluation() {
  const result = evaluation!.summary(); stats.evaluation = result;
  if (evaluateBest) {
    best!.evaluation = result; summaryOfBest();
    send({ type: 'checkpoint', checkpoint: best! });
  } else if (betterEvaluation(result, best?.evaluation ?? null)) {
    best = { version: MODEL_VERSION, observationVersion: OBSERVATION_VERSION, id: modelId, track: environment.track, preset: stats.preset,
      seed: stats.seed, episode: stats.episode, trainedTracks: [...new Set([...trainedTracks, ...(agent.steps ? [environment.track] : [])])], parentId,
      evaluation: result, weights: agent.exportWeights() };
    bestAgent.loadWeights(best.weights); summaryOfBest(); send({ type: 'checkpoint', checkpoint: best });
  }
  if (!evaluateBest && stats.episode > 0 && stats.episode % 100 === 0) {
    stats.milestones = [...stats.milestones, { episode: stats.episode, best: best!.evaluation!.meanScore, bestEpisode: best!.episode, completion: best!.evaluation!.successRate }].slice(-50);
  }
  const resume = evaluationResume;
  evaluation = null; mode = resume; stats.status = resume === 'train' ? 'training' : 'ready';
  stats.message = `Evaluation: ${(result.successRate * 100).toFixed(0)}% completed; mean score ${result.meanScore.toFixed(0)}. Best selection prioritizes completed races.`;
  if (stats.comparison && !stats.comparison.complete && stats.episode >= stats.comparison.budget && !evaluateBest) {
    stats.comparison.rows.push({ preset: stats.preset, seed: stats.seed, episodes: stats.episode, steps: agent.steps, evaluation: result, modelId: best!.id });
    const next = comparisonJobs.shift();
    if (next) {
      send({ type: 'report', report: stats.comparison });
      const track = environment.track; setupRun(track, next.preset, next.seed); stats.comparisonRun++;
      mode = 'train'; stats.status = 'training'; stats.message = `Comparison run ${stats.comparisonRun}/12: ${PRESETS[next.preset].label}, seed ${next.seed}.`;
    } else {
      stats.comparison.complete = true; mode = 'idle'; stats.status = 'ready';
      stats.message = 'Comparison complete. Compare completion, off-road time and lap time across all three seeds; raw reward scores differ between presets.';
      send({ type: 'report', report: stats.comparison });
    }
  }
  publish();
}
function trainStep() {
  if (!trainedTracks.includes(environment.track)) trainedTracks.push(environment.track);
  const action = agent.act(observation, true), result = environment.step(action);
  poses.push(recordPose());
  agent.remember({ state: observation, action, reward: result.reward, next: result.observation, done: result.done });
  observation = result.observation; agent.train();
  if (!result.done) return;
  stats.episode++; completedEpisodes += Number(environment.completed);
  const recent = [...stats.history.slice(-19).map(e => e.score), environment.score];
  const metric = { episode: stats.episode, score: environment.score, mean: recent.reduce((a, b) => a + b, 0) / recent.length,
    loss: agent.loss, progress: environment.frame().progress, completed: environment.completed };
  stats.history = [...stats.history, metric].slice(-300); stats.mean = metric.mean; stats.completion = completedEpisodes / stats.episode;
  runs.push({ episode: stats.episode, poses, completed: environment.completed });
  stats.message = `Attempt ${stats.episode}: ${environment.reason.toLowerCase()}. Collecting ${runs.length}/50 recordings.`; observation = environment.reset(); poses = [recordPose()];
  if (runs.length === 50) {
    if (queuedRuns.length === 2) { queuedRuns.shift(); skippedGroups++; }
    queuedRuns.push(runs); runs = []; startQueuedBatch();
  }
  if (stats.episode === 1 || stats.episode % 10 === 0 || (stats.comparison && !stats.comparison.complete && stats.episode >= stats.comparison.budget)) beginEvaluation(false, 'train');
  publish();
}
async function loop() {
  while (!discard) {
    const start = performance.now();
    if (!paused) {
      startQueuedBatch();
      if (display === 'play' && start >= nextPlayback) {
        playback!.step(playbackAgent!.act(playback!.observe()));
        nextPlayback = start + DECISION_SECONDS * 1000;
        show();
        if (playback!.done) {
          stats.lastPlayback = { episode: playbackEpisode!, score: playback!.score, reason: playback!.reason, completedLaps: playback!.completedLaps, targetLaps };
          stats.message = `${playback!.reason}. Score ${playback!.score.toFixed(0)}. Background training continues; playback experiences are not learned.`;
          stopDisplay(); stats.status = mode === 'idle' ? 'playback-ended' : 'training'; startQueuedBatch(); publish();
        }
      } else if (display === 'batch' && start - lastDisplay >= 25) {
        batchTime += Math.min(.1, (start - lastDisplay) / 1000) * replaySpeed; lastDisplay = start;
        const frame = sampleBatch(activeRuns, batchTime, environment.track, replaySpeed); send({ type: 'fleet', frame });
        if (batchTime >= frame.duration + 1) finishBatch();
      }
      // Short cooperative slices keep rendering responsive while learning and evaluation advance.
      do {
        if (mode === 'evaluate') {
          evaluation!.step(state => (evaluateBest ? bestAgent : agent).act(state));
          if (evaluation!.done) finishEvaluation();
        } else if (mode === 'train' && (speed === 0 || performance.now() >= nextTrain)) {
          trainStep(); nextTrain = performance.now() + (speed ? DECISION_SECONDS * 1000 / speed : 0);
        } else break;
      } while (performance.now() - start < 8);
    }
    if (!paused && performance.now() - lastPublish > 100 && (mode !== 'idle' || display !== 'none')) publish();
    await sleep(paused || (mode === 'idle' && display === 'none') ? 25 : 4);
  }
}
self.onmessage = async (event: MessageEvent<WorkerCommand>) => {
  const command = event.data;
  try {
    if (command.type === 'init') {
      if (initialized || booting) return;
      booting = true; await initializeTensorflow();
      const saved = command.checkpoint ? migrateModel(command.checkpoint) : null;
      const preset = saved?.preset ?? command.preset ?? DEFAULT_PRESET, seed = saved?.seed ?? command.seed ?? 42;
      if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new Error('Use an integer seed between 0 and 2147483647.');
      targetLaps = command.laps ?? 1; setupRun(command.track, preset, seed);
      if (saved) {
        agent.loadWeights(saved.weights); bestAgent.loadWeights(saved.weights);
        parentId = saved.id; trainedTracks = [...saved.trainedTracks];
        // Source weights are reusable on every circuit; source scores are never treated as target scores.
        best = { ...saved, id: modelId, parentId: saved.id, track: command.track, episode: 0, evaluation: null };
        summaryOfBest();
      }
      initialized = true; stats.status = 'ready'; stats.message = 'Ready. New sessions use the selected experiment and seed.';
      publish(); show();
      if (saved) beginEvaluation(true, 'idle');
      if (pendingTrack !== null) { switchTrack(pendingTrack, pendingLaps ?? targetLaps); pendingTrack = null; pendingLaps = null; }
      void loop().catch(error => { mode = 'idle'; paused = true; send({ type: 'error', message: String(error) }); });
    } else if (command.type === 'speed') speed = [0, 1, 4, 20].includes(command.speed) ? command.speed : 4;
    else if (command.type === 'replay-speed') replaySpeed = [1, 2, 4, 8].includes(command.speed) ? command.speed : 1;
    else if (command.type === 'track') { if (![0, 1, 2].includes(command.track)) return; if (!initialized) { pendingTrack = command.track; pendingLaps = command.laps ?? null; } else switchTrack(command.track, command.laps ?? targetLaps); }
    else if (initialized && command.type === 'skip-replay' && display === 'batch') { finishBatch(); publish(); }
    else if (initialized && command.type === 'pause') {
      if (!paused) pausedMode = display !== 'none' ? display : mode;
      paused = true; stats.status = 'paused'; stats.message = 'Training and playback paused. Resume retains both positions and all learned experience.'; publish();
    } else if (initialized && (command.type === 'train' || command.type === 'resume')) {
      if (command.type === 'train') stopDisplay();
      paused = false; pausedMode = 'idle'; lastDisplay = performance.now(); nextPlayback = performance.now(); nextTrain = 0;
      mode = evaluation ? 'evaluate' : 'train'; if (evaluation) evaluationResume = 'train';
      stats.message = 'Learning continues while you watch. Pause stops both training and playback.'; publish();
    } else if (initialized && command.type === 'play' && best) {
      stopDisplay(); paused = false; pausedMode = 'idle';
      stats.lastPlayback = null; playbackAgent = new DQNAgent(stats.seed); playbackAgent.loadWeights(best.weights); playbackEpisode = best.episode;
      playback = new DrivingEnvironment(environment.track, stats.preset, true, targetLaps); display = 'play'; nextPlayback = performance.now() + 100;
      mode = evaluation ? 'evaluate' : 'train'; if (evaluation) evaluationResume = 'train';
      stats.message = 'Playing a fixed best-model snapshot. The learner trains independently in the background.'; show(); publish();
    } else if (initialized && command.type === 'evaluate' && best) {
      if (stats.comparison && !stats.comparison.complete) throw new Error('Finish the controlled comparison before requesting another evaluation.');
      const resume = !paused && (mode === 'train' || (mode === 'evaluate' && evaluationResume === 'train')) ? 'train' : 'idle';
      paused = false; pausedMode = 'idle'; beginEvaluation(true, resume);
    } else if (initialized && command.type === 'compare') {
      if (!Number.isInteger(command.episodes) || command.episodes < 1 || command.episodes > 5000) throw new Error('Invalid comparison budget.');
      const track = environment.track;
      comparisonJobs = (Object.keys(PRESETS) as Preset[]).flatMap(preset => COMPARISON_SEEDS.map(seed => ({ preset, seed })));
      const first = comparisonJobs.shift()!; setupRun(track, first.preset, first.seed);
      stats.comparison = { targetLaps, id: id(), track, budget: command.episodes, rows: [], complete: false }; stats.comparisonRun = 1;
      mode = 'train'; stats.status = 'training'; stats.message = 'Comparison run 1/12. Every run starts from random weights; saved models are retained.'; publish();
    } else if (command.type === 'reset') { discard = true; mode = 'idle'; agent?.dispose(); bestAgent?.dispose(); playbackAgent?.dispose(); }
  } catch (error) { mode = 'idle'; paused = true; send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
