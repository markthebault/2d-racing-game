import test from 'node:test';
import assert from 'node:assert/strict';
import { castRay, senseTrack, RAY_DEFINITIONS } from '../lib/sensors.ts';
import { TRACKS, sampleTrack, trackEdges, ROAD_EDGE_OFFSET } from '../lib/race.ts';

const point = (x, z) => ({ x, z });
const edge = (x1, z1, x2, z2) => ({ a: point(x1, z1), b: point(x2, z2) });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} should equal ${expected}`);

test('finds the nearest forward edge regardless of segment order; ignores edges behind', () => {
  const edges = [edge(9, -2, 9, 2), edge(-1, -2, -1, 2), edge(3, -2, 3, 2)];
  assert.deepEqual(castRay(point(0, 0), point(1, 0), 12, edges), { distance: 3, hit: true });
  assert.deepEqual(castRay(point(0, 0), point(1, 0), 12, edges.toReversed()), { distance: 3, hit: true });
});

test('finite range distinguishes misses from hits exactly at the limit', () => {
  assert.deepEqual(castRay(point(0, 0), point(1, 0), 10, [edge(10.01, -1, 10.01, 1)]), { distance: 10, hit: false });
  assert.deepEqual(castRay(point(0, 0), point(1, 0), 10, [edge(10, -1, 10, 1)]), { distance: 10, hit: true });
  assert.deepEqual(castRay(point(0, 0), point(1, 0), 10, []), { distance: 10, hit: false });
});

test('parallel, collinear, endpoint, degenerate and zero-distance cases stay finite', () => {
  assert.deepEqual(castRay(point(0, 0), point(1, 0), 10, [edge(2, 1, 8, 1)]), { distance: 10, hit: false });
  assert.deepEqual(castRay(point(0, 0), point(1, 0), 10, [edge(8, 0, 2, 0)]), { distance: 2, hit: true });
  assert.deepEqual(castRay(point(0, 0), point(1, 0), 10, [edge(-8, 0, -2, 0)]), { distance: 10, hit: false });
  assert.deepEqual(castRay(point(0, 0), point(1, 0), 10, [edge(-2, 0, 2, 0)]), { distance: 0, hit: true });
  assert.deepEqual(castRay(point(0, 0), point(1, 0), 10, [edge(5, 0, 5, 2)]), { distance: 5, hit: true });
  assert.deepEqual(castRay(point(0, 0), point(1, 0), 10, [edge(3, 0, 3, 0)]), { distance: 3, hit: true });
});

test('diagonal distances are measured along rays, not perpendicular to the wall', () => {
  const result = castRay(point(0, 0), point(Math.SQRT1_2, Math.SQRT1_2), 20, [edge(4, -10, 4, 10)]);
  close(result.distance, 4 * Math.SQRT2);
  assert.equal(result.hit, true);
});

test('bumper origins and ray directions rotate and translate with the car', () => {
  const definitions = [
    { id: 'F', bank: 'front', angleDeg: 0, originOffset: 1.65, maxRange: 30 },
    { id: 'B', bank: 'rear', angleDeg: 180, originOffset: -1.65, maxRange: 15 },
  ];
  const [front, rear] = senseTrack(point(10, 20), Math.PI / 2, [edge(0, 30, 20, 30), edge(0, 10, 20, 10)], definitions);
  close(front.origin.x, 10); close(front.origin.z, 21.65);
  close(rear.origin.x, 10); close(rear.origin.z, 18.35);
  close(front.distance, 8.35); close(rear.distance, 8.35);
  close(front.end.z, 30); close(rear.end.z, 10);
  close(front.normalizedDistance, 8.35 / 30);
});

test('outside the road, a ray detects the first entering edge, not the farther exiting edge', () => {
  const [ray] = senseTrack(point(0, 9), -Math.PI / 2, [edge(-20, -5, 20, -5), edge(-20, 5, 20, 5)], [
    { id: 'F', bank: 'front', angleDeg: 0, originOffset: 0, maxRange: 30 },
  ]);
  close(ray.distance, 4); close(ray.end.z, 5); assert.equal(ray.hit, true);
});

test('sensor layout has denser front coverage and symmetric, finite ranges increasing toward straight', () => {
  const front = RAY_DEFINITIONS.filter(ray => ray.bank === 'front');
  const rear = RAY_DEFINITIONS.filter(ray => ray.bank === 'rear');
  assert.equal(front.length, 9); assert.equal(rear.length, 3);
  assert.equal(new Set(RAY_DEFINITIONS.map(ray => ray.id)).size, 12);
  for (let i = 0; i < 4; i++) {
    assert.ok(front[i].maxRange < front[i + 1].maxRange);
    assert.equal(front[i].maxRange, front[8 - i].maxRange);
    assert.equal(front[i].angleDeg, -front[8 - i].angleDeg);
  }
  assert.ok(rear[1].maxRange > rear[0].maxRange);
  const misses = senseTrack(point(0, 0), 0, []);
  for (const ray of misses) {
    assert.ok(Number.isFinite(ray.maxRange) && ray.maxRange > 0);
    assert.equal(ray.distance, ray.maxRange); assert.equal(ray.normalizedDistance, 1); assert.equal(ray.hit, false);
    close(Math.hypot(ray.limit.x - ray.origin.x, ray.limit.z - ray.origin.z), ray.maxRange);
  }
});

test('all circuits produce closed inner and outer road edges and bounded sensor readings', () => {
  for (let track = 0; track < 3; track++) {
    const roadEdgeOffset = ROAD_EDGE_OFFSET * TRACKS[track].roadScale;
    const points = sampleTrack(track), edges = trackEdges(points, roadEdgeOffset);
    assert.equal(edges.length, points.length * 2);
    for (const start of [0, points.length]) {
      assert.deepEqual(edges[start + points.length - 1].b, edges[start].a);
      close(Math.hypot(edges[start].a.x - points[0].x, edges[start].a.z - points[0].z), roadEdgeOffset);
    }
    for (let i = 0; i < points.length; i += 15) {
      const p = points[i], next = points[(i + 1) % points.length];
      const readings = senseTrack(p, Math.atan2(next.z - p.z, next.x - p.x), edges);
      assert.deepEqual(readings.map(ray => ray.id), RAY_DEFINITIONS.map(ray => ray.id));
      assert.ok(readings.some(ray => ray.hit));
      for (const ray of readings) {
        assert.ok(Number.isFinite(ray.distance) && ray.distance >= 0 && ray.distance <= ray.maxRange);
        assert.ok(ray.normalizedDistance >= 0 && ray.normalizedDistance <= 1);
        close(Math.hypot(ray.end.x - ray.origin.x, ray.end.z - ray.origin.z), ray.distance);
      }
    }
  }
});
