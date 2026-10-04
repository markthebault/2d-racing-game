import { offsetTrackPoint } from './race.ts';
import type * as THREE from 'three';
import type { EdgeSegment, Point2 } from './sensors.ts';
import type { VehicleState } from './vehicle.ts';

export const TIRE_RADIUS = 0.4;
export const BARRIER_OFFSET = 6.8;
// A capsule covers the formula car's wheels, wings and nose in the x/z plane.
export const CAR_RADIUS = 1.25;
export const CAR_HALF_AXIS = 1;
const CLEARANCE = CAR_RADIUS + TIRE_RADIUS + 0.002;
const CELL_SIZE = 8;

/** Rendering and physics share the same continuous tire-wall centerlines. */
export function trackBarriers(points: THREE.Vector3[], roadScale: number) {
  const walls: EdgeSegment[] = [];
  const tires: (Point2 & { index: number })[] = [];
  for (const side of [-1, 1]) {
    const ring = points.map((_, i) =>
      offsetTrackPoint(points, i, side * BARRIER_OFFSET * roadScale),
    );
    ring.forEach((a, index) => {
      const b = ring[(index + 1) % ring.length];
      walls.push({ a, b });
      // Long circuits need extra tires so the visible barrier has no gaps.
      const count = Math.max(
        1,
        Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.65),
      );
      for (let i = 0; i < count; i++) {
        const t = i / count;
        tires.push({
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t,
          index,
        });
      }
    });
  }
  return { walls, tires };
}

function pointSegmentDistanceSquared(p: Point2, a: Point2, b: Point2) {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared
    ? Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSquared),
      )
    : 0;
  return (p.x - a.x - dx * t) ** 2 + (p.z - a.z - dz * t) ** 2;
}
function orientation(a: Point2, b: Point2, c: Point2) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}
function segmentDistanceSquared(a: Point2, b: Point2, c: Point2, d: Point2) {
  if (
    orientation(a, b, c) * orientation(a, b, d) < 0 &&
    orientation(c, d, a) * orientation(c, d, b) < 0
  )
    return 0;
  return Math.min(
    pointSegmentDistanceSquared(a, c, d),
    pointSegmentDistanceSquared(b, c, d),
    pointSegmentDistanceSquared(c, a, b),
    pointSegmentDistanceSquared(d, a, b),
  );
}

/** Spatial indexing keeps collision checks local even on the longest circuits. */
export class BarrierWorld {
  private cells = new Map<string, number[]>();
  readonly walls: readonly EdgeSegment[];
  constructor(walls: readonly EdgeSegment[]) {
    this.walls = walls;
    walls.forEach(({ a, b }, index) => {
      for (
        let x = Math.floor((Math.min(a.x, b.x) - TIRE_RADIUS) / CELL_SIZE);
        x <= Math.floor((Math.max(a.x, b.x) + TIRE_RADIUS) / CELL_SIZE);
        x++
      ) {
        for (
          let z = Math.floor((Math.min(a.z, b.z) - TIRE_RADIUS) / CELL_SIZE);
          z <= Math.floor((Math.max(a.z, b.z) + TIRE_RADIUS) / CELL_SIZE);
          z++
        ) {
          const key = `${x},${z}`;
          const entries = this.cells.get(key) ?? [];
          entries.push(index);
          this.cells.set(key, entries);
        }
      }
    });
  }

  overlaps(state: Pick<VehicleState, 'x' | 'z' | 'heading'>) {
    const dx = Math.cos(state.heading) * CAR_HALF_AXIS,
      dz = Math.sin(state.heading) * CAR_HALF_AXIS;
    const a = { x: state.x - dx, z: state.z - dz },
      b = { x: state.x + dx, z: state.z + dz };
    const checked = new Set<number>();
    for (
      let x = Math.floor((Math.min(a.x, b.x) - CLEARANCE) / CELL_SIZE);
      x <= Math.floor((Math.max(a.x, b.x) + CLEARANCE) / CELL_SIZE);
      x++
    ) {
      for (
        let z = Math.floor((Math.min(a.z, b.z) - CLEARANCE) / CELL_SIZE);
        z <= Math.floor((Math.max(a.z, b.z) + CLEARANCE) / CELL_SIZE);
        z++
      ) {
        for (const index of this.cells.get(`${x},${z}`) ?? []) {
          if (checked.has(index)) continue;
          checked.add(index);
          const wall = this.walls[index];
          if (segmentDistanceSquared(a, b, wall.a, wall.b) < CLEARANCE ** 2)
            return true;
        }
      }
    }
    return false;
  }

  /** Sweep translation and rotation, then stop just before the first contact. */
  stopAtContact(previous: VehicleState, next: VehicleState) {
    const turn = next.heading - previous.heading;
    const distance =
      Math.hypot(next.x - previous.x, next.z - previous.z) +
      Math.abs(turn) * (CAR_HALF_AXIS + CAR_RADIUS);
    const steps = Math.max(1, Math.ceil(distance / 0.2));
    const pose = (t: number) => ({
      x: previous.x + (next.x - previous.x) * t,
      z: previous.z + (next.z - previous.z) * t,
      heading: previous.heading + turn * t,
    });
    for (let i = 1; i <= steps; i++) {
      if (!this.overlaps(pose(i / steps))) continue;
      let low = (i - 1) / steps,
        high = i / steps;
      for (let iteration = 0; iteration < 14; iteration++) {
        const middle = (low + high) / 2;
        if (this.overlaps(pose(middle))) high = middle;
        else low = middle;
      }
      Object.assign(next, pose(low), { speed: 0 });
      return true;
    }
    return false;
  }
}
