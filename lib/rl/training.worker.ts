import { DrivingCoach } from './coach.ts';
import { TRACKS } from '../race.ts';
import { trainingStart, validateTrainingTracks } from './curriculum.ts';
import { DEFAULT_MIN_DISTANCE } from './motion.ts';
import { DQNAgent, initializeTensorflow, seededRandom } from './agent.ts';
import { DrivingEnvironment, DECISION_SECONDS } from './environment.ts';
import { COMPARISON_SEEDS, DEFAULT_PRESET, OBSERVATION_VERSION, PRESETS, type Preset } from './config.ts';
import { EvaluationSuite, betterAcrossTracks, type EvaluationSummary } from './evaluation.ts';
import { MODEL_VERSION, migrateModel, type Checkpoint } from './models.ts';
import { emptyTrainingStats, type WorkerCommand, type WorkerMessage } from './protocol.ts';
import { sampleBatch, type RecordedRun, type Pose } from './batch.ts';

const send = (message: WorkerMessage) => self.postMessage(message);
const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let playbackAgent: DQNAgent | null = null;
let coach: DrivingCoach | null = null, coachEnabled = false;
let agent: DQNAgent, bestAgent: DQNAgent, environment: DrivingEnvironment;
let evaluation: EvaluationSuite | null = null;
let evaluateBest = false, validationOnly = false;
let evaluationResume: 'train' | 'idle' = 'train';
let playback: DrivingEnvironment | null = null;
let best: Checkpoint | null = null;
let guidedUsed = false, preserveWarmup = false;
let modelId = id(), parentId: string | null = null, trainedTracks: number[] = [];
const stats = emptyTrainingStats();
let mode: 'idle' | 'train' | 'coach' | 'evaluate' = 'idle';
let display: 'none' | 'play' | 'batch' = 'none';
let paused = false, nextTrain = 0, nextPlayback = 0, lastDisplay = 0;
let activeRuns: RecordedRun[] = [], queuedRuns: RecordedRun[][] = [];
let skippedGroups = 0, playbackEpisode: number | null = null;
let pausedMode: 'idle' | 'train' | 'coach' | 'evaluate' | 'play' | 'batch' = 'idle';
let runs: RecordedRun[] = [], poses: Pose[] = [], batchTime = 0;
let pendingTrack: number | null = null;
let viewTrack = 0, trainingTracks: number[] = [], variedStarts = false, attempt = 0;
let startRandom = seededRandom(42);
let evaluationTracks: number[] = [], evaluationResults: EvaluationSummary[] = [];
const environments = new Map<number, DrivingEnvironment>();
function resetAttempt() {
  const track = trainingTracks[attempt % trainingTracks.length];
  let env = environments.get(track);
  if (!env) { env = new DrivingEnvironment(track, stats.preset, false, targetLaps, minDistance); environments.set(track, env); }
  environment = env;
  observation = environment.reset(trainingStart(Math.floor(attempt / trainingTracks.length), variedStarts, startRandom));
  poses = [recordPose()];
}
let targetLaps = 1, minDistance = DEFAULT_MIN_DISTANCE;
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
  send({ type: 'fleet', frame: sampleBatch(activeRuns, 0, viewTrack, replaySpeed) });
}
function finishBatch() { stopDisplay(); startQueuedBatch(); }

function switchTrack(track: number, laps = targetLaps, threshold = minDistance, force = false) {
  if (!Number.isInteger(laps) || laps < 1 || laps > 10) throw new Error("Choose 1–10 laps.");
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 5) throw new Error("Invalid minimum distance.");
  if (!force && laps === targetLaps && threshold === minDistance && trainingTracks.length > 1) {
    if (viewTrack !== track) {
      viewTrack = track;
      if (display === 'play') stopDisplay();
      else send({ type: 'fleet', frame: display === 'batch' ? sampleBatch(activeRuns, batchTime, viewTrack, replaySpeed) : null });
      summaryOfBest(); publish();
    }
    return;
  }
  if (!force && track === viewTrack && laps === targetLaps && threshold === minDistance) return;
  if (threshold !== minDistance) { agent.clearReplay(); stats.history = []; stats.mean = null; stats.completion = null; completedEpisodes = 0; measuredEpisodes = 0; }
  viewTrack = track; minDistance = threshold; targetLaps = laps;
  if (trainingTracks.length === 1) trainingTracks = [track];
  if (stats.comparison && !stats.comparison.complete) { stats.comparison.complete = true; send({ type: 'report', report: stats.comparison }); comparisonJobs = []; }
  const resume = !paused && (mode === 'train' || mode === 'coach' || (mode === 'evaluate' && evaluationResume === 'train'));
  preserveWarmup = false; coach?.dispose(); coach = coachEnabled ? new DrivingCoach(trainingTracks,stats.preset,laps,threshold,stats.seed) : null; agent.lessons=[];
  agent.discardPending(); agent.renewExploration(); environments.clear(); attempt = 0; resetAttempt();
  evaluation = null; pausedMode = 'idle'; paused = false; clearBatch();
  parentId = best?.id ?? parentId; modelId = id();
  best = { version: MODEL_VERSION, observationVersion: OBSERVATION_VERSION, guided: guidedUsed, id: modelId, parentId, track, preset: stats.preset, seed: stats.seed,
    episode: stats.episode, trainedTracks: [...trainedTracks], evaluation: null, evaluations: [], weights: agent.exportWeights() };
  bestAgent.loadWeights(best.weights); summaryOfBest(); stats.evaluation = null; stats.evaluations = []; stats.validation = null; stats.milestones = [];
  beginEvaluation(true, resume ? 'train' : 'idle');
}
let speed = 4, replaySpeed = 1, lastPublish = 0;
let observation: number[];
let initialized = false, booting = false, discard = false, completedEpisodes = 0, measuredEpisodes = 0;
let comparisonJobs: { preset: Preset; seed: number }[] = [];
function publish() {
  if (!initialized) return;
  stats.coachEnabled=coachEnabled; stats.coachSamples=coach?.examples.length??0;stats.coachUpdates=coach?.updates??0;stats.coachLoss=coach?.loss??null;
  stats.steps = agent.steps; stats.updates = agent.updates; stats.epsilon = agent.epsilon;
  stats.loss = agent.loss; stats.replaySize = agent.replay.length;
  stats.track = viewTrack;
  stats.trainingTracks = [...trainingTracks]; stats.trainingTrack = environment.track; stats.variedStarts = variedStarts; stats.startFraction = environment.startArc / environment.length; stats.replayCounts = agent.replayCounts;
  stats.evaluation = stats.evaluations.find(result => result.track === viewTrack) ?? null; stats.batchCount = runs.length; stats.trainedTracks = [...trainedTracks]; stats.pausedActivity = pausedMode;
  stats.minDistance = minDistance;
  stats.currentScore = environment.score;
  stats.targetLaps = targetLaps; stats.completedLaps = environment.completedLaps; stats.checkpoints = environment.frame().checkpoints; stats.checkpointCount = environment.checkpointCount;
  stats.backgroundLearning = !paused && (mode === 'train' || mode === 'coach' || (mode === 'evaluate' && evaluationResume === 'train'));
  stats.queuedGroups = queuedRuns.length; stats.skippedGroups = skippedGroups; stats.playbackEpisode = playbackEpisode;
  if (paused) stats.status = 'paused';
  else if (display === 'play') stats.status = 'playing';
  else if (display === 'batch') stats.status = 'replaying';
  else if (mode === 'coach') stats.status='coaching';
  else if (mode === 'train') stats.status = 'training';
  else if (mode === 'evaluate') stats.status = 'evaluating';
  stats.evaluationCase = evaluation ? `${TRACKS[evaluation.environment.track].name} · ${evaluation.index + 1}/5 · ${evaluation.label}` : '';
  send({ type: 'stats', stats }); lastPublish = performance.now();
}
function show() { if (display === 'play') send({ type: 'frame', track: viewTrack, frame: playback!.frame() }); }
function summaryOfBest() { if (best) { const { weights: _weights, ...summary } = best; stats.best = { ...summary, evaluation: best.evaluations?.find(result => result.track === viewTrack) ?? (best.evaluation?.track === viewTrack ? best.evaluation : null) }; } else stats.best = null; }
function beginEvaluation(useBest: boolean, resume: 'train' | 'idle', allTracks = false) {
  validationOnly = allTracks;
  evaluationTracks = allTracks ? TRACKS.map((_,i)=>i) : [...trainingTracks]; evaluationResults = [];
  evaluation = new EvaluationSuite(evaluationTracks.shift()!, stats.preset, targetLaps, minDistance); evaluateBest = useBest; evaluationResume = resume;
  mode = 'evaluate'; stats.status = 'evaluating'; stats.message = `Evaluating the same snapshot on ${allTracks ? TRACKS.length : trainingTracks.length} circuit(s), five starts each.`; publish();
}
function setupRun(track: number, preset: Preset, seed: number) {
  coach?.dispose(); coach=null; agent?.dispose(); bestAgent?.dispose();
  agent = new DQNAgent(seed, preset === 'adaptive'); bestAgent = new DQNAgent(seed);
  viewTrack = track; if (!trainingTracks.length) trainingTracks = [track];
  if (trainingTracks.length > 1) agent.setTrainingTracks(trainingTracks);
  stats.preset = preset; startRandom = seededRandom(seed + 101); attempt = 0; environments.clear(); resetAttempt();
  guidedUsed = false; preserveWarmup = false; best = null; evaluation = null; playback = null; parentId = null; trainedTracks = []; modelId = id(); completedEpisodes = 0; measuredEpisodes = 0;
  Object.assign(stats, { episode: 0, preset, seed, best: null, evaluation: null, evaluations: [], validation: null, history: [], milestones: [], mean: null, completion: null, evaluationCase: '' });
  coach=coachEnabled ? new DrivingCoach(trainingTracks,preset,targetLaps,minDistance,seed) : null;
  pausedMode = 'idle'; paused = false; clearBatch();
}
function finishEvaluation() {
  evaluationResults.push(evaluation!.summary());
  if (evaluationTracks.length) {
    evaluation = new EvaluationSuite(evaluationTracks.shift()!, stats.preset, targetLaps, minDistance); publish(); return;
  }
  if (validationOnly) {
    stats.validation = { episode: best!.episode, results: [...evaluationResults] };
    evaluation = null; validationOnly = false; mode = evaluationResume; stats.status = mode === 'train' ? 'training' : 'ready';
    stats.message = 'Transfer check complete. Held-out scores did not change the learner or best-model selection.'; publish(); return;
  }
  const result = evaluationResults[0]; stats.evaluations = [...evaluationResults];
  const aggregateScore = (items: EvaluationSummary[]) => items.reduce((sum,r)=>sum+r.meanScore,0)/items.length;
  const aggregateSuccess = (items: EvaluationSummary[]) => items.reduce((sum,r)=>sum+r.successRate,0)/items.length;
  if (evaluateBest) {
    best!.evaluation = result; best!.evaluations = [...evaluationResults]; summaryOfBest();
    send({ type: 'checkpoint', checkpoint: best! });
  } else if (betterAcrossTracks(evaluationResults, best?.evaluations ?? (best?.evaluation ? [best.evaluation] : []))) {
    best = { version: MODEL_VERSION, observationVersion: OBSERVATION_VERSION, guided: guidedUsed, id: modelId, track: environment.track, preset: stats.preset,
      seed: stats.seed, episode: stats.episode, trainedTracks: [...trainedTracks], parentId,
      evaluation: result, evaluations: [...evaluationResults], weights: agent.exportWeights() };
    bestAgent.loadWeights(best.weights); summaryOfBest(); send({ type: 'checkpoint', checkpoint: best });
  }
  // Keep the guided starting policy as its own library entry when later RL beats it.
  if (preserveWarmup) { if (best?.id === modelId) { parentId = best.id; modelId = id(); } preserveWarmup = false; }
  if (!evaluateBest && stats.episode > 0 && stats.episode % 100 === 0) {
    stats.milestones = [...stats.milestones, { episode: stats.episode, best: aggregateScore(best!.evaluations!), bestEpisode: best!.episode, completion: aggregateSuccess(best!.evaluations!) }].slice(-50);
  }
  const resume = evaluationResume;
  evaluation = null; mode = resume; stats.status = resume === 'train' ? 'training' : 'ready';
  stats.message = `Evaluation: ${(aggregateSuccess(evaluationResults) * 100).toFixed(0)}% completed across ${evaluationResults.length} circuit(s); mean score ${aggregateScore(evaluationResults).toFixed(0)}. Best selection prioritizes completed races.`;
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
  agent.remember({ track: environment.track, state: observation, action, reward: result.reward, next: result.observation, done: result.done });
  observation = result.observation; agent.train();
  if (!result.done) return;
  stats.episode++; measuredEpisodes++; completedEpisodes += Number(environment.completed);
  const recent = [...stats.history.slice(-19).map(e => e.score), environment.score];
  const metric = { track: environment.track, startFraction: environment.startArc / environment.length, episode: stats.episode, score: environment.score, mean: recent.reduce((a, b) => a + b, 0) / recent.length,
    loss: agent.loss, progress: environment.frame().progress, completed: environment.completed };
  stats.history = [...stats.history, metric].slice(-300); stats.mean = metric.mean; stats.completion = completedEpisodes / measuredEpisodes;
  runs.push({ track: environment.track, episode: stats.episode, poses, completed: environment.completed });
  stats.message = `Attempt ${stats.episode}: ${environment.reason.toLowerCase()}. Collecting ${runs.length}/50 recordings.`; attempt++; resetAttempt();
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
        const frame = sampleBatch(activeRuns, batchTime, viewTrack, replaySpeed); send({ type: 'fleet', frame });
        if (batchTime >= frame.duration + 1) finishBatch();
      }
      // Short cooperative slices keep rendering responsive while learning and evaluation advance.
      do {
        if ((mode === 'train' || mode === 'coach') && coachEnabled && coach && !coach.done) {
          mode='coach';coach.step(agent.online);
          stats.message=`Guided warm-up: ${coach.examples.length}/12000 examples, ${coach.updates}/4000 updates. Instructor labels training states only.`;
          if(coach.done) { preserveWarmup = true; guidedUsed = true; trainedTracks = [...new Set([...trainedTracks, ...trainingTracks])]; agent.target.setWeights(agent.online.getWeights()); agent.lessons=coach.examples; beginEvaluation(false,'train'); }
        } else if (mode === 'evaluate') {
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
      coachEnabled=command.coach??false;
      trainingTracks = validateTrainingTracks(command.trainingTracks ?? [command.track]); variedStarts = command.variedStarts ?? false;
      targetLaps = command.laps ?? 1; setupRun(command.track, preset, seed);
      if (saved) {
        agent.loadWeights(saved.weights); bestAgent.loadWeights(saved.weights);
        guidedUsed = saved.guided ?? false; parentId = saved.id; trainedTracks = [...saved.trainedTracks];
        // Source weights are reusable on every circuit; source scores are never treated as target scores.
        best = { ...saved, id: modelId, parentId: saved.id, track: command.track, episode: 0, evaluation: null, evaluations: [] };
        summaryOfBest();
      }
      initialized = true; stats.status = 'ready'; stats.message = 'Ready. New sessions use the selected experiment and seed.';
      publish(); show();
      if (saved) beginEvaluation(true, 'idle');
      if (pendingTrack !== null) { switchTrack(pendingTrack, pendingLaps ?? targetLaps); pendingTrack = null; pendingLaps = null; }
      void loop().catch(error => { mode = 'idle'; paused = true; send({ type: 'error', message: String(error) }); });
    } else if (command.type === 'speed') speed = [0, 1, 4, 20].includes(command.speed) ? command.speed : 4;
    else if (command.type === 'replay-speed') replaySpeed = [1, 2, 4, 8].includes(command.speed) ? command.speed : 1;
    else if (initialized && command.type === 'coach') {
      coachEnabled=command.enabled;coach?.dispose();coach=coachEnabled ? new DrivingCoach(trainingTracks,stats.preset,targetLaps,minDistance,stats.seed) : null;agent.lessons=[];
      if(mode==='coach')mode='idle';publish();
    }
    else if (initialized && command.type === 'upgrade') {
      stats.preset = 'adaptive'; agent.advanced = true; agent.clearReplay(); stats.history = []; stats.mean = null; stats.completion = null; completedEpisodes = 0; measuredEpisodes = 0;
      switchTrack(viewTrack, targetLaps, minDistance, true);
    }
    else if (initialized && command.type === 'plan') {
      const selected = validateTrainingTracks(command.tracks);
      trainingTracks = selected; variedStarts = command.variedStarts;
      agent.setTrainingTracks(selected.length > 1 ? selected : []);
      switchTrack(viewTrack, targetLaps, minDistance, true);
    }
    else if (initialized && command.type === 'motion') switchTrack(viewTrack, targetLaps, command.minDistance);
    else if (command.type === 'track') { if (!Number.isInteger(command.track) || !TRACKS[command.track]) return; if (!initialized) { pendingTrack = command.track; pendingLaps = command.laps ?? null; } else switchTrack(command.track, command.laps ?? targetLaps); }
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
      playback = new DrivingEnvironment(viewTrack, stats.preset, true, targetLaps, minDistance); display = 'play'; nextPlayback = performance.now() + 100;
      mode = evaluation ? 'evaluate' : 'train'; if (evaluation) evaluationResume = 'train';
      stats.message = 'Playing a fixed best-model snapshot. The learner trains independently in the background.'; show(); publish();
    } else if (initialized && command.type === 'validate' && best) {
      if (stats.comparison && !stats.comparison.complete) throw new Error('Finish the controlled comparison first.');
      const resume = !paused && (mode === 'train' || mode === 'coach' || (mode === 'evaluate' && evaluationResume === 'train')) ? 'train' : 'idle';
      paused = false; pausedMode = 'idle'; beginEvaluation(true, resume, true);
    } else if (initialized && command.type === 'evaluate' && best) {
      if (stats.comparison && !stats.comparison.complete) throw new Error('Finish the controlled comparison before requesting another evaluation.');
      const resume = !paused && (mode === 'train' || mode === 'coach' || (mode === 'evaluate' && evaluationResume === 'train')) ? 'train' : 'idle';
      paused = false; pausedMode = 'idle'; beginEvaluation(true, resume);
    } else if (initialized && command.type === 'compare') {
      if (!Number.isInteger(command.episodes) || command.episodes < 1 || command.episodes > 5000) throw new Error('Invalid comparison budget.');
      coachEnabled=false; const track = viewTrack; trainingTracks = [track]; variedStarts = false;
      comparisonJobs = (Object.keys(PRESETS) as Preset[]).filter(preset=>preset!=='adaptive').flatMap(preset => COMPARISON_SEEDS.map(seed => ({ preset, seed })));
      const first = comparisonJobs.shift()!; setupRun(track, first.preset, first.seed);
      stats.comparison = { targetLaps, id: id(), track, budget: command.episodes, rows: [], complete: false }; stats.comparisonRun = 1;
      mode = 'train'; stats.status = 'training'; stats.message = 'Comparison run 1/12. Every run starts from random weights; saved models are retained.'; publish();
    } else if (command.type === 'reset') { discard = true; mode = 'idle'; coach?.dispose(); agent?.dispose(); bestAgent?.dispose(); playbackAgent?.dispose(); }
  } catch (error) { mode = 'idle'; paused = true; send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
