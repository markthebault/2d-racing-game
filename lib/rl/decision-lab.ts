import { DQNAgent } from './agent.ts';
import { DrivingEnvironment } from './environment.ts';
import type { Preset } from './config.ts';
import type { DecisionReading } from './insights.ts';
/** A frozen policy and independent environment. Never adds experience or updates weights. */
export class DecisionLab {
  readonly policy: DQNAgent;
  readonly environment: DrivingEnvironment;
  private best: DQNAgent | null;
  constructor(
    source: DQNAgent,
    best: DQNAgent | null,
    track: number,
    preset: Preset,
    laps: number,
    minimum: number,
    fraction = 0,
  ) {
    this.policy = new DQNAgent(0);
    this.policy.loadWeights(source.exportWeights());
    this.best = best ? new DQNAgent(0) : null;
    if (this.best && best) this.best.loadWeights(best.exportWeights());
    this.environment = new DrivingEnvironment(
      track,
      preset,
      false,
      laps,
      minimum,
    );
    this.environment.reset({ fraction, offset: 0, heading: 0 });
  }
  read(action?: number, manual = false): DecisionReading {
    const env = this.environment,
      before = env.frame(),
      network = this.policy.inspect(env.observe());
    const selected =
      action ?? network.values.indexOf(Math.max(...network.values));
    const bestValues = this.best?.inspect(env.observe()).values ?? null;
    if (action !== undefined && !env.done) env.step(selected);
    return {
      manual,
      source: 'walkthrough',
      track: env.track,
      episode: 0,
      step: Math.round(env.time * 10),
      before,
      after: action === undefined ? null : env.frame(),
      network,
      action: selected,
      exploratory: false,
      epsilon: 0,
      guided: false,
      bestValues,
      update: null,
    };
  }
  dispose() {
    this.policy.dispose();
    this.best?.dispose();
  }
}
