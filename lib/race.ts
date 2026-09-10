import * as THREE from 'three';

export const TRACKS = [
  { roadScale: 1, cornerRadius: 0, name: 'Park oval', kind: 'EASY', description: 'Wide turns. Room to find your rhythm.', ground: '#547950', edge: '#80a268', points: [[0,24],[-30,24],[-45,12],[-45,-12],[-28,-24],[28,-24],[45,-12],[45,12],[30,24]] },
  { roadScale: 1, cornerRadius: 8, name: 'Pine bend', kind: 'MEDIUM', description: 'A double chicane and a deep infield hairpin.', ground: '#365f55', edge: '#5d8975', points: [[0,35],[-60,35],[-60,10],[-40,10],[-40,-15],[-60,-15],[-60,-40],[-10,-40],[-10,-10],[20,-10],[20,-40],[60,-40],[60,35]] },
  { roadScale: 0.7, cornerRadius: 5.5, name: 'Desert switchback', kind: 'HARD', description: 'Narrow road. Three hairpins. No room for a lazy line.', ground: '#ae8759', edge: '#c8a775', points: [[0,65],[-80,65],[-85,30],[-65,10],[-82,-10],[-64,-38],[-30,-50],[0,-34],[32,-50],[78,-30],[78,-10],[-10,-10],[-10,10],[52,10],[52,30],[-10,30],[-10,48],[78,48],[78,65]] },
] as const;
export const ROAD_WIDTH = 10;
export const ROAD_EDGE_OFFSET = 5.1;
/** Shared by rendered ribbons and sensor boundaries so both use identical edges. */
export function offsetTrackPoint(points: THREE.Vector3[], index: number, offset: number) {
  const count = points.length;
  const p = points[index % count];
  const next = points[(index + 1) % count];
  const previous = points[(index + count - 1) % count];
  const dx = next.x - previous.x, dz = next.z - previous.z;
  const length = Math.hypot(dx, dz);
  return { x: p.x - dz / length * offset, z: p.z + dx / length * offset };
}
export function trackEdges(points: THREE.Vector3[], roadEdgeOffset = ROAD_EDGE_OFFSET) {
  return [-roadEdgeOffset, roadEdgeOffset].flatMap(offset => {
    const edge = points.map((_, i) => offsetTrackPoint(points, i, offset));
    return edge.map((a, i) => ({ a, b: edge[(i + 1) % edge.length] }));
  });
}
/** A periodic cubic B-spline rounds corners without interpolating sharp control vertices.
 * Tight interpolating bends can have a radius smaller than the road half-width,
 * making the offset asphalt, kerb and shoulder boundaries fold over themselves.
 */
class RoundedTrackCurve extends THREE.Curve<THREE.Vector3> {
  private points: THREE.Vector3[];

  constructor(points: THREE.Vector3[]) {
    super();
    this.points = points;
    this.arcLengthDivisions = 4096;
  }

  getPoint(t: number, target = new THREE.Vector3()) {
    const count = this.points.length;
    const u = (t === 1 ? 0 : t) * count;
    const index = Math.floor(u), f = u - index, f2 = f * f, f3 = f2 * f;
    const weights = [
      (1 - 3 * f + 3 * f2 - f3) / 6,
      (4 - 6 * f2 + 3 * f3) / 6,
      (1 + 3 * f + 3 * f2 - 3 * f3) / 6,
      f3 / 6,
    ];
    target.set(0, 0, 0);
    weights.forEach((weight, i) => target.addScaledVector(this.points[(index + i + count - 1) % count], weight));
    return target;
  }
}

type TrackPiece = { start: THREE.Vector3; end: THREE.Vector3; length: number; center?: THREE.Vector3; angle?: number; sweep?: number };

/** Tangent circular fillets preserve tight turns and straights without offset loops. */
class TechnicalTrackCurve extends THREE.Curve<THREE.Vector3> {
  private pieces: TrackPiece[] = [];
  private totalLength = 0;

  constructor(points: THREE.Vector3[], radius: number) {
    super();
    this.arcLengthDivisions = 4096;
    const corners = points.map((point, i) => {
      const incoming = point.clone().sub(points[(i + points.length - 1) % points.length]).normalize();
      const outgoing = points[(i + 1) % points.length].clone().sub(point).normalize();
      const sweep = Math.atan2(incoming.x * outgoing.z - incoming.z * outgoing.x, incoming.dot(outgoing));
      const trim = radius * Math.tan(Math.abs(sweep) / 2);
      const start = point.clone().addScaledVector(incoming, -trim);
      const end = point.clone().addScaledVector(outgoing, trim);
      const center = start.clone().add(new THREE.Vector3(-incoming.z, 0, incoming.x).multiplyScalar(Math.sign(sweep) * radius));
      return { start, end, center, sweep, trim, angle: Math.atan2(start.z - center.z, start.x - center.x) };
    });
    corners.forEach((corner, i) => {
      const next = corners[(i + 1) % corners.length];
      const available = points[i].distanceTo(points[(i + 1) % points.length]);
      if (corner.trim + next.trim >= available) throw new Error('Track corners are too close for their radius');
      if (Math.abs(corner.sweep) > 1e-9) this.pieces.push({ ...corner, length: Math.abs(corner.sweep) * radius });
      this.pieces.push({ start: corner.end, end: next.start, length: corner.end.distanceTo(next.start) });
    });
    this.totalLength = this.pieces.reduce((sum, piece) => sum + piece.length, 0);
  }

  getPoint(t: number, target = new THREE.Vector3()) {
    let remaining = Math.max(0, Math.min(t, 1)) * this.totalLength;
    for (const piece of this.pieces) {
      if (remaining <= piece.length + 1e-9) {
        const fraction = Math.min(1, remaining / piece.length);
        if (piece.center) {
          const radius = piece.start.distanceTo(piece.center);
          const angle = piece.angle! + piece.sweep! * fraction;
          return target.set(piece.center.x + Math.cos(angle) * radius, 0, piece.center.z + Math.sin(angle) * radius);
        }
        return target.copy(piece.start).lerp(piece.end, fraction);
      }
      remaining -= piece.length;
    }
    return target.copy(this.pieces[0].start);
  }

  // Pieces are already parameterized by distance, including the circular arcs.
  getPointAt(u: number, target = new THREE.Vector3()) { return this.getPoint(u, target); }
  getLength() { return this.totalLength; }
}

export function trackCurve(index: number) {
  const track = TRACKS[index];
  const points = track.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  return track.cornerRadius ? new TechnicalTrackCurve(points, track.cornerRadius) : new RoundedTrackCurve(points);
}
export function trackBounds(points: readonly { x: number; z: number }[], padding = 10) {
  return {
    minX: Math.min(...points.map(p => p.x)) - padding,
    maxX: Math.max(...points.map(p => p.x)) + padding,
    minZ: Math.min(...points.map(p => p.z)) - padding,
    maxZ: Math.max(...points.map(p => p.z)) + padding,
  };
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
