'use client';
import { Fragment, useMemo, useState } from 'react';
import {
  BrainCircuit,
  ArrowRight,
  Pause,
  Play,
  SkipForward,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Button } from './ui/button';
import {
  TRACKS,
  sampleTrack,
  trackBounds,
  trackEdges,
  ROAD_EDGE_OFFSET,
} from '../lib/race';
import { senseTrack } from '../lib/sensors';
import { ACTION_NAMES } from '../lib/rl/environment';
import type { DecisionReading, UpdateReading } from '../lib/rl/insights';
import type { TrainingStats, WorkerCommand } from '../lib/rl/protocol';

const groups = [
  {
    name: 'Ray sensors',
    start: 0,
    end: 12,
    help: 'Distances to the road edges. A value of 1 means the ray reached its maximum range.',
    labels: [
      'F1',
      'F2',
      'F3',
      'F4',
      'F5',
      'F6',
      'F7',
      'F8',
      'F9',
      'B1',
      'B2',
      'B3',
    ],
  },
  {
    name: 'Car & road',
    start: 12,
    end: 28,
    help: 'Motion, alignment and road headings ahead. Absolute position is masked in the local-input preset.',
    labels: [
      'Speed',
      'Smoothed steering',
      'Accelerator',
      'Brake',
      'Lateral offset',
      'Heading sine',
      'Heading cosine',
      'Off road',
      'Absolute X',
      'Absolute Z',
      'Lap sine',
      'Lap cosine',
      'Heading at 5 units',
      'Heading at 12 units',
      'Heading at 24 units',
      'Off-road duration',
    ],
  },
  {
    name: 'Race progress',
    start: 28,
    end: 36,
    help: 'History helps the network predict checkpoint rewards and when a run will end.',
    labels: [
      'Elapsed time',
      'Stalled time',
      'Signed progress',
      'Recovery distance',
      'Checkpoints',
      'Next checkpoint',
      'Completed laps',
      'Requested laps',
    ],
  },
  {
    name: 'Road preview',
    start: 36,
    end: 46,
    help: 'Known map geometry describes upcoming bends and a braking-aware speed estimate.',
    labels: [
      '4u forward',
      '4u lateral',
      '8u forward',
      '8u lateral',
      '16u forward',
      '16u lateral',
      '32u forward',
      '32u lateral',
      'Road width',
      'Corner speed',
    ],
  },
  {
    name: 'Movement & steering',
    start: 46,
    end: 52,
    help: 'Recent movement and steering response help identify stuck cars and plan corrections.',
    labels: [
      'Net movement',
      'Window age',
      'Movement minimum',
      'Forward travel time',
      'Yaw rate',
      'Steering command',
    ],
  },
];
const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : '—');
const rewardNames: Record<string, string> = {
  progress: 'New road progress',
  checkpoint: 'Checkpoint',
  finish: 'Completed lap',
  speed: 'Speed bonus',
  offroad: 'Off road',
  reverse: 'Reverse progress',
  time: 'Time',
  failure: 'Run ended',
  safety: 'Corner safety',
};

/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Inline SVG needs an accessible image role. */
function RoadView({ reading }: { reading: DecisionReading }) {
  const [closeUp, setCloseUp] = useState(true);
  const geometry = useMemo(() => {
    const points = sampleTrack(reading.track),
      bounds = trackBounds(points),
      edges = trackEdges(
        points,
        ROAD_EDGE_OFFSET * TRACKS[reading.track].roadScale,
      );
    return { points, bounds, edges };
  }, [reading.track]);
  const { bounds, points, edges } = geometry,
    car = reading.before;
  const rays = senseTrack(car, car.heading, edges),
    path = [...points, points[0]].map((p) => `${p.x},${p.z}`).join(' ');
  const margin = 12;
  const view = closeUp
    ? `${car.x + Math.cos(car.heading) * 8 - 44} ${car.z + Math.sin(car.heading) * 8 - 30} 88 60`
    : `${bounds.minX - margin} ${bounds.minZ - margin} ${bounds.maxX - bounds.minX + margin * 2} ${bounds.maxZ - bounds.minZ + margin * 2}`;
  return (
    <>
      <div className="road-zoom">
        <button aria-pressed={closeUp} onClick={() => setCloseUp(true)}>
          Around the car
        </button>
        <button aria-pressed={!closeUp} onClick={() => setCloseUp(false)}>
          Whole circuit
        </button>
      </div>
      {/* Inline SVG uses the image role to expose its accessible description. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      <svg
        className="lesson-road"
        role="img"
        aria-label={`Decision on ${TRACKS[reading.track].name}. Rays start at the car before its action.`}
        viewBox={view}
      >
        <polyline
          points={path}
          fill="none"
          stroke="#657b65"
          strokeWidth={10.2 * TRACKS[reading.track].roadScale}
          strokeLinejoin="round"
        />
        <polyline
          points={path}
          fill="none"
          stroke="#4a5550"
          strokeWidth={10 * TRACKS[reading.track].roadScale}
          strokeLinejoin="round"
        />
        {rays.map((ray, i) => (
          <line
            key={i}
            x1={ray.origin.x}
            y1={ray.origin.z}
            x2={ray.end.x}
            y2={ray.end.z}
            stroke={i < 9 ? '#daef8c' : '#80d9ef'}
            strokeWidth=".45"
            opacity=".85"
          />
        ))}
        {reading.after && (
          <>
            <line
              x1={car.x}
              y1={car.z}
              x2={reading.after.x}
              y2={reading.after.z}
              stroke="#ff995c"
              strokeWidth="1"
            />
            <circle
              cx={reading.after.x}
              cy={reading.after.z}
              r="1.8"
              fill="none"
              stroke="#ff995c"
              strokeWidth=".7"
            />
          </>
        )}
        <path
          d="M 2.5 0 L -1.8 -1.5 L -1 0 L -1.8 1.5 Z"
          fill="#ff995c"
          transform={`translate(${car.x} ${car.z}) rotate(${(car.heading * 180) / Math.PI})`}
        />
      </svg>
    </>
  );
}
/* oxlint-enable jsx-a11y/prefer-tag-over-role */
function ActionGrid({
  reading,
  choose,
  selected,
}: {
  reading: DecisionReading;
  choose: (action: number) => void;
  selected: number | null;
}) {
  const best = reading.network.values.indexOf(
    Math.max(...reading.network.values),
  );
  return (
    <fieldset
      className="action-matrix"
      aria-label="Nine predicted action values"
    >
      <span />
      <span>Left</span>
      <span>Straight</span>
      <span>Right</span>
      {['Accelerate', 'Coast', 'Brake'].map((pedal, row) => (
        <div className="action-row" key={pedal}>
          <span>{pedal}</span>
          {[0, 1, 2].map((col) => {
            const action = row * 3 + col;
            return (
              <button
                key={action}
                aria-label={`${ACTION_NAMES[action]}: ${fmt(reading.network.values[action])}`}
                aria-pressed={(selected ?? reading.action) === action}
                disabled={reading.source !== 'walkthrough'}
                onClick={() => choose(action)}
                className={best === action ? 'preferred-action' : ''}
              >
                <strong>{fmt(reading.network.values[action])}</strong>
                <small>
                  {best === action
                    ? 'Highest value'
                    : (selected ?? reading.action) === action
                      ? 'Selected'
                      : ' '}
                </small>
              </button>
            );
          })}
        </div>
      ))}
    </fieldset>
  );
}
export function LearningExplorer({
  reading,
  stats,
  command,
}: {
  reading: DecisionReading | null;
  stats: TrainingStats;
  command: (command: WorkerCommand) => void;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState('Decision'),
    [group, setGroup] = useState(0),
    [selected, setSelected] = useState<number | null>(null),
    [sample, setSample] = useState(0),
    [fraction, setFraction] = useState('0');
  const [heldUpdate, setHeldUpdate] = useState<UpdateReading | null>(null);
  const availableUpdate = reading?.update;
  const walkthrough = reading?.source === 'walkthrough',
    update = heldUpdate,
    example = update?.samples[Math.min(sample, update.samples.length - 1)];
  const changeOpen = (value: boolean) => {
    setOpen(value);
    setHeldUpdate(null);
    command({ type: 'insights', enabled: value });
    setSelected(null);
  };
  const restart = (start = fraction) => {
    setSelected(null);
    command({ type: 'inspect', restart: true, fraction: Number(start) });
  };
  const warmup = stats.coachEnabled && stats.coachUpdates < 4000,
    warmupStarted = stats.coachSamples > 0;
  return (
    <>
      <Button
        className="learning-entry"
        variant="outline"
        disabled={stats.status === 'loading' || stats.status === 'error'}
        onClick={() => changeOpen(true)}
      >
        <BrainCircuit size={19} />
        <span>
          See how the AI learns<small>Decisions, neurons and rewards</small>
        </span>
        <ArrowRight size={18} />
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="learning-explorer">
          <header className="lesson-header">
            <div>
              <span className="eyebrow">INSIDE THE DRIVER</span>
              <DialogTitle>From road to reward</DialogTitle>
              <DialogDescription>
                Follow one decision. Then look inside the network that made it.
              </DialogDescription>
            </div>
            <span className="lesson-stage">
              {walkthrough
                ? 'FROZEN WALKTHROUGH'
                : warmup && warmupStarted
                  ? 'GUIDED WARM-UP'
                  : stats.steps
                    ? 'REINFORCEMENT LEARNING'
                    : 'UNTRAINED NETWORK'}
            </span>
          </header>
          <div className="lesson-toolbar">
            <nav aria-label="Learning views">
              {['Decision', 'Network', 'Learning update'].map((name) => (
                <Button
                  variant="ghost"
                  key={name}
                  aria-pressed={page === name}
                  onClick={() => {
                    setPage(name);
                    if (
                      name === 'Learning update' &&
                      !heldUpdate &&
                      availableUpdate
                    )
                      setHeldUpdate(availableUpdate);
                  }}
                >
                  {name}
                </Button>
              ))}
            </nav>
            <div>
              {walkthrough ? (
                <>
                  <Button
                    onClick={() => {
                      command({
                        type: 'inspect',
                        action: selected ?? undefined,
                      });
                      setSelected(null);
                    }}
                    disabled={!!reading?.after?.done}
                  >
                    <SkipForward size={16} />
                    Next 0.1 s
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelected(null);
                      command({ type: 'resume' });
                    }}
                  >
                    <Play size={16} />
                    Resume learning
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => restart()}>
                    <Pause size={16} />
                    Walk through a run
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      command({
                        type: stats.backgroundLearning ? 'pause' : 'resume',
                      })
                    }
                  >
                    {stats.backgroundLearning
                      ? 'Pause all'
                      : stats.steps || warmupStarted
                        ? 'Resume learning'
                        : 'Start learning'}
                  </Button>
                </>
              )}
            </div>
          </div>
          {walkthrough ? (
            <div className="lesson-notice">
              <span>
                Learning is paused. This copy starts on the viewed circuit and
                never updates your model.
              </span>
              <label>
                Start{' '}
                <select
                  aria-label="Walkthrough start"
                  value={fraction}
                  onChange={(e) => {
                    setFraction(e.target.value);
                    restart(e.target.value);
                  }}
                >
                  <option value="0">Finish line</option>
                  <option value={1 / 3}>One-third around</option>
                  <option value={2 / 3}>Two-thirds around</option>
                </select>
              </label>
              <Button variant="ghost" onClick={() => restart()}>
                Restart copy
              </Button>
            </div>
          ) : (
            <p className="lesson-caption">
              {warmup && warmupStarted
                ? 'The instructor is teaching action examples. These outputs are still action scores; RL will turn them into future-reward estimates.'
                : stats.steps
                  ? 'Live learner, sampled four times a second. Use the walkthrough to pause and inspect.'
                  : 'These are real outputs from random initial weights. Start training to give them useful driving experience.'}
            </p>
          )}
          {!reading ? (
            <output>Reading the network…</output>
          ) : (
            <>
              <div className="lesson-context">
                <strong>{TRACKS[reading.track].name}</strong>
                <span>
                  {walkthrough
                    ? `Copy time ${(reading.after ?? reading.before).time.toFixed(1)} s`
                    : `${reading.source === 'training' ? 'Driving decision' : 'Current state'} · ${reading.step.toLocaleString()} decisions collected`}
                </span>
                <span>
                  Before action: {reading.before.speed.toFixed(1)} units/s ·{' '}
                  {reading.before.offroad ? 'Outside road' : 'On road'}
                </span>
              </div>
              {page === 'Decision' && (
                <div className="lesson-decision-grid">
                  <section className="lesson-card">
                    <h3>
                      <b>01</b> Observe the road
                    </h3>
                    <RoadView reading={reading} />
                    <p>
                      The orange arrow is the car before its action. Lime rays
                      look forward; blue rays look back. The outlined dot is its
                      position after the step.
                    </p>
                  </section>
                  <section className="lesson-card">
                    <h3>
                      <b>02</b> Choose a control
                    </h3>
                    <div
                      className={
                        'decision-origin ' +
                        (reading.exploratory ? 'exploring' : '')
                      }
                    >
                      <strong>
                        {selected !== null || reading.manual
                          ? 'Your test action'
                          : reading.exploratory
                            ? 'Random exploration'
                            : 'Network choice'}
                      </strong>
                      <span>{ACTION_NAMES[selected ?? reading.action]}</span>
                    </div>
                    <ActionGrid
                      reading={reading}
                      selected={selected}
                      choose={(action) => {
                        if (walkthrough) setSelected(action);
                      }}
                    />
                    <p>
                      {walkthrough
                        ? 'Select a different action to test it, then advance the copy.'
                        : 'A random action may differ from the network’s highest value.'}{' '}
                      {stats.updates
                        ? 'Values estimate future return in the learner’s scaled units, not probabilities or immediate points.'
                        : 'These initial action scores are not yet calibrated future-reward estimates.'}
                    </p>
                    <small>
                      Exploration during training:{' '}
                      {(reading.epsilon * 100).toFixed(1)}%. Walkthroughs use no
                      random exploration.
                    </small>
                  </section>
                  <section className="lesson-card reward-card">
                    <h3>
                      <b>03</b> Receive feedback
                    </h3>
                    {reading.after ? (
                      <>
                        <div className="decision-reward">
                          <strong>
                            {Object.values(reading.after.reward)
                              .reduce((sum, value) => sum + value, 0)
                              .toFixed(2)}
                          </strong>
                          <span>
                            points from this{' '}
                            {Math.max(
                              0,
                              reading.after.time - reading.before.time,
                            ).toFixed(2)}{' '}
                            s step
                          </span>
                        </div>
                        {Object.entries(reading.after.reward)
                          .filter(([, value]) => Math.abs(value) > 0.00001)
                          .map(([key, value]) => (
                            <div className="lesson-reward-row" key={key}>
                              <span>{rewardNames[key]}</span>
                              <meter
                                min={0}
                                max={Math.max(
                                  1,
                                  ...Object.values(reading.after!.reward).map(
                                    Math.abs,
                                  ),
                                )}
                                value={Math.abs(value)}
                                className={value < 0 ? 'negative' : ''}
                              />
                              <strong
                                className={value < 0 ? 'negative' : 'positive'}
                              >
                                {value > 0 ? '+' : ''}
                                {value.toFixed(2)}
                              </strong>
                            </div>
                          ))}
                        <p>
                          {reading.after.done
                            ? reading.after.reason
                            : 'Rewards favor new forward progress and completed checkpoints. Time, reversing and leaving the road cost points.'}
                        </p>
                      </>
                    ) : (
                      <p>
                        Advance the walkthrough or start RL to see actual
                        rewards. A predicted action value and an earned reward
                        are different quantities.
                      </p>
                    )}
                    <small>
                      A whole lap can earn 1,000 checkpoint points + 1,000
                      finish points, plus progress, before penalties. A
                      checkpoint pays once per lap.
                    </small>
                  </section>
                </div>
              )}
              {page === 'Network' && (
                <section className="lesson-card">
                  <h3>52 inputs, 9 possible controls</h3>
                  <p>
                    Inputs flow through two learned layers to produce nine
                    action values.
                  </p>
                  <div className="network-flow">
                    <div className="network-inputs">
                      <strong>52 inputs</strong>
                      {groups.map((item, index) => (
                        <button
                          key={item.name}
                          aria-pressed={group === index}
                          onClick={() => setGroup(index)}
                        >
                          {item.name}
                          <small>{item.end - item.start} values</small>
                        </button>
                      ))}
                    </div>
                    <ArrowRight className="network-arrow" />
                    {reading.network.hidden.map((layer, index) => (
                      <Fragment key={index}>
                        <div className="neuron-layer">
                          <strong>Hidden {index + 1}</strong>
                          <figure
                            className="neuron-grid"
                            aria-label={`64 actual neuron activations in hidden layer ${index + 1}`}
                          >
                            {layer.map((value, i) => (
                              <span
                                key={i}
                                title={`Neuron ${i + 1}: ${fmt(value)}`}
                                style={{
                                  opacity:
                                    0.16 +
                                    0.84 *
                                      Math.min(
                                        1,
                                        Math.max(0, value) /
                                          Math.max(0.001, ...layer),
                                      ),
                                }}
                              />
                            ))}
                          </figure>
                          <small>64 ReLU neurons</small>
                        </div>
                        {index === 0 && (
                          <ArrowRight className="network-arrow" />
                        )}
                      </Fragment>
                    ))}
                    <ArrowRight className="network-arrow" />
                    <div className="network-output">
                      <strong>9 action values</strong>
                      {reading.network.values.map((value, i) => (
                        <div
                          key={i}
                          className={i === reading.action ? 'chosen' : ''}
                        >
                          <span>{ACTION_NAMES[i]}</span>
                          <b>{fmt(value)}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="lesson-caption">
                    Every square is one actual neuron. Brightness is relative to
                    the strongest activation in its layer. It shows activity,
                    not importance or an explanation of causality. Arrows show
                    the network structure, not individual weights.
                  </p>
                  <details className="lesson-input-detail">
                    <summary>{groups[group].name}: inspect the inputs</summary>
                    <p>
                      {groups[group].help} Values below are the normalized
                      numbers passed to the network.
                    </p>
                    <div>
                      {groups[group].labels.map((label, i) => (
                        <label key={label}>
                          <span>{label}</span>
                          <meter
                            min={-1}
                            max={1}
                            value={Math.max(
                              -1,
                              Math.min(
                                1,
                                reading.network.inputs[groups[group].start + i],
                              ),
                            )}
                          />
                          <b>
                            {fmt(
                              reading.network.inputs[groups[group].start + i],
                            )}
                          </b>
                        </label>
                      ))}
                    </div>
                  </details>
                  {reading.bestValues && (
                    <details className="lesson-input-detail">
                      <summary>
                        Compare learner and saved best in this situation
                      </summary>
                      <p>
                        Both frozen networks see exactly the same inputs. This
                        compares their preferences, not their full-race
                        performance.
                      </p>
                      <table>
                        <thead>
                          <tr>
                            <th>Action</th>
                            <th>Learner</th>
                            <th>Saved best</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reading.network.values.map((value, i) => (
                            <tr key={i}>
                              <td>{ACTION_NAMES[i]}</td>
                              <td>{fmt(value)}</td>
                              <td>{fmt(reading.bestValues![i])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </section>
              )}
              {page === 'Learning update' && (
                <section className="lesson-card">
                  <h3>Learn from past driving</h3>
                  <p>
                    The learner stores driving experiences, then samples 32 for
                    each update. It revisits old situations rather than only
                    learning from the latest action.
                  </p>
                  {walkthrough ? (
                    <p className="lesson-notice">
                      This walkthrough does not learn. Resume learning to
                      inspect a real optimizer update.
                    </p>
                  ) : update && example ? (
                    <>
                      <div className="replay-caption">
                        <strong>
                          Replay memory → sampled experiences → update{' '}
                          {update.update.toLocaleString()}
                        </strong>
                        <span>
                          Showing 8 of the actual {update.batchSize} sampled
                          experiences. This update may belong to an earlier
                          decision. This batch stays still while learning
                          continues.
                        </span>
                        <Button
                          variant="outline"
                          disabled={
                            !availableUpdate ||
                            availableUpdate.update === update.update
                          }
                          onClick={() => {
                            setHeldUpdate(availableUpdate!);
                            setSample(0);
                          }}
                        >
                          Refresh sampled update
                        </Button>
                      </div>
                      <div className="replay-samples">
                        {update.samples.map((item, i) => (
                          <button
                            key={i}
                            aria-pressed={sample === i}
                            onClick={() => setSample(i)}
                          >
                            <small>
                              {item.track === null
                                ? 'Circuit unknown'
                                : TRACKS[item.track].name}
                            </small>
                            <strong>{ACTION_NAMES[item.action]}</strong>
                            <span>
                              {item.reward.toFixed(1)} points
                              {item.terminal ? ' · terminal' : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                      <h4>Experience {sample + 1}: what changed?</h4>
                      <div className="update-values">
                        <div>
                          <small>Prediction before</small>
                          <strong>{fmt(example.prediction)}</strong>
                        </div>
                        <ArrowRight />
                        <div>
                          <small>Learning target</small>
                          <strong>{fmt(example.target)}</strong>
                        </div>
                        <ArrowRight />
                        <div>
                          <small>Prediction after</small>
                          <strong>{fmt(example.after)}</strong>
                        </div>
                      </div>
                      <p>
                        The target is{' '}
                        {example.target > example.prediction
                          ? 'higher'
                          : 'lower'}{' '}
                        than the old estimate. The optimizer combines all 32
                        experiences
                        {update.demonstrationLoss
                          ? ' and instructor examples'
                          : ''}
                        ; this particular prediction may move either way.
                      </p>
                      <details className="lesson-input-detail">
                        <summary>Show the learning math</summary>
                        <p>
                          Target = reward × 0.01 + discounted future value.
                          Terminal experiences have no future-value term. The
                          experimental preset may combine three decisions into
                          one experience.
                        </p>
                        <dl>
                          <dt>Reward-value loss, batch mean</dt>
                          <dd>{fmt(update.tdLoss)}</dd>
                          <dt>Instructor loss × 5</dt>
                          <dd>{fmt(update.demonstrationLoss)}</dd>
                        </dl>
                        <p>
                          Lower loss means better agreement with the learning
                          targets. Completed races measure driving success.
                        </p>
                      </details>
                    </>
                  ) : (
                    <div className="lesson-empty">
                      <BrainCircuit size={36} />
                      {availableUpdate && (
                        <Button onClick={() => setHeldUpdate(availableUpdate)}>
                          Inspect sampled update
                        </Button>
                      )}
                      <strong>
                        {availableUpdate
                          ? 'An update is ready'
                          : warmup
                            ? 'First, learn from the instructor'
                            : 'Waiting for a driving update'}
                      </strong>
                      <p>
                        {availableUpdate
                          ? 'Inspect this sampled batch to see how its predictions changed. Learning can continue while you read.'
                          : warmup
                            ? `${stats.coachSamples.toLocaleString()} / 12,000 examples · ${stats.coachUpdates.toLocaleString()} / 4,000 supervised updates. Replay-based RL starts after warm-up.`
                            : 'RL begins updating after 256 experiences. Start or resume training to see real sampled experiences here.'}
                      </p>
                      {stats.coachLoss !== null && (
                        <span>
                          Instructor action-label loss: {fmt(stats.coachLoss)}
                        </span>
                      )}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
