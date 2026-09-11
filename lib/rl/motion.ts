/** Net displacement over exactly 60 physics steps, independent of wall-clock speed. */
export const DEFAULT_MIN_DISTANCE = 1;
export class MotionWindow {
  private positions: { x: number; z: number }[] = [];
  distance: number | null = null;
  reset(position: { x: number; z: number }) { this.positions = [{ x: position.x, z: position.z }]; this.distance = null; }
  step(position: { x: number; z: number }) {
    this.positions.push({ x: position.x, z: position.z });
    if (this.positions.length > 61) this.positions.shift();
    this.distance = this.positions.length === 61 ? Math.hypot(position.x - this.positions[0].x, position.z - this.positions[0].z) : null;
    return this.distance;
  }
}
