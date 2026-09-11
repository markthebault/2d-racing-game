export type Pose = { x: number; z: number; heading: number; time: number };
export type RecordedRun = { episode: number; track?: number; poses: Pose[]; completed: boolean };
export type FleetFrame = { track: number; poses: (Pose & { done: boolean; completed: boolean })[]; time: number; duration: number; first: number; last: number; speed: number };
export function sampleBatch(runs: RecordedRun[], time: number, track: number, speed = 1): FleetFrame {
  const duration = Math.max(0, ...runs.map(r => r.poses.at(-1)!.time));
  return { track, time: Math.min(time, duration), duration, speed, first: runs[0]?.episode ?? 0, last: runs.at(-1)?.episode ?? 0,
    poses: runs.filter(run => run.track === undefined || run.track === track).map(run => {
      const last = run.poses.at(-1)!;
      const index = Math.min(Math.floor(time / .1), run.poses.length - 1);
      const a = run.poses[index], b = run.poses[Math.min(index + 1, run.poses.length - 1)];
      const t = b.time > a.time ? Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time))) : 0;
      const angle = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: a.heading + angle * t, time, done: time >= last.time, completed: run.completed };
    }) };
}
