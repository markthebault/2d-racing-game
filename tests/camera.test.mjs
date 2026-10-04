import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TRACKS, sampleTrack, trackBounds } from '../lib/race.ts';
import { RaceCamera } from '../lib/race-camera.ts';
import { buildRaceCar } from '../lib/race-car.ts';

test('both whole-circuit cameras fit every track including scenery in portrait and landscape', () => {
  for (let track = 0; track < TRACKS.length; track++)
    for (const [width, height] of [
      [1200, 590],
      [360, 440],
      [720, 900],
    ]) {
      const points = sampleTrack(track),
        bounds = trackBounds(points, 18),
        cameras = new RaceCamera(points);
      cameras.resize(width, height);
      for (const view of ['top', 'overhead']) {
        cameras.setView(view);
        cameras.update(points[0], Math.PI, 1 / 60);
        assert.ok(
          view === 'top'
            ? cameras.active.isOrthographicCamera
            : cameras.active.isPerspectiveCamera,
        );
        for (const x of [bounds.minX, bounds.maxX])
          for (const z of [bounds.minZ, bounds.maxZ])
            for (const y of [0, 7]) {
              const projected = new THREE.Vector3(x, y, z).project(
                cameras.active,
              );
              assert.ok(
                Math.abs(projected.x) <= 1.00001 &&
                  Math.abs(projected.y) <= 1.00001,
                `${TRACKS[track].name} ${view} ${width}x${height}: scenery clipped`,
              );
              assert.ok(projected.z > -1 && projected.z < 1);
            }
      }
    }
});

test('chase follows turns, snaps after reset, and returns from a fleet without changing the requested view', () => {
  const points = sampleTrack(0),
    cameras = new RaceCamera(points),
    position = points[0].clone();
  cameras.resize(1200, 590);
  cameras.setView('chase');
  cameras.update(position, Math.PI, 1 / 60);
  const start = cameras.active.position.clone();
  position.x -= 4;
  cameras.update(position, -Math.PI + 0.2, 0.1);
  assert.ok(cameras.active.position.distanceTo(start) > 0.1);
  assert.ok(
    Math.abs(position.clone().project(cameras.active).x) < 0.7,
    'Car remains visible through the heading wrap',
  );
  cameras.update(position, Math.PI, 0.1, false);
  assert.equal(cameras.view, 'chase');
  assert.equal(cameras.effectiveView, 'overhead');
  cameras.update(points[100], 0, 0.1, true);
  assert.equal(cameras.effectiveView, 'chase');
  cameras.resetFollow();
  cameras.update(points[0], Math.PI, 0.001);
  assert.ok(
    cameras.active.position.distanceTo(start) < 1e-9,
    'Reset snaps immediately to the grid',
  );
});

test('camera selection and updates leave vehicle coordinates unchanged', () => {
  const points = sampleTrack(2),
    position = points[12].clone(),
    original = position.clone();
  const cameras = new RaceCamera(points);
  for (const view of ['chase', 'top', 'overhead', 'chase']) {
    cameras.setView(view);
    cameras.resize(390, 440);
    cameras.update(position, 1.2, 0.1);
    assert.deepEqual(position, original);
  }
});

test('custom overhead position survives resizing, replays and switching cameras', () => {
  const points = sampleTrack(1),
    cameras = new RaceCamera(points);
  cameras.resize(1200, 590);
  cameras.setView('overhead');
  cameras.update(points[0], 0, 0.1);
  cameras.overhead.position.add(new THREE.Vector3(12, -8, -4));
  cameras.overheadTarget.add(new THREE.Vector3(12, 0, -4));
  cameras.overhead.lookAt(cameras.overheadTarget);
  cameras.markOverheadMoved();
  const position = cameras.overhead.position.clone(),
    target = cameras.overheadTarget.clone();
  cameras.resize(390, 440);
  for (const view of ['top', 'chase', 'overhead']) {
    cameras.setView(view);
    cameras.update(points[100], 1.2, 0.1, false);
    assert.deepEqual(cameras.overhead.position, position);
    assert.deepEqual(cameras.overheadTarget, target);
  }
  assert.equal(cameras.overhead.aspect, 390 / 440);
});

test('Fit track discards navigation and restores whole-circuit framing for the current viewport', () => {
  const points = sampleTrack(4),
    cameras = new RaceCamera(points);
  cameras.resize(1200, 590);
  cameras.overhead.position.multiplyScalar(0.2);
  cameras.overheadTarget.set(25, 0, 10);
  cameras.markOverheadMoved();
  cameras.resize(390, 440);
  cameras.resetOverhead();
  const expected = new RaceCamera(points);
  expected.resize(390, 440);
  assert.deepEqual(cameras.overhead.position, expected.overhead.position);
  assert.deepEqual(cameras.overheadTarget, expected.overheadTarget);
  // OrbitControls can emit a change while synchronizing the restored pose.
  cameras.markOverheadMoved();
  cameras.resize(1400, 900);
  expected.resize(1400, 900);
  assert.deepEqual(cameras.overhead.position, expected.overhead.position);
});

test('formula car parts stay flat and cloneable for real fleet instancing', () => {
  const car = new THREE.Group();
  buildRaceCar(car);
  assert.ok(car.children.length > 20);
  for (const part of car.children) {
    assert.ok(part.isMesh);
    assert.equal(part.children.length, 0);
    assert.ok(part.geometry.getAttribute('position').count > 0);
    assert.ok(part.material.clone().isMeshStandardMaterial);
  }
  car.traverse((part) => {
    if (part.isMesh) {
      part.geometry.dispose();
      part.material.dispose();
    }
  });
});
