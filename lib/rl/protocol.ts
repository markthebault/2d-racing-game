import type { AgentFrame } from './environment.ts';
import type { Preset } from './config.ts';
import type { EvaluationSummary } from './evaluation.ts';
import type { Checkpoint, StoredModel } from './models.ts';
export type { Checkpoint } from './models.ts';
export type EpisodeMetric = { episode: number; score: number; mean: number; loss: number | null; progress: number; completed: boolean };
export type Milestone = { episode: number; best: number; bestEpisode: number; completion: number };
export type ComparisonRow = { preset: Preset; seed: number; episodes: number; steps: number; evaluation: EvaluationSummary; modelId: string };
export type ComparisonReport = { id: string; track: number; budget: number; rows: ComparisonRow[]; complete: boolean };
export type TrainingStatus = 'loading' | 'ready' | 'training' | 'evaluating' | 'paused' | 'playing' | 'playback-ended' | 'error';
export type TrainingStats = {
  status: TrainingStatus; episode: number; steps: number; updates: number; epsilon: number; loss: number | null;
  mean: number | null; completion: number | null; best: Omit<Checkpoint, 'weights'> | null; evaluation: EvaluationSummary | null;
  history: EpisodeMetric[]; milestones: Milestone[]; replaySize: number; message: string;
  preset: Preset; seed: number; evaluationCase: string; comparison: ComparisonReport | null; comparisonRun: number;
};
export type WorkerCommand = { type: 'init'; track: number; checkpoint: StoredModel | null; preset?: Preset; seed?: number }
  | { type: 'train' | 'pause' | 'play' | 'reset' | 'evaluate' }
  | { type: 'compare'; episodes: number }
  | { type: 'speed'; speed: number };
export type WorkerMessage = { type: 'stats'; stats: TrainingStats } | { type: 'frame'; frame: AgentFrame }
  | { type: 'checkpoint'; checkpoint: Checkpoint } | { type: 'report'; report: ComparisonReport } | { type: 'error'; message: string };
export const emptyTrainingStats = (): TrainingStats => ({ status: 'loading', episode: 0, steps: 0, updates: 0, epsilon: 1, loss: null, mean: null, completion: null, best: null,
  evaluation: null, history: [], milestones: [], replaySize: 0, message: 'Preparing the learning engine…', preset: 'local', seed: 42, evaluationCase: '', comparison: null, comparisonRun: 0 });
