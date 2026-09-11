import { DEFAULT_MIN_DISTANCE } from './motion.ts';
import { DrivingEnvironment, type StartPose } from './environment.ts';
import type { Preset } from './config.ts';

export const EVALUATION_VERSION = 3;
// Identical cases for every seed and experiment; independent of the training RNG.
export const EVALUATION_STARTS: readonly (StartPose & { name: string })[] = [
  { name: 'Start line', fraction: 0, offset: 0, heading: 0 },
  { name: 'Start line · left', fraction: 0, offset: -.8, heading: -.10 },
  { name: 'Start line · right', fraction: 0, offset: .8, heading: .10 },
  { name: 'One-third around', fraction: 1 / 3, offset: -.4, heading: .06 },
  { name: 'Two-thirds around', fraction: 2 / 3, offset: .4, heading: -.06 },
];
export type EvaluationRun = { name: string; score: number; progress: number; completed: boolean; time: number; offroadTime: number; reason: string };
export type EvaluationSummary = { version: number; minDistance: number; targetLaps: number; track: number; runs: EvaluationRun[]; successRate: number; meanScore: number; meanProgress: number; meanOffroadTime: number; meanLapTime: number | null };
export function summarizeEvaluation(track: number, runs: EvaluationRun[], targetLaps = 1, minDistance = DEFAULT_MIN_DISTANCE): EvaluationSummary {
  if (runs.length !== EVALUATION_STARTS.length) throw new Error('Evaluation must include every start case.');
  const laps = runs.filter(r => r.completed), mean = (field: 'score' | 'progress' | 'offroadTime') => runs.reduce((sum, r) => sum + r[field], 0) / runs.length;
  return { version: EVALUATION_VERSION, minDistance, targetLaps, track, runs: runs.map(r => ({ ...r })), successRate: laps.length / runs.length,
    meanScore: mean('score'), meanProgress: mean('progress'), meanOffroadTime: mean('offroadTime'),
    meanLapTime: laps.length ? laps.reduce((sum, r) => sum + r.time, 0) / laps.length / targetLaps : null };
}
export function betterEvaluation(candidate: EvaluationSummary, incumbent: EvaluationSummary | null) {
  if (!incumbent) return true;
  if (candidate.minDistance !== incumbent.minDistance || candidate.track !== incumbent.track || candidate.version !== incumbent.version || candidate.targetLaps !== incumbent.targetLaps) throw new Error('Cannot rank evaluations from different tracks or suites.');
  // Reliability outranks score. Scores are compared only within the same reward preset by the caller.
  if (candidate.successRate !== incumbent.successRate) return candidate.successRate > incumbent.successRate;
  return candidate.meanScore > incumbent.meanScore;
}
export class EvaluationSuite {
  readonly environment: DrivingEnvironment;
  readonly runs: EvaluationRun[] = [];
  index = 0;
  constructor(track: number, preset: Preset, targetLaps = 1, minDistance = DEFAULT_MIN_DISTANCE) { this.environment = new DrivingEnvironment(track, preset, false, targetLaps, minDistance); this.environment.reset(EVALUATION_STARTS[0]); }
  get done() { return this.runs.length === EVALUATION_STARTS.length; }
  get label() { return EVALUATION_STARTS[Math.min(this.index, EVALUATION_STARTS.length - 1)].name; }
  step(act: (observation: number[]) => number) {
    if (this.done) throw new Error('Evaluation already complete.');
    const env = this.environment;
    env.step(act(env.observe()));
    if (env.done) {
      this.runs.push({ name: this.label, score: env.score, progress: env.frame().progress, completed: env.completed, time: env.time, offroadTime: env.totalOffroadTime, reason: env.reason });
      this.index++;
      if (!this.done) env.reset(EVALUATION_STARTS[this.index]);
    }
  }
  summary() { return summarizeEvaluation(this.environment.track, this.runs, this.environment.targetLaps, this.environment.minDistance); }
}
