export const OBSERVATION_VERSION = 3;
export const OBSERVATION_SIZE = 36;
export const PRESETS = {
  baseline: { label: '1 · Corrected baseline', speedBonus: true, normalizedProgress: false, absolutePosition: true },
  'no-speed': { label: '2 · Remove speed bonus', speedBonus: false, normalizedProgress: false, absolutePosition: true },
  normalized: { label: '3 · Normalize progress', speedBonus: false, normalizedProgress: true, absolutePosition: true },
  local: { label: '4 · Local inputs', speedBonus: false, normalizedProgress: true, absolutePosition: false },
} as const;
export type Preset = keyof typeof PRESETS;
export const DEFAULT_PRESET: Preset = 'local';
export const COMPARISON_SEEDS = [42, 1337, 2026] as const;
export const PROGRESS_POINTS_PER_LAP = 750;
export const squash = (value: number) => value / (1 + Math.abs(value));
export function progressRewards(fresh: number, delta: number, speed: number, length: number, preset: Preset) {
  const config = PRESETS[preset], rate = config.normalizedProgress ? PROGRESS_POINTS_PER_LAP / length : 3;
  return { progress: fresh * rate, reverse: -Math.max(0, -delta) * rate, speed: config.speedBonus ? fresh * Math.max(0, speed) / 40 : 0 };
}

export const CHECKPOINT_COUNTS = [4, 6, 8, 6, 8] as const;
export const CHECKPOINT_POINTS_PER_LAP = 1000;
