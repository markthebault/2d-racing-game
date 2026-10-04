import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BarrierWorld,
  trackBarriers,
  CAR_RADIUS,
  CAR_HALF_AXIS,
  TIRE_RADIUS,
} from '../lib/barriers.ts';
import { TRACKS, sampleTrack, trackBounds } from '../lib/race.ts';
import { stepVehicle } from '../lib/vehicle.ts';
import { ProgressiveSteering } from '../lib/steering.ts';
import { DrivingEnvironment } from '../lib/rl/environment.ts';
import { sampleBatch } from '../lib/rl/batch.ts';

const accelerator = { accelerator: 1, brake: 0, steering: 0 };
const coast = { accelerator: 0, brake: 0, steering: 0 };
const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };

test('fast impacts stop the entire car before a wall, including reverse impacts and segment endpoints', () => {
  const world = new BarrierWorld([{ a: { x: 5, z: -10 }, b: { x: 5, z: 10 } }]);
  for (const reverse of [false, true]) {
    const state = {
      x: 0,
      z: 0,
      heading: reverse ? Math.PI : 0,
      speed: reverse ? -8 : 40,
    };
    assert.equal(
      stepVehicle(
        state,
        reverse ? { ...coast, brake: 1 } : accelerator,
        new ProgressiveSteering(),
        1,
        false,
        bounds,
        world,
      ),
      true,
    );
    assert.equal(state.speed, 0);
    assert.ok(!world.overlaps(state));
    assert.ok(
      Math.abs(
        state.x - (5 - CAR_RADIUS - CAR_HALF_AXIS - TIRE_RADIUS - 0.002),
      ) < 0.001,
    );
  }
  const endpoint = { x: 0, z: 10.5, heading: 0, speed: 40 };
  assert.equal(
    stepVehicle(
      endpoint,
      accelerator,
      new ProgressiveSteering(),
      1,
      false,
      bounds,
      world,
    ),
    true,
  );
  assert.ok(
    !world.overlaps(endpoint),
    'Rounded tire wall endpoints also stop the car',
  );
});

test('turning a wing into a wall is blocked, while driving parallel to it stays free', () => {
  const world = new BarrierWorld([{ a: { x: -20, z: 3 }, b: { x: 20, z: 3 } }]);
  const previous = { x: 0, z: 1.2, heading: 0, speed: 4 };
  const next = { ...previous, heading: Math.PI / 2 };
  assert.equal(world.stopAtContact(previous, next), true);
  assert.ok(!world.overlaps(next));
  assert.ok(next.heading > 0 && next.heading < Math.PI / 2);
  const parallel = { ...previous };
  assert.equal(
    stepVehicle(
      parallel,
      accelerator,
      new ProgressiveSteering(),
      0.5,
      false,
      bounds,
      world,
    ),
    false,
  );
  assert.ok(parallel.x > 0);
});

for (let track = 0; track < TRACKS.length; track++) {
  test(`${TRACKS[track].name}: both tire walls stop repeated impacts and allow backing away`, () => {
    const points = sampleTrack(track),
      layout = trackBarriers(points, TRACKS[track].roadScale);
    const world = new BarrierWorld(layout.walls),
      trackBox = trackBounds(points);
    assert.equal(layout.walls.length, points.length * 2);
    assert.ok(layout.tires.length >= points.length * 2);
    for (const index of [0, 42, 149, 301, 457, 599])
      for (const side of [-1, 1]) {
        const a = points[index],
          b = points[(index + 1) % points.length];
        const state = {
          x: a.x,
          z: a.z,
          heading: Math.atan2(b.z - a.z, b.x - a.x) + (side * Math.PI) / 2,
          speed: 40,
        };
        const steering = new ProgressiveSteering();
        assert.ok(
          !world.overlaps(state),
          'Centerline spawn has space for a sideways car',
        );
        let hit = false;
        for (let i = 0; i < 120; i++) {
          hit =
            stepVehicle(
              state,
              accelerator,
              steering,
              1 / 60,
              false,
              trackBox,
              world,
            ) || hit;
          assert.ok(
            !world.overlaps(state),
            `No penetration at segment ${index}, side ${side}`,
          );
        }
        assert.ok(hit, 'The car actually hits the barrier');
        assert.equal(
          state.speed,
          0,
          'Holding gas cannot push through the tire wall',
        );
        const contact = { ...state };
        for (let i = 0; i < 60; i++)
          stepVehicle(
            state,
            { ...coast, brake: 1 },
            steering,
            1 / 60,
            false,
            trackBox,
            world,
          );
        assert.ok(
          Math.hypot(state.x - contact.x, state.z - contact.z) > 1,
          'Reverse frees the car',
        );
        assert.ok(!world.overlaps(state));
      }
  });
}

test('training, best-model playback and fifty-car replays retain solid wall contacts', () => {
  for (const playback of [false, true])
    for (let track = 0; track < TRACKS.length; track++) {
      const env = new DrivingEnvironment(track, 'local', playback);
      env.state.heading += Math.PI / 2;
      env.state.speed = 40;
      const poses = [{ ...env.state, time: 0 }];
      while (!env.done) {
        env.step(1);
        assert.ok(
          !env.barriers.overlaps(env.state),
          'Shared AI physics cannot penetrate a wall',
        );
        poses.push({ ...env.state, time: env.time });
      }
      assert.equal(env.state.speed, 0);
      assert.match(env.reason, /Stuck|Left the track/);
      const runs = Array.from({ length: 50 }, (_, i) => ({
        episode: i + 1,
        track,
        completed: false,
        poses,
      }));
      for (let time = 0; time < env.time; time += 1 / 60) {
        const frame = sampleBatch(runs, time, track);
        assert.equal(frame.poses.length, 50);
        assert.ok(
          frame.poses.every((pose) => !env.barriers.overlaps(pose)),
          'Recorded fleet contacts remain inside the wall',
        );
      }
    }
});

test('fleet interpolation stays behind the walls after varied steering and corner impacts', () => {
  let seed = 42;
  for (let track = 0; track < TRACKS.length; track++) {
    const env = new DrivingEnvironment(track),
      runs = [];
    for (let episode = 1; episode <= 50; episode++) {
      env.reset();
      const poses = [{ ...env.state, time: 0 }];
      while (!env.done) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        env.step(Math.floor((seed / 2 ** 32) * 9));
        assert.ok(!env.barriers.overlaps(env.state));
        poses.push({ ...env.state, time: env.time });
      }
      runs.push({ episode, track, completed: env.completed, poses });
    }
    const duration = Math.max(...runs.map((run) => run.poses.at(-1).time));
    for (let time = 0; time <= duration; time += 1 / 60) {
      assert.ok(
        sampleBatch(runs, time, track).poses.every(
          (pose) => !env.barriers.overlaps(pose),
        ),
        `${TRACKS[track].name}: replay interpolation at ${time}`,
      );
    }
  }
});
