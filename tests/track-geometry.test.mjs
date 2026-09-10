import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, sampleTrack, offsetTrackPoint, trackCurve } from '../lib/race.ts';

const orientation = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
function crosses(a, b, c, d) {
  return orientation(a, b, c) * orientation(a, b, d) < -1e-12
    && orientation(c, d, a) * orientation(c, d, b) < -1e-12;
}

for (let track = 0; track < TRACKS.length; track++) {
  test(TRACKS[track].name + ': asphalt, kerbs and shoulders never fold or self-intersect', () => {
    const points = sampleTrack(track), count = points.length;
    for (const offset of [-7, -5.95, -5.55, -5.2, -5.1, 0, 5.1, 5.2, 5.55, 5.95, 7]) {
      const ring = points.map((_, i) => offsetTrackPoint(points, i, offset * TRACKS[track].roadScale));
      for (let i = 0; i < count; i++) {
        const a = ring[i], b = ring[(i + 1) % count];
        const p = points[i], q = points[(i + 1) % count];
        const forward = (b.x - a.x) * (q.x - p.x) + (b.z - a.z) * (q.z - p.z);
        assert.ok(forward > 0, 'Offset ' + offset + ' reverses at segment ' + i);
        for (let j = i + 2; j < count; j++) {
          if (i === 0 && j === count - 1) continue;
          assert.ok(!crosses(a, b, ring[j], ring[(j + 1) % count]), 'Offset ' + offset + ' intersects at ' + i + '/' + j);
        }
      }
    }
    const left = points.map((_, i) => offsetTrackPoint(points, i, -7 * TRACKS[track].roadScale));
    const right = points.map((_, i) => offsetTrackPoint(points, i, 7 * TRACKS[track].roadScale));
    for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) {
      assert.ok(!crosses(left[i], left[(i + 1) % count], right[j], right[(j + 1) % count]), 'Opposite shoulders cross');
    }
  });

  test(TRACKS[track].name + ': corners have room for the full road width and the seam is smooth', () => {
    const curve = trackCurve(track), points = sampleTrack(track);
    assert.ok(curve.getPoint(0).distanceTo(curve.getPoint(1)) < 1e-9);
    assert.ok(curve.getTangent(.000001).distanceTo(curve.getTangent(.999999)) < .001);
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length];
      const b = points[i], c = points[(i + 1) % points.length];
      const area = Math.abs(orientation(a, b, c));
      if (area < 1e-10) continue;
      const radius = a.distanceTo(b) * b.distanceTo(c) * a.distanceTo(c) / (2 * area);
      const shoulder = 7 * TRACKS[track].roadScale;
      assert.ok(radius > shoulder + .25, 'Corner radius ' + radius + ' is too tight for shoulder width ' + shoulder);
    }
  });
}
