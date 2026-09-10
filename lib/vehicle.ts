import { ProgressiveSteering } from './steering.ts';

export const MAX_FORWARD_SPEED = 40;
export type Controls = { accelerator: number; brake: number; steering: number };
export type VehicleState = { x: number; z: number; heading: number; speed: number };
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** One shared physics step for keyboard driving, training and model playback. */
export function stepVehicle(state: VehicleState, input: Controls, steering: ProgressiveSteering, dt: number, offroad: boolean, bounds: Bounds) {
  let acceleration = input.accelerator * 16;
  if (input.brake) acceleration -= input.brake * (state.speed > 0 ? 30 : 10);
  if (!input.accelerator && !input.brake) state.speed *= Math.exp(-1.1 * dt);
  state.speed = clamp(state.speed + acceleration * dt, -8, MAX_FORWARD_SPEED);
  if (offroad && state.speed > 7) state.speed = Math.max(7, state.speed - 45 * dt);
  state.heading += steering.update(input.steering, dt) * 1.85 * Math.min(Math.abs(state.speed) / 7, 1) * Math.sign(state.speed) * dt;
  state.x = clamp(state.x + Math.cos(state.heading) * state.speed * dt, bounds.minX, bounds.maxX);
  state.z = clamp(state.z + Math.sin(state.heading) * state.speed * dt, bounds.minZ, bounds.maxZ);
}
