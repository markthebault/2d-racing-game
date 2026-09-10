import * as THREE from 'three';

export const TRACKS = [
  { name: 'Park oval', kind: 'EASY', description: 'Wide turns. Room to find your rhythm.', ground: '#547950', edge: '#80a268', points: [[0,24],[-30,24],[-45,12],[-45,-12],[-28,-24],[28,-24],[45,-12],[45,12],[30,24]] },
  { name: 'Pine bend', kind: 'MEDIUM', description: 'A flowing loop with a tucked-in hairpin.', ground: '#365f55', edge: '#5d8975', points: [[0,25],[-30,25],[-44,10],[-35,-13],[-15,-25],[10,-24],[12,-5],[37,-9],[43,12],[27,25]] },
  { name: 'Desert sprint', kind: 'HARD', description: 'Short straights. Keep the corners tidy.', ground: '#ae8759', edge: '#c8a775', points: [[0,24],[-29,24],[-43,10],[-31,-4],[-41,-21],[-13,-25],[5,-10],[30,-23],[44,-4],[31,21]] },
] as const;
export const ROAD_WIDTH = 10;
export function trackCurve(index: number) {
  return new THREE.CatmullRomCurve3(TRACKS[index].points.map(([x,z]) => new THREE.Vector3(x,0,z)), true, 'catmullrom', .35);
}
export function sampleTrack(index: number) { return trackCurve(index).getSpacedPoints(600).slice(0,600); }
export function nearestPoint(points: THREE.Vector3[], x: number, z: number) {
  let index = 0, distance = Infinity;
  points.forEach((p,i) => { const d = (p.x-x)**2+(p.z-z)**2; if(d<distance) { distance=d; index=i; } });
  return { index, distance: Math.sqrt(distance) };
}
export type Progress = { previous: number; distance: number; laps: number };
export function advanceProgress(state: Progress, index: number, onRoad: boolean, count: number) {
  let delta = index - state.previous;
  if(delta > count/2) delta -= count;
  if(delta < -count/2) delta += count;
  state.previous = index;
  // Off-road travel never earns progress; reverse travel must be made up.
  if(onRoad && Math.abs(delta)<count/12) state.distance += delta;
  if(state.distance >= count - 2 && index < 5) { state.laps++; state.distance -= count; return true; }
  return false;
}
export function formatTime(seconds: number) {
  const ms = Math.floor(seconds*1000);
  return `${Math.floor(ms/60000).toString().padStart(2,'0')}:${Math.floor(ms/1000%60).toString().padStart(2,'0')}.${Math.floor(ms%1000/10).toString().padStart(2,'0')}`;
}
