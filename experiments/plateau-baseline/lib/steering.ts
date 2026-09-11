export const STEERING_RAMP_SECONDS = 0.35;
export const STEERING_RETURN_SECONDS = 0.12;
const EXPONENT = 0.35; // Nearly linear, with a slight ease-in.
const EXPONENTIAL_RANGE = Math.expm1(EXPONENT);

/** Frame-rate-independent, nearly linear turn-in, followed by a quick linear return.
 * Reversing direction first returns through center, then starts a fresh ramp.
 */
export class ProgressiveSteering {
  value = 0;

  reset() { this.value = 0; }

  update(input: number, dt: number) {
    const target = Math.sign(input);
    let remaining = Math.max(0, dt);
    if (target === 0 || this.value * target < 0) {
      const returnTime = Math.abs(this.value) * STEERING_RETURN_SECONDS;
      if (remaining < returnTime) {
        this.value -= Math.sign(this.value) * remaining / STEERING_RETURN_SECONDS;
        return this.value;
      }
      this.value = 0;
      remaining -= returnTime;
      if (target === 0) return this.value;
    }
    // Recover the current ramp phase to continue smoothly after a partial release.
    const phase = Math.log1p(Math.abs(this.value) * EXPONENTIAL_RANGE) / EXPONENT;
    const nextPhase = Math.min(1, phase + remaining / STEERING_RAMP_SECONDS);
    this.value = target * Math.expm1(EXPONENT * nextPhase) / EXPONENTIAL_RANGE;
    return this.value;
  }
}
