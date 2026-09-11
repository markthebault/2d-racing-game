import type { DecisionReading } from './insights.ts';
import type { AgentFrame } from './environment.ts';
import type { FleetFrame } from './batch.ts';
import type { Preset } from './config.ts';
import type { EvaluationSummary } from './evaluation.ts';
import type { Checkpoint, StoredModel } from './models.ts';
export type { Checkpoint } from './models.ts';
export type EpisodeMetric = { track?: number; startFraction?: number; episode: number; score: number; mean: number; loss: number | null; progress: number; completed: boolean };
export type Milestone = { episode: number; best: number; bestEpisode: number; completion: number };
export type ComparisonRow = { preset: Preset; seed: number; episodes: number; steps: number; evaluation: EvaluationSummary; modelId: string };
export type ComparisonReport = { targetLaps?: number; id: string; track: number; budget: number; rows: ComparisonRow[]; complete: boolean };
export type TrainingStatus = 'loading' | 'coaching' | 'ready' | 'training' | 'evaluating' | 'paused' | 'playing' | 'replaying' | 'playback-ended' | 'error';
export type TrainingStats = {
  trainingTracks: number[]; trainingTrack: number; variedStarts: boolean; startFraction: number; evaluations: EvaluationSummary[]; replayCounts: { track: number; count: number }[];
  coachEnabled: boolean; coachSamples: number; coachUpdates: number; coachLoss: number | null;
  validation: { episode: number; results: EvaluationSummary[] } | null;
  minDistance: number;
  lastPlayback: { episode: number; score: number; reason: string; completedLaps: number; targetLaps: number } | null;
  backgroundLearning: boolean; queuedGroups: number; skippedGroups: number; playbackEpisode: number | null;
  targetLaps: number; completedLaps: number; checkpoints: number; checkpointCount: number; track: number; batchCount: number; trainedTracks: number[]; pausedActivity: string; currentScore: number;
  status: TrainingStatus; episode: number; steps: number; updates: number; epsilon: number; loss: number | null;
  mean: number | null; completion: number | null; best: Omit<Checkpoint, 'weights'> | null; evaluation: EvaluationSummary | null;
  history: EpisodeMetric[]; milestones: Milestone[]; replaySize: number; message: string;
  preset: Preset; seed: number; evaluationCase: string; comparison: ComparisonReport | null; comparisonRun: number;
};
export type WorkerCommand = { type: 'init'; coach?: boolean; trainingTracks?: number[]; variedStarts?: boolean; laps?: number; track: number; checkpoint: StoredModel | null; preset?: Preset; seed?: number }
  | { type: 'train' | 'resume' | 'pause' | 'play' | 'reset' | 'evaluate' | 'upgrade' | 'validate' }
  | { type: 'insights'; enabled: boolean }
  | { type: 'inspect'; fraction?: number; action?: number; restart?: boolean }
  | { type: 'compare'; episodes: number }
  | { type: 'track'; track: number; laps?: number }
  | { type: 'plan'; tracks: number[]; variedStarts: boolean }
  | { type: 'coach'; enabled: boolean }
  | { type: 'motion'; minDistance: number }
  | { type: 'skip-replay' }
  | { type: 'replay-speed'; speed: number }
  | { type: 'speed'; speed: number };
export type WorkerMessage = { type: 'insight'; reading: DecisionReading | null } | { type: 'stats'; stats: TrainingStats } | { type: 'frame'; frame: AgentFrame; track: number }
  | { type: 'fleet'; frame: FleetFrame | null }
  | { type: 'checkpoint'; checkpoint: Checkpoint } | { type: 'report'; report: ComparisonReport } | { type: 'error'; message: string };
export const emptyTrainingStats = (): TrainingStats => ({ coachEnabled: false, coachSamples: 0, coachUpdates: 0, coachLoss: null, validation: null, trainingTracks: [], trainingTrack: 0, variedStarts: false, startFraction: 0, evaluations: [], replayCounts: [], minDistance: 1, lastPlayback: null, backgroundLearning: false, queuedGroups: 0, skippedGroups: 0, playbackEpisode: null, targetLaps: 1, completedLaps: 0, checkpoints: 0, checkpointCount: 4, track: 0, batchCount: 0, trainedTracks: [], pausedActivity: '', currentScore: 0, status: 'loading', episode: 0, steps: 0, updates: 0, epsilon: 1, loss: null, mean: null, completion: null, best: null,
  evaluation: null, history: [], milestones: [], replaySize: 0, message: 'Preparing the learning engine…', preset: 'local', seed: 42, evaluationCase: '', comparison: null, comparisonRun: 0 });
