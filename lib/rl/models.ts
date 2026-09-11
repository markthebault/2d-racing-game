import { TRACKS } from '../race.ts';
import type { Weights } from './agent.ts';
import { OBSERVATION_SIZE, OBSERVATION_VERSION, PRESETS, type Preset } from './config.ts';
import type { EvaluationSummary } from './evaluation.ts';
export const MODEL_VERSION = 2;
export const MODEL_PREFIX = 'pocket-circuit-model-v2-';
export type Checkpoint = {
  version: 2; observationVersion: number; id: string; track: number; preset: Preset; seed: number;
  evaluations?: EvaluationSummary[];
  guided?: boolean;
  episode: number; trainedTracks: number[]; parentId: string | null; evaluation: EvaluationSummary | null; weights: Weights;
};
export type LegacyCheckpoint = { version: 1; track: number; episode: number; score: number; progress: number; completed: boolean; weights: Weights };
export type StoredModel = Checkpoint | LegacyCheckpoint;
export const modelKey = (model: StoredModel) => model.version === 1 ? `pocket-circuit-dqn-v1-track-${model.track}` : MODEL_PREFIX + model.id;
export function migrateModel(saved: StoredModel): Checkpoint {
  if (!saved || !Number.isInteger(saved.track) || saved.track < 0 || saved.track >= TRACKS.length || !Number.isInteger(saved.episode) || saved.episode < 0) throw new Error('Invalid saved model metadata.');
  if (saved.version === 2) {
    if (![2, 3, OBSERVATION_VERSION].includes(saved.observationVersion) || !PRESETS[saved.preset] || !saved.id || !Number.isInteger(saved.seed) || !Array.isArray(saved.trainedTracks) || saved.trainedTracks.some(t => !Number.isInteger(t) || t < 0 || t >= TRACKS.length)) throw new Error('Incompatible saved model.');
    if (saved.observationVersion !== OBSERVATION_VERSION) {
      const oldSize = saved.observationVersion === 2 ? 34 : 36;
      if (saved.weights?.[0]?.shape?.[0] !== oldSize || saved.weights[0].shape[1] !== 64 || saved.weights[0].values.length !== oldSize * 64) throw new Error('Incompatible saved weights.');
      const weights = saved.weights.map((w, i) => i === 0 ? { shape: [OBSERVATION_SIZE, 64], values: [...w.values, ...Array((OBSERVATION_SIZE - oldSize) * 64).fill(0)] } : { shape: [...w.shape], values: [...w.values] });
      return { ...saved, observationVersion: OBSERVATION_VERSION, evaluation: null, evaluations: [], weights };
    }
    return saved;
  }
  if (saved.version !== 1 || saved.weights?.[0]?.shape?.[0] !== 28 || saved.weights[0].shape[1] !== 64 || saved.weights[0].values?.length !== 28 * 64) throw new Error('Unsupported legacy model.');
  // Preserve every original feature weight. New history features initially have zero influence.
  const weights = saved.weights.map((w, i) => i === 0 ? { shape: [OBSERVATION_SIZE, 64], values: [...w.values, ...Array((OBSERVATION_SIZE - 28) * 64).fill(0)] } : { shape: [...w.shape], values: [...w.values] });
  return { version: MODEL_VERSION, observationVersion: OBSERVATION_VERSION, id: `legacy-track-${saved.track}`, track: saved.track, preset: 'baseline', seed: 42, episode: saved.episode,
    trainedTracks: [saved.track], parentId: null, evaluation: null, evaluations: [], weights };
}
