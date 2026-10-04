import * as THREE from 'three';
import { trackBounds } from './race.ts';

export type CameraView = 'top' | 'chase' | 'overhead';
export const CAMERA_VIEWS = [
  { id: 'top', label: '2D top' },
  { id: 'chase', label: '3D chase' },
  { id: 'overhead', label: '3D overhead' },
] as const;

/** Presentation only: cameras never write to the vehicle or the learner. */
export class RaceCamera {
  readonly top = new THREE.OrthographicCamera(-60, 60, 42, -42, 0.1, 1200);
  readonly chase = new THREE.PerspectiveCamera(48, 1, 0.1, 1200);
  readonly overhead = new THREE.PerspectiveCamera(42, 1, 0.1, 1200);
  view: CameraView = 'top';
  effectiveView: CameraView = 'top';
  private bounds: ReturnType<typeof trackBounds>;
  private target = new THREE.Vector3();
  private desiredPosition = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();
  private previousCar = new THREE.Vector3();
  private snap = true;

  constructor(points: THREE.Vector3[]) {
    this.bounds = trackBounds(points, 18);
    this.top.up.set(0, 0, -1);
  }

  get active(): THREE.Camera {
    return this[this.effectiveView];
  }

  setView(view: CameraView) {
    if (view === this.view) return;
    this.view = view;
    this.snap = true;
  }

  resetFollow() {
    this.snap = true;
  }

  resize(width: number, height: number) {
    if (!width || !height) return;
    const aspect = width / height,
      b = this.bounds;
    const center = new THREE.Vector3(
      (b.minX + b.maxX) / 2,
      0,
      (b.minZ + b.maxZ) / 2,
    );
    const halfHeight = Math.max(
      (b.maxZ - b.minZ) / 2,
      (b.maxX - b.minX) / (2 * aspect),
    );
    this.top.position.set(center.x, 100, center.z);
    this.top.lookAt(center);
    this.top.left = -halfHeight * aspect;
    this.top.right = halfHeight * aspect;
    this.top.top = halfHeight;
    this.top.bottom = -halfHeight;
    this.top.updateProjectionMatrix();
    this.chase.aspect = aspect;
    this.chase.updateProjectionMatrix();
    this.overhead.aspect = aspect;
    this.overhead.updateProjectionMatrix();

    // Fit the padded circuit in perspective, including elevated scenery, in
    // landscape and portrait. Account for depth as well as width and height.
    const direction = new THREE.Vector3(0.18, 1, 0.55).normalize();
    const right = new THREE.Vector3()
      .crossVectors(this.overhead.up, direction)
      .normalize();
    const up = new THREE.Vector3().crossVectors(direction, right);
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.overhead.fov / 2));
    let distance = 40;
    for (const x of [b.minX, b.maxX])
      for (const z of [b.minZ, b.maxZ])
        for (const y of [0, 7]) {
          const corner = new THREE.Vector3(x, y, z).sub(center);
          distance = Math.max(
            distance,
            corner.dot(direction) +
              Math.abs(corner.dot(right)) / (tangent * aspect),
            corner.dot(direction) + Math.abs(corner.dot(up)) / tangent,
          );
        }
    this.overhead.position
      .copy(center)
      .addScaledVector(direction, distance * 1.08);
    this.overhead.lookAt(center);
    this.overhead.updateMatrixWorld();
    this.top.updateMatrixWorld();
  }

  update(position: THREE.Vector3, heading: number, dt: number, hasCar = true) {
    // A fleet or hidden training run needs the entire circuit in view. The
    // requested chase view returns automatically when a single car appears.
    const effective = this.view === 'chase' && !hasCar ? 'overhead' : this.view;
    if (effective !== this.effectiveView) {
      this.effectiveView = effective;
      this.snap = true;
    }
    if (effective !== 'chase') return;
    const forwardX = Math.cos(heading),
      forwardZ = Math.sin(heading);
    this.desiredPosition.set(
      position.x - forwardX * 14 - forwardZ * 7,
      13,
      position.z - forwardZ * 14 + forwardX * 7,
    );
    this.desiredTarget.set(
      position.x + forwardX * 4,
      0.6,
      position.z + forwardZ * 4,
    );
    const amount =
      this.snap || position.distanceToSquared(this.previousCar) > 900
        ? 1
        : 1 - Math.exp(-8 * dt);
    this.chase.position.lerp(this.desiredPosition, amount);
    this.target.lerp(this.desiredTarget, amount);
    this.chase.lookAt(this.target);
    this.chase.updateMatrixWorld();
    this.previousCar.copy(position);
    this.snap = false;
  }
}
