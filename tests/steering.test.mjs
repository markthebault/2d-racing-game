import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressiveSteering } from '../lib/steering.ts';
import { vehicleTelemetry } from '../lib/telemetry.ts';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' differs from ' + b);
function hold(steering, target, seconds, fps) {
  let elapsed = 0;
  while (elapsed < seconds - 1e-12) {
    const dt = Math.min(1 / fps, seconds - elapsed);
    steering.update(target, dt); elapsed += dt;
  }
  return steering.value;
}

test('turn-in stays nearly linear with slight ease-in and reaches full lock at 0.35 seconds', () => {
  const steering = new ProgressiveSteering();
  const first = steering.update(1, .05);
  assert.ok(first * 90 > 10 && first * 90 < 13);
  const second = steering.update(1, .05);
  assert.ok(second * 90 > 22 && second * 90 < 26);
  const midpoint = steering.update(1, .075);
  assert.ok(midpoint > .45 && midpoint < .5);
  const late = steering.update(1, .125);
  assert.ok(late - midpoint > midpoint - first);
  assert.ok(late < 1);
  close(steering.update(1, .05), 1);
  close(steering.update(1, 2), 1);
  for (const fraction of [.1, .25, .5, .75, .9]) {
    const value = new ProgressiveSteering().update(1, fraction * .35);
    assert.ok(value < fraction && fraction - value < .05);
  }
});

test('steering timing is independent of frame rate and symmetric for left/right', () => {
  for (const duration of [.05, .1, .175, .35, 1]) {
    const expected = new ProgressiveSteering().update(1, duration);
    for (const fps of [20, 30, 60, 120, 144]) {
      close(hold(new ProgressiveSteering(), 1, duration, fps), expected);
      close(hold(new ProgressiveSteering(), -1, duration, fps), -expected);
    }
  }
});

test('release returns to center without overshoot; reversing crosses center before ramping', () => {
  const steering = new ProgressiveSteering();
  steering.update(-1, .35);
  close(steering.update(1, .06), -.5);
  close(steering.update(1, .06), 0);
  assert.ok(steering.update(1, .05) < .15);
  close(steering.update(1, .3), 1);
  close(steering.update(0, .06), .5);
  close(steering.update(0, .06), 0);
  close(steering.update(0, 1), 0);
});

test('a partial release and repress stays continuous, and reset cancels the ramp', () => {
  const steering = new ProgressiveSteering();
  steering.update(1, .2);
  const partial = steering.update(0, .01);
  close(steering.update(1, 0), partial);
  assert.ok(steering.update(1, .01) > partial);
  steering.reset();
  close(steering.value, 0);
  assert.ok(steering.update(1, .05) < .15);
});

test('debug wheel reports the smoothed steering used for turning, not the raw key', () => {
  const steering = new ProgressiveSteering();
  const value = steering.update(1, .1);
  const keys = new Set(['ArrowUp', 'ArrowRight']);
  const telemetry = vehicleTelemetry({x: 2, z: 3}, 0, keys, true, value);
  close(telemetry.steering, value); close(telemetry.steeringWheelAngle, value * 90);
  assert.equal(telemetry.accelerator, 1);
  const paused = vehicleTelemetry({x: 2, z: 3}, 0, keys, false, value);
  assert.equal(paused.steering, 0); assert.equal(paused.steeringWheelAngle, 0);
});
