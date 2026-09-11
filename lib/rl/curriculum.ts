import { TRACKS } from '../race.ts';
import { GRID_START, type StartPose } from './environment.ts';
/** Equal episode counts on each track; half grid starts, half reproducible varied starts. */
export function trainingStart(attempt: number, varied: boolean, random: () => number): StartPose {
  if (!varied || attempt % 2 === 0) return { ...GRID_START };
  return { fraction: .05 + random() * .9, offset: (random() * 2 - 1) * .7, heading: (random() * 2 - 1) * .08 };
}
export function validateTrainingTracks(tracks: number[]) {
  if (!Array.isArray(tracks) || ![1, 3].includes(tracks.length) || new Set(tracks).size !== tracks.length || tracks.some(t => !Number.isInteger(t) || !TRACKS[t])) throw new Error('Choose exactly three different training tracks, or one for single-track training.');
  return [...tracks].sort((a, b) => a - b);
}
