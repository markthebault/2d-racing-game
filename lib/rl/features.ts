/** One configuration per training worker, shared by every environment it creates. */
export const FEATURE_GROUPS = [
  { id: 'rays', label: 'Ray distances', description: 'Road-edge distances and forward time to boundary.', indices: [...Array.from({length:12},(_,i)=>i),49] },
  { id: 'car', label: 'Car measurements', description: 'Speed, pedals, steering and turning rate.', indices: [12,13,14,15,50,51] },
  { id: 'motion', label: 'Recent movement', description: 'Movement distance, observation window and stuck threshold.', indices: [46,47,48] },
  { id: 'road', label: 'Position relative to road', description: 'Map-derived offset, heading and off-road state.', indices: [16,17,18,19,27] },
  { id: 'preview', label: 'Road preview', description: 'Map-derived upcoming headings, waypoints and road width.', indices: [24,25,26,36,37,38,39,40,41,42,43,44] },
  { id: 'safeSpeed', label: 'Safe corner speed', description: 'Speed recommendation calculated from the map.', indices: [45] },
  { id: 'progress', label: 'Race progress and time', description: 'Lap, checkpoint, progress and timer information.', indices: [28,29,30,31,32,33,34,35] },
  { id: 'absolute', label: 'Absolute map position', description: 'World coordinates and circuit position. Also requires a preset that allows these inputs.', indices: [20,21,22,23] },
] as const;
export type FeatureSettings = Record<(typeof FEATURE_GROUPS)[number]['id'], boolean>;
export const DEFAULT_FEATURES = Object.fromEntries(FEATURE_GROUPS.map(g=>[g.id,true])) as FeatureSettings;
export const SENSOR_FEATURES = Object.fromEntries(FEATURE_GROUPS.map(g=>[g.id,['rays','car','motion'].includes(g.id)])) as FeatureSettings;
let settings: FeatureSettings = {...DEFAULT_FEATURES};
export function configureFeatures(value?: FeatureSettings) {
  if(value && FEATURE_GROUPS.some(g=>typeof value[g.id] !== 'boolean')) throw new Error('Invalid training feature settings.');
  settings = {...(value ?? DEFAULT_FEATURES)};
}
export function currentFeatures(): FeatureSettings { return {...settings}; }
export function maskFeatures(values: number[]) {
  for(const group of FEATURE_GROUPS) if(!settings[group.id]) for(const index of group.indices) values[index]=0;
  return values;
}
