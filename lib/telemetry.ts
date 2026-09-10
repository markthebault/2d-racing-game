export function drivingInput(keys: ReadonlySet<string>, enabled: boolean) {
  const accelerator = Number(enabled && keys.has('ArrowUp'));
  const brake = Number(enabled && keys.has('ArrowDown'));
  const steering = Number(enabled && keys.has('ArrowRight')) - Number(enabled && keys.has('ArrowLeft'));
  return { accelerator, brake, steering, steeringWheelAngle: steering * 90 };
}

export function vehicleTelemetry(position = { x: 0, z: 0 }, heading = 0, keys: ReadonlySet<string> = new Set(), enabled = false, steering = 0) {
  return {
    ...drivingInput(keys, enabled),
    steering: enabled ? steering : 0,
    steeringWheelAngle: enabled ? steering * 90 : 0,
    position: { x: position.x, z: position.z },
    headingDegrees: ((heading * 180 / Math.PI) % 360 + 360) % 360,
  };
}
export type VehicleTelemetry = ReturnType<typeof vehicleTelemetry>;
