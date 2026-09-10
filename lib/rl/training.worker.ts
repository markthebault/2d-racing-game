import { DQNAgent, initializeTensorflow } from './agent.ts';
import { DrivingEnvironment, DECISION_SECONDS } from './environment.ts';
import { COMPARISON_SEEDS, DEFAULT_PRESET, OBSERVATION_VERSION, PRESETS, type Preset } from './config.ts';
import { EvaluationSuite, betterEvaluation } from './evaluation.ts';
import { MODEL_VERSION, migrateModel, type Checkpoint } from './models.ts';
import { emptyTrainingStats, type WorkerCommand, type WorkerMessage } from './protocol.ts';

const send = (message: WorkerMessage) => self.postMessage(message);
const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let agent: DQNAgent, bestAgent: DQNAgent, environment: DrivingEnvironment;
let evaluation: EvaluationSuite | null = null;
let evaluateBest = false;
let evaluationResume: 'train' | 'idle' = 'train';
let playback: DrivingEnvironment | null = null;
let best: Checkpoint | null = null;
let modelId = id(), parentId: string | null = null, trainedTracks: number[] = [];
const stats = emptyTrainingStats();
let mode: 'idle' | 'train' | 'evaluate' | 'play' = 'idle';
let speed = 4, lastPublish = 0;
let observation: number[];
let initialized = false, booting = false, discard = false, completedEpisodes = 0;
let comparisonJobs: { preset: Preset; seed: number }[] = [];
function publish() {
  if (!initialized) return;
  stats.steps = agent.steps; stats.updates = agent.updates; stats.epsilon = agent.epsilon;
  stats.loss = agent.loss; stats.replaySize = agent.replay.length;
  stats.evaluationCase = evaluation ? `${evaluation.index + 1}/5 · ${evaluation.label}` : '';
  send({ type: 'stats', stats }); lastPublish = performance.now();
}
function show() { send({ type: 'frame', frame: (mode === 'play' ? playback! : evaluation?.environment ?? environment).frame() }); }
function summaryOfBest() { if (best) { const { weights: _weights, ...summary } = best; stats.best = summary; } else stats.best = null; }
function beginEvaluation(useBest: boolean, resume: 'train' | 'idle') {
  evaluation = new EvaluationSuite(environment.track, stats.preset); evaluateBest = useBest; evaluationResume = resume;
  mode = 'evaluate'; stats.status = 'evaluating'; stats.message = 'Five varied starts, with exploration and learning disabled.'; publish();
}
function setupRun(track: number, preset: Preset, seed: number) {
  agent?.dispose(); bestAgent?.dispose();
  agent = new DQNAgent(seed); bestAgent = new DQNAgent(seed);
  environment = new DrivingEnvironment(track, preset); observation = environment.reset();
  best = null; evaluation = null; playback = null; parentId = null; trainedTracks = []; modelId = id(); completedEpisodes = 0;
  Object.assign(stats, { episode: 0, preset, seed, best: null, evaluation: null, history: [], milestones: [], mean: null, completion: null, evaluationCase: '' });
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
  stats.message = `Evaluation: ${(result.successRate * 100).toFixed(0)}% completed; mean score ${result.meanScore.toFixed(0)}. Best selection prioritizes completed laps.`;
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
  const action = agent.act(observation, true), result = environment.step(action);
  agent.remember({ state: observation, action, reward: result.reward, next: result.observation, done: result.done });
  observation = result.observation; agent.train();
  if (!result.done) return;
  stats.episode++; completedEpisodes += Number(environment.completed);
  const recent = [...stats.history.slice(-19).map(e => e.score), environment.score];
  const metric = { episode: stats.episode, score: environment.score, mean: recent.reduce((a, b) => a + b, 0) / recent.length,
    loss: agent.loss, progress: environment.frame().progress, completed: environment.completed };
  stats.history = [...stats.history, metric].slice(-300); stats.mean = metric.mean; stats.completion = completedEpisodes / stats.episode;
  stats.message = `Attempt ${stats.episode}: ${environment.reason.toLowerCase()}.`; observation = environment.reset();
  if (stats.episode === 1 || stats.episode % 10 === 0 || (stats.comparison && !stats.comparison.complete && stats.episode >= stats.comparison.budget)) beginEvaluation(false, 'train');
  publish();
}
async function loop() {
  while (!discard) {
    const start = performance.now();
    if (mode === 'train' || mode === 'evaluate') {
      do {
        if (mode === 'evaluate') {
          evaluation!.step(state => (evaluateBest ? bestAgent : agent).act(state));
          if (evaluation!.done) finishEvaluation();
        } else if (mode === 'train') trainStep();
        else break;
      } while ((mode === 'evaluate' || speed === 0) && performance.now() - start < 20);
    } else if (mode === 'play') {
      playback!.step(bestAgent.act(playback!.observe()));
      if (playback!.done) {
        show(); mode = 'idle'; stats.status = 'playback-ended';
        stats.message = `${playback!.reason}. Score ${playback!.score.toFixed(0)}. Playback did not update the learner.`; publish();
      }
    }
    if (mode !== 'idle' && performance.now() - lastPublish > 100) { show(); publish(); }
    const pace = mode === 'play' ? DECISION_SECONDS * 1000 : speed > 0 && mode === 'train' ? DECISION_SECONDS * 1000 / speed : 0;
    await sleep(mode === 'idle' ? 25 : Math.max(0, pace - (performance.now() - start)));
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
      setupRun(command.track, preset, seed);
      if (saved) {
        agent.loadWeights(saved.weights); bestAgent.loadWeights(saved.weights);
        parentId = saved.id; trainedTracks = saved.trainedTracks;
        // Source weights are reusable on every circuit; source scores are never treated as target scores.
        best = { ...saved, id: modelId, parentId: saved.id, track: command.track, episode: 0, evaluation: null };
        summaryOfBest();
      }
      initialized = true; stats.status = 'ready'; stats.message = 'Ready. New sessions use the selected experiment and seed.';
      publish(); show();
      if (saved) beginEvaluation(true, 'idle');
      void loop().catch(error => { mode = 'idle'; send({ type: 'error', message: String(error) }); });
    } else if (command.type === 'speed') speed = [0, 1, 4, 20].includes(command.speed) ? command.speed : 4;
    else if (initialized && command.type === 'pause') { mode = 'idle'; stats.status = 'paused'; stats.message = 'Paused. Current attempt, evaluation, weights and replay memory are retained.'; publish(); }
    else if (initialized && command.type === 'train') {
      mode = evaluation ? 'evaluate' : 'train'; if (evaluation) evaluationResume = 'train';
      stats.status = evaluation ? 'evaluating' : 'training'; stats.message = 'Learning from driving attempts.'; publish();
    } else if (initialized && command.type === 'play' && best) {
      playback = new DrivingEnvironment(environment.track, stats.preset); mode = 'play'; stats.status = 'playing';
      stats.message = 'Driving the saved weights on the selected circuit. No exploration or learning.'; show(); publish();
    } else if (initialized && command.type === 'evaluate' && best) {
      if (stats.comparison && !stats.comparison.complete) throw new Error('Finish or pause the comparison and use Run best model; its scheduled evaluations stay unchanged.');
      beginEvaluation(true, 'idle');
    } else if (initialized && command.type === 'compare') {
      if (!Number.isInteger(command.episodes) || command.episodes < 1 || command.episodes > 5000) throw new Error('Invalid comparison budget.');
      const track = environment.track;
      comparisonJobs = (Object.keys(PRESETS) as Preset[]).flatMap(preset => COMPARISON_SEEDS.map(seed => ({ preset, seed })));
      const first = comparisonJobs.shift()!; setupRun(track, first.preset, first.seed);
      stats.comparison = { id: id(), track, budget: command.episodes, rows: [], complete: false }; stats.comparisonRun = 1;
      mode = 'train'; stats.status = 'training'; stats.message = 'Comparison run 1/12. Every run starts from random weights; saved models are retained.'; publish();
    } else if (command.type === 'reset') { discard = true; mode = 'idle'; agent?.dispose(); bestAgent?.dispose(); }
  } catch (error) { mode = 'idle'; send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
