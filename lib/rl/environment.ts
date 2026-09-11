import { maskFeatures } from './features.ts';
import { MotionWindow, DEFAULT_MIN_DISTANCE } from './motion.ts';
import { sampleTrack, trackEdges, trackBounds, TRACKS, ROAD_EDGE_OFFSET, ROAD_WIDTH } from '../race.ts';
import { senseTrack, RAY_DEFINITIONS } from '../sensors.ts';
import { ProgressiveSteering } from '../steering.ts';
import { stepVehicle, type VehicleState, type Controls } from '../vehicle.ts';

export const DECISION_SECONDS = .1;
export { OBSERVATION_SIZE } from './config.ts';
import { CHECKPOINT_COUNTS, CHECKPOINT_POINTS_PER_LAP, DEFAULT_PRESET, PRESETS, progressRewards, squash, type Preset } from './config.ts';
export type StartPose = { fraction: number; offset: number; heading: number };
export const GRID_START: StartPose = { fraction: 0, offset: 0, heading: 0 };
export const ACTIONS: readonly Controls[] = [0, 1, 2].flatMap(pedal => [-1, 0, 1].map(steering => ({ accelerator: Number(pedal === 0), brake: Number(pedal === 2), steering })));
export const ACTION_NAMES = ACTIONS.map(a => `${a.accelerator ? 'Accelerate' : a.brake ? 'Brake' : 'Coast'} / ${a.steering < 0 ? 'left' : a.steering > 0 ? 'right' : 'straight'}`);
const clamp = (n: number, low = -1, high = 1) => Math.min(high, Math.max(low, n));
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export type RewardParts = { safety: number; checkpoint: number; progress: number; speed: number; offroad: number; reverse: number; time: number; finish: number; failure: number };
export type AgentFrame = VehicleState & { motionDistance: number | null; minDistance: number; completedLaps: number; targetLaps: number; checkpoints: number; checkpointCount: number; steering: number; controls: Controls; time: number; score: number; progress: number; offroad: boolean; done: boolean; completed: boolean; reason: string; reward: RewardParts; action: number };

/** Closest segment projection gives smooth arc-length progress, rather than sample-index jumps. */
export class DrivingEnvironment {
  readonly motion = new MotionWindow();
  readonly minDistance: number;
  readonly track: number;
  readonly preset: Preset;
  readonly targetLaps: number;
  readonly checkpointCount: number;
  completedLaps = 0;
  startArc = 0;
  totalOffroadTime = 0;
  readonly points;
  readonly edges;
  readonly bounds;
  readonly halfWidth;
  readonly lengths: number[] = [];
  readonly cumulative: number[] = [0];
  readonly length: number;
  readonly curvatures: number[];
  state: VehicleState = { x: 0, z: 0, heading: 0, speed: 0 };
  steering = new ProgressiveSteering();
  controls: Controls = ACTIONS[1];
  time = 0;
  score = 0;
  distance = 0;
  furthest = 0;
  offroadTime = 0;
  stalledTime = 0;
  done = false;
  completed = false;
  reason = '';
  action = 1;
  reward: RewardParts = { safety: 0, checkpoint: 0, progress: 0, speed: 0, offroad: 0, reverse: 0, time: 0, finish: 0, failure: 0 };
  private previousArc = 0;
  private nextGate = 0;
  private gates = 0;
  private playbackMode: boolean;
  constructor(track: number, preset: Preset = DEFAULT_PRESET, playbackMode = false, targetLaps = 1, minDistance = DEFAULT_MIN_DISTANCE) {
    if (!Number.isFinite(minDistance) || minDistance < 0 || minDistance > 5) throw new Error("Minimum distance must be between 0 and 5 units.");
    this.minDistance = minDistance;
    if (!Number.isInteger(targetLaps) || targetLaps < 1 || targetLaps > 10) throw new Error("Choose 1–10 laps.");
    this.targetLaps = targetLaps; this.checkpointCount = CHECKPOINT_COUNTS[track];
    this.playbackMode = playbackMode;
    if (!TRACKS[track] || !PRESETS[preset]) throw new Error('Invalid track or experiment preset.');
    this.track = track; this.preset = preset;
    this.points = sampleTrack(track);
    this.edges = trackEdges(this.points, ROAD_EDGE_OFFSET * TRACKS[track].roadScale);
    this.bounds = trackBounds(this.points);
    this.halfWidth = ROAD_WIDTH * TRACKS[track].roadScale / 2;
    for (let i = 0; i < this.points.length; i++) {
      this.lengths.push(this.points[i].distanceTo(this.points[(i + 1) % this.points.length]));
      this.cumulative.push(this.cumulative[i] + this.lengths[i]);
    }
    this.length = this.cumulative[this.points.length];
    this.curvatures = this.points.map((point,i) => {
      const before=this.points[(i+this.points.length-1)%this.points.length], after=this.points[(i+1)%this.points.length];
      const turn=angle(Math.atan2(after.z-point.z,after.x-point.x)-Math.atan2(point.z-before.z,point.x-before.x));
      return turn / ((this.lengths[i]+this.lengths[(i+this.points.length-1)%this.points.length])/2);
    });
    this.reset();
  }
  project(x = this.state.x, z = this.state.z) {
    let best = { distance: Infinity, offset: 0, arc: 0, heading: 0, index: 0 };
    for (let i = 0; i < this.points.length; i++) {
      const a = this.points[i], b = this.points[(i + 1) % this.points.length];
      const dx = b.x - a.x, dz = b.z - a.z, len = this.lengths[i];
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (len * len), 0, 1);
      const px = x - a.x - t * dx, pz = z - a.z - t * dz;
      const distance = Math.hypot(px, pz);
      if (distance < best.distance) best = { distance, offset: (dx * pz - dz * px) / len, arc: this.cumulative[i] + t * len, heading: Math.atan2(dz, dx), index: i };
    }
    return best;
  }
  reset(start: StartPose = GRID_START) {
    if (![start.fraction, start.offset, start.heading].every(Number.isFinite) || start.fraction < 0 || start.fraction >= 1 || Math.abs(start.offset) >= this.halfWidth) throw new Error('Invalid start pose.');
    this.startArc = start.fraction * this.length;
    const index = Math.max(0, this.cumulative.findIndex(v => v > this.startArc) - 1);
    const p = this.points[index], n = this.points[(index + 1) % this.points.length];
    const t = (this.startArc - this.cumulative[index]) / this.lengths[index], heading = Math.atan2(n.z-p.z,n.x-p.x);
    this.state = { x: p.x + (n.x-p.x)*t - Math.sin(heading)*start.offset, z: p.z + (n.z-p.z)*t + Math.cos(heading)*start.offset, heading: heading + start.heading, speed: 0 };
    this.motion.reset(this.state);
    this.steering.reset(); this.controls = { accelerator: 0, brake: 0, steering: 0 };
    this.time = this.score = this.distance = this.furthest = this.offroadTime = this.stalledTime = 0;
    this.previousArc = this.project().arc; this.totalOffroadTime = 0; this.nextGate = this.length / (this.checkpointCount + 1); this.gates = 0; this.completedLaps = 0;
    this.done = this.completed = false; this.reason = ''; this.action = 1;
    this.reward = { safety: 0, checkpoint: 0, progress: 0, speed: 0, offroad: 0, reverse: 0, time: 0, finish: 0, failure: 0 };
    return this.observe();
  }
  pointAhead(distance: number, arc = this.project().arc) {
    const target = ((arc + distance) % this.length + this.length) % this.length;
    const i = Math.max(0, this.cumulative.findIndex(value => value > target) - 1);
    const a=this.points[i], b=this.points[(i+1)%this.points.length], t=(target-this.cumulative[i])/this.lengths[i];
    return { x:a.x+(b.x-a.x)*t, z:a.z+(b.z-a.z)*t, curvature:this.curvatures[i] };
  }
  roadContext() {
    const p=this.project(), s=this.state;
    const waypoints=[4,8,16,32].flatMap(distance=>{
      const point=this.pointAhead(distance,p.arc), dx=point.x-s.x,dz=point.z-s.z;
      return [clamp((Math.cos(s.heading)*dx+Math.sin(s.heading)*dz)/distance),clamp((-Math.sin(s.heading)*dx+Math.cos(s.heading)*dz)/distance)];
    });
    let safeSpeed=36;
    for(let distance=0;distance<=32;distance+=2){
      const curvature=Math.abs(this.pointAhead(distance,p.arc).curvature);
      // Yaw authority is 1.85 rad/s; leave steering margin and account for braking delay.
      const cornerSpeed=Math.min(36,1.35/Math.max(.001,curvature));
      const brakingDistance=Math.max(0,distance-Math.max(0,s.speed)*.35-2);
      safeSpeed=Math.min(safeSpeed,Math.sqrt(cornerSpeed*cornerSpeed+2*20*brakingDistance));
    }
    return { waypoints, safeSpeed, offset:p.offset/this.halfWidth, heading:angle(p.heading-s.heading) };
  }
  observeLegacy() {
    const p = this.project(), s = this.state, relative = angle(p.heading - s.heading);
    const ahead = [5, 12, 24].map(distance => {
      const arc = (p.arc + distance) % this.length;
      let i = this.cumulative.findIndex(value => value > arc) - 1; i = Math.max(0, i);
      const a = this.points[i], b = this.points[(i + 1) % this.points.length];
      return angle(Math.atan2(b.z - a.z, b.x - a.x) - s.heading) / Math.PI;
    });
    return [
      ...senseTrack(s, s.heading, this.edges).map(r => r.normalizedDistance),
      s.speed / 40, this.steering.value, this.controls.accelerator, this.controls.brake,
      clamp(p.offset / this.halfWidth), Math.sin(relative), Math.cos(relative), Number(p.distance > this.halfWidth),
      clamp(2 * (s.x - this.bounds.minX) / (this.bounds.maxX - this.bounds.minX) - 1),
      clamp(2 * (s.z - this.bounds.minZ) / (this.bounds.maxZ - this.bounds.minZ) - 1),
      Math.sin(p.arc / this.length * Math.PI * 2), Math.cos(p.arc / this.length * Math.PI * 2),
      ...ahead, clamp(this.offroadTime),
    ];
  }
  observe() {
    const values = this.observeLegacy();
    // Keep a stable feature layout across experiments; masking changes only map-position access.
    if (!PRESETS[this.preset].absolutePosition) values.fill(0, 20, 24);
    const relativeArc = (this.project().arc - this.startArc + this.length) % this.length;
    const context=this.roadContext();
    return maskFeatures([...values, clamp(this.time / (90 * this.targetLaps), 0, 1), clamp(this.stalledTime / 6, 0, 1),
      squash(this.distance / this.length), squash((this.furthest - this.distance) / this.length),
      this.gates / this.checkpointCount, (this.nextGate - relativeArc) / this.length, this.completedLaps / this.targetLaps, this.targetLaps / 10,
      ...context.waypoints, this.halfWidth/5, context.safeSpeed/40,
      this.motion.distance === null ? 0 : squash(this.motion.distance/5), this.motion.fraction, this.minDistance/5,
      clamp(values[4]*RAY_DEFINITIONS[4].maxRange / Math.max(1,Math.abs(this.state.speed)) / 2,0,1),
      this.steering.value * Math.min(Math.abs(this.state.speed)/7,1) * Math.sign(this.state.speed), this.controls.steering]);
  }
  step(action: number) {
    if (this.done) throw new Error('Reset the episode before stepping it again.');
    if (!Number.isInteger(action) || !ACTIONS[action]) throw new Error('Invalid driving action.');
    this.action = action; this.controls = ACTIONS[action];
    const reward: RewardParts = { safety: 0, checkpoint: 0, progress: 0, speed: 0, offroad: 0, reverse: 0, time: 0, finish: 0, failure: 0 };
    const context = this.preset === 'adaptive' ? this.roadContext() : null;
    for (let sub = 0; sub < 6; sub++) {
      const before = this.project();
      stepVehicle(this.state, this.controls, this.steering, 1 / 60, before.distance > this.halfWidth, this.bounds);
      const after = this.project(), onRoad = before.distance <= this.halfWidth && after.distance <= this.halfWidth;
      let delta = after.arc - this.previousArc;
      if (delta < -this.length / 2) delta += this.length;
      if (delta > this.length / 2) delta -= this.length;
      this.previousArc = after.arc;
      // Inside a bend, projected centerline distance exceeds physical distance by r/(r-offset).
      // The old fixed 2x bound rejected legal inside lines and permanently missed checkpoint gates.
      const curvature=Math.max(Math.abs(this.curvatures[before.index]),Math.abs(this.curvatures[after.index]));
      const arcScale=1/Math.max(.15,1-curvature*this.halfWidth);
      // The sampled centerline is made of chords: changing the nearest chord can snap arc position.
      const chordError=before.index===after.index ? 0 : curvature*this.halfWidth*(this.lengths[before.index]+this.lengths[after.index]);
      const valid = onRoad && Math.abs(delta) <= Math.abs(this.state.speed) / 60 * Math.max(2,arcScale) + chordError + .02;
      if (valid) {
        this.distance += delta;
        const fresh = Math.max(0, Math.min(this.length * this.targetLaps, this.distance) - Math.min(this.length * this.targetLaps, this.furthest));
        this.furthest = Math.max(this.furthest, this.distance);
        const earned = progressRewards(fresh, delta, this.state.speed, this.length, this.preset);
        reward.progress += earned.progress; reward.speed += earned.speed; reward.reverse += earned.reverse;
        const relativeArc = (after.arc - this.startArc + this.length) % this.length;
        if (this.gates < this.checkpointCount && relativeArc >= this.nextGate && relativeArc - delta < this.nextGate && delta > 0 && this.distance >= this.completedLaps * this.length + this.nextGate - 1) {
          this.gates++; this.nextGate = (this.gates + 1) * this.length / (this.checkpointCount + 1);
          reward.checkpoint += CHECKPOINT_POINTS_PER_LAP / this.checkpointCount;
        }
        const beforeRelative = (relativeArc - delta + this.length) % this.length;
        if (this.gates === this.checkpointCount && this.distance >= (this.completedLaps + 1) * this.length - 1 && delta > 0 && beforeRelative > this.length / 2 && relativeArc < this.length / 2) {
          this.completedLaps++; reward.finish += 1000;
          this.completed = this.done = this.completedLaps === this.targetLaps;
          this.reason = this.done ? 'Race complete' : `Lap ${this.completedLaps} complete`;
          if (!this.done) { this.gates = 0; this.nextGate = this.length / (this.checkpointCount + 1); }
        }
      }
      if (after.distance > this.halfWidth) { this.offroadTime += 1 / 60; this.totalOffroadTime += 1 / 60; reward.offroad -= 50 / 60; }
      else this.offroadTime = 0;
      if (context) {
        const overspeed=Math.max(0,this.state.speed-context.safeSpeed);
        const edgeRisk=Math.max(0,Math.abs(after.offset)/this.halfWidth-.55);
        const misalignment=1-Math.cos(angle(after.heading-this.state.heading));
        reward.safety -= (overspeed*overspeed/20 + (Math.abs(this.state.speed)>1 ? 4*edgeRisk*edgeRisk+3*misalignment : 0))/60;
      }
      this.time += 1 / 60; reward.time -= 1 / 60;
      this.stalledTime = valid && delta > .015 ? 0 : this.stalledTime + 1 / 60;
      const motionDistance = this.motion.step(this.state);
      const stuck = motionDistance !== null && motionDistance < this.minDistance;
      if (!this.done && (stuck || this.offroadTime >= (this.playbackMode ? 5 : 1) || (!this.playbackMode && after.distance > this.halfWidth + 3) || (this.stalledTime >= 6 && !(this.playbackMode && this.offroadTime > 0)) || this.time >= 90 * this.targetLaps)) {
        this.done = true; reward.failure = this.preset === 'adaptive' ? -250 : -100;
        this.reason = stuck ? 'Stuck: insufficient movement over 1 second' : this.time >= 90 * this.targetLaps ? 'Time limit' : this.offroadTime >= (this.playbackMode ? 5 : 1) || after.distance > this.halfWidth + 3 ? 'Left the track' : 'No forward progress';
      }
      if (this.done) break;
    }
    this.reward = reward;
    const total = Object.values(reward).reduce((sum, value) => sum + value, 0);
    this.score += total;
    return { observation: this.observe(), reward: total, done: this.done };
  }
  frame(): AgentFrame {
    return { ...this.state, motionDistance: this.motion.distance, minDistance: this.minDistance, steering: this.steering.value, controls: { ...this.controls }, time: this.time, score: this.score,
      completedLaps: this.completedLaps, targetLaps: this.targetLaps, checkpoints: this.gates, checkpointCount: this.checkpointCount,
      progress: this.completed ? 1 : Math.min(.999, clamp(this.furthest / (this.length * this.targetLaps), 0, 1), (this.completedLaps + (this.gates + 1) / (this.checkpointCount + 1)) / this.targetLaps), offroad: this.project().distance > this.halfWidth,
      done: this.done, completed: this.completed, reason: this.reason, reward: { ...this.reward }, action: this.action };
  }
}
