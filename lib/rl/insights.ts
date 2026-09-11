import type { AgentFrame } from './environment.ts';
export type NetworkReading = {
  inputs: number[];
  hidden: number[][];
  values: number[];
};
export type SampleReading = {
  track: number | null;
  action: number;
  reward: number;
  terminal: boolean;
  prediction: number;
  target: number;
  after: number;
};
export type UpdateReading = {
  update: number;
  tdLoss: number;
  demonstrationLoss: number;
  samples: SampleReading[];
  batchSize: number;
};
export type DecisionReading = {
  source: 'preview' | 'training' | 'walkthrough';
  track: number;
  episode: number;
  step: number;
  before: AgentFrame;
  after: AgentFrame | null;
  network: NetworkReading;
  action: number;
  manual?: boolean;
  exploratory: boolean;
  epsilon: number;
  guided: boolean;
  bestValues: number[] | null;
  update: UpdateReading | null;
};
