/** Pure 2D sensing in the game's x/z plane, independent of rendering or controls. */
export type Point2 = { x: number; z: number };
export type EdgeSegment = { a: Point2; b: Point2 };
export type RayDefinition = {
  id: string;
  bank: 'front' | 'rear';
  /** Relative to the nose: negative turns left, positive turns right. */
  angleDeg: number;
  maxRange: number;
  /** Longitudinal offset from the center of the car, in world units. */
  originOffset: number;
};
export type RayReading = RayDefinition & {
  origin: Point2;
  end: Point2;
  limit: Point2;
  distance: number;
  normalizedDistance: number;
  hit: boolean;
};

// Stable ordering is part of the observation contract: F1–F9, then B1–B3.
// All distances are world units, not calibrated physical meters.
export const RAY_DEFINITIONS: readonly RayDefinition[] = [
  { id: 'F1', bank: 'front', angleDeg: -75, maxRange: 10, originOffset: 1.65 },
  { id: 'F2', bank: 'front', angleDeg: -50, maxRange: 16, originOffset: 1.65 },
  { id: 'F3', bank: 'front', angleDeg: -30, maxRange: 24, originOffset: 1.65 },
  { id: 'F4', bank: 'front', angleDeg: -15, maxRange: 30, originOffset: 1.65 },
  { id: 'F5', bank: 'front', angleDeg: 0, maxRange: 32, originOffset: 1.65 },
  { id: 'F6', bank: 'front', angleDeg: 15, maxRange: 30, originOffset: 1.65 },
  { id: 'F7', bank: 'front', angleDeg: 30, maxRange: 24, originOffset: 1.65 },
  { id: 'F8', bank: 'front', angleDeg: 50, maxRange: 16, originOffset: 1.65 },
  { id: 'F9', bank: 'front', angleDeg: 75, maxRange: 10, originOffset: 1.65 },
  { id: 'B1', bank: 'rear', angleDeg: -135, maxRange: 10, originOffset: -1.65 },
  { id: 'B2', bank: 'rear', angleDeg: 180, maxRange: 16, originOffset: -1.65 },
  { id: 'B3', bank: 'rear', angleDeg: 135, maxRange: 10, originOffset: -1.65 },
];

const EPSILON = 1e-9;
const cross = (a: Point2, b: Point2) => a.x * b.z - a.z * b.x;

/** First forward intersection, including endpoints and collinear overlap.
 * Direction must have unit length; distance is capped at maxRange.
 */
export function castRay(origin: Point2, direction: Point2, maxRange: number, edges: readonly EdgeSegment[]) {
  let distance = maxRange;
  let hit = false;
  for (const { a, b } of edges) {
    const segment = { x: b.x - a.x, z: b.z - a.z };
    const relative = { x: a.x - origin.x, z: a.z - origin.z };
    const denominator = cross(direction, segment);
    let t: number;
    if (Math.abs(denominator) < EPSILON) {
      if (Math.abs(cross(relative, direction)) > EPSILON) continue;
      const t0 = relative.x * direction.x + relative.z * direction.z;
      const t1 = (b.x - origin.x) * direction.x + (b.z - origin.z) * direction.z;
      if (Math.max(t0, t1) < -EPSILON) continue;
      t = Math.max(0, Math.min(t0, t1));
    } else {
      t = cross(relative, segment) / denominator;
      const u = cross(relative, direction) / denominator;
      if (t < -EPSILON || u < -EPSILON || u > 1 + EPSILON) continue;
    }
    if (t <= distance + EPSILON) {
      distance = Math.max(0, Math.min(distance, t));
      hit = true;
    }
  }
  return { distance, hit };
}

export function senseTrack(
  position: Point2,
  heading: number,
  edges: readonly EdgeSegment[],
  definitions: readonly RayDefinition[] = RAY_DEFINITIONS,
): RayReading[] {
  const forward = { x: Math.cos(heading), z: Math.sin(heading) };
  return definitions.map((definition) => {
    const origin = {
      x: position.x + forward.x * definition.originOffset,
      z: position.z + forward.z * definition.originOffset,
    };
    const angle = heading + definition.angleDeg * Math.PI / 180;
    const direction = { x: Math.cos(angle), z: Math.sin(angle) };
    const { distance, hit } = castRay(origin, direction, definition.maxRange, edges);
    return {
      ...definition, origin, distance, hit,
      normalizedDistance: distance / definition.maxRange,
      end: { x: origin.x + direction.x * distance, z: origin.z + direction.z * distance },
      limit: { x: origin.x + direction.x * definition.maxRange, z: origin.z + direction.z * definition.maxRange },
    };
  });
}
