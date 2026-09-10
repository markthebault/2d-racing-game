'use client';
import { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line import/default -- Vite provides the asset URL as this query module's default export.
import trainingWorkerUrl from '../lib/rl/training.worker.ts?worker&url';
import { Play, Pause, BrainCircuit } from 'lucide-react';
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TRACKS } from '@/lib/race';
import { ACTION_NAMES, type AgentFrame } from '@/lib/rl/environment';
import { PRESETS, type Preset } from '@/lib/rl/config';
import { MODEL_PREFIX, migrateModel, modelKey, type Checkpoint } from '@/lib/rl/models';
import { emptyTrainingStats, type ComparisonReport, type WorkerCommand, type WorkerMessage } from '@/lib/rl/protocol';
import type { EvaluationSummary } from '@/lib/rl/evaluation';

type Session = { preset: Preset; seed: number; checkpoint: Checkpoint | null; revision: number };
type LibraryEntry = { key: string; model: Checkpoint; legacy: boolean };
function readModels(): LibraryEntry[] {
  const result: LibraryEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (!key.startsWith(MODEL_PREFIX) && !/^pocket-circuit-dqn-v1-track-[0-2]$/.test(key)) continue;
    try { const saved = JSON.parse(localStorage.getItem(key)!); result.push({ key, model: migrateModel(saved), legacy: saved.version === 1 }); }
    catch { /* Keep unreadable or future-version saves untouched. */ }
  }
  return result.reverse();
}
export function TrainingLab({ track, onFrame }: { track: number; onFrame: (frame: AgentFrame) => void }) {
  const [session, setSession] = useState<Session>({ preset: 'local', seed: 42, checkpoint: null, revision: 0 });
  const [models, setModels] = useState<LibraryEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [preset, setPreset] = useState<Preset>('local');
  const [seed, setSeed] = useState(42);
  const [notice, setNotice] = useState('Saved models from every circuit are available here.');
  useEffect(() => { queueMicrotask(() => { try { setModels(readModels()); } catch { setNotice('Browser storage is unavailable. This session can still train and play models in memory.'); } }); }, []);
  const saved = models.find(m => m.key === selected);
  const saveModel = (model: Checkpoint) => {
    const entry = { key: modelKey(model), model, legacy: false };
    setModels(items => [entry, ...items.filter(m => m.key !== entry.key)]);
    try { localStorage.setItem(entry.key, JSON.stringify(model)); setNotice('Best model saved. Loading it on another circuit keeps the source model and evaluates a separate copy.'); }
    catch { setNotice('Browser storage is unavailable or full. The latest model is available in this session, but will not survive closing the page.'); }
  };
  const start = (checkpoint: Checkpoint | null) => setSession(s => ({ checkpoint, preset: checkpoint?.preset ?? preset, seed: checkpoint?.seed ?? seed, revision: s.revision + 1 }));
  return <section className="training-lab" aria-label="Reinforcement learning lab">
    <header className="training-header"><div><span className="eyebrow"><BrainCircuit size={15}/> REINFORCEMENT LEARNING</span><h3>Teach the car to drive</h3></div></header>
    <details className="model-library">
      <summary>Models & experiments</summary>
      <label>Saved model · any circuit<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose a saved model</option>{models.map(entry => <option key={entry.key} value={entry.key}>{TRACKS[entry.model.track].name} · {entry.model.preset} · seed {entry.model.seed} · ep {entry.model.episode}{entry.legacy ? ' · legacy' : ''} · {entry.model.id.slice(-5)}</option>)}</select></label>
      <Button variant="outline" disabled={!saved} onClick={() => start(saved!.model)}>Load on {TRACKS[track].name}</Button>
      <p>Loading starts a fresh evaluation on this circuit. Then run the model or continue training here. Source weights are retained. A successful load does not guarantee a completed lap.</p>
      <div className="experiment-controls"><label>New experiment<select value={preset} onChange={e => setPreset(e.target.value as Preset)}>{Object.entries(PRESETS).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></label><label>Training seed<input type="number" min={0} max={2147483647} value={seed} onChange={e => setSeed(Math.max(0, Math.min(2147483647, Math.floor(Number(e.target.value) || 0))))}/></label></div>
      <Button variant="outline" onClick={() => start(null)}>Start fresh session</Button><p>This ends the current live session. Saved models remain available.</p>
    </details>
    <TrainingSession key={`${track}-${session.revision}`} track={track} config={session} onFrame={onFrame} onSave={saveModel}/>
    <p className="model-storage-note">{notice} Models and reports stay in this browser. Older models load as the corrected baseline with their learned weights preserved.</p>
  </section>;
}
function TrainingSession({ track, config, onFrame, onSave }: { track: number; config: Session; onFrame: (frame: AgentFrame) => void; onSave: (model: Checkpoint) => void }) {
  const worker = useRef<Worker | null>(null), callbacks = useRef({ onFrame, onSave });
  useEffect(() => { callbacks.current = { onFrame, onSave }; }, [onFrame, onSave]);
  const [stats, setStats] = useState(emptyTrainingStats), [frame, setFrame] = useState<AgentFrame | null>(null);
  const [speed, setSpeed] = useState(4), [budget, setBudget] = useState(100);
  const [savedReport, setSavedReport] = useState<ComparisonReport | null>(null), [reportNotice, setReportNotice] = useState('');
  useEffect(() => {
    let active = true, instance: Worker;
    try { const raw = localStorage.getItem(`pocket-circuit-comparison-v2-track-${track}`); if (raw) { const report = JSON.parse(raw) as ComparisonReport; if (report.track === track && Array.isArray(report.rows) && report.rows.every(row => PRESETS[row.preset] && Array.isArray(row.evaluation?.runs))) queueMicrotask(() => { if (active) setSavedReport(report); }); } } catch { /* Comparisons can run without persistence. */ }
    try { instance = new Worker(new URL(trainingWorkerUrl, window.location.href), { type: 'module' }); }
    catch { queueMicrotask(() => setStats(s => ({ ...s, status: 'error', message: 'This browser could not start the training worker.' }))); return; }
    worker.current = instance;
    instance.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (!active) return;
      const message = event.data;
      if (message.type === 'stats') setStats(message.stats);
      if (message.type === 'frame') { setFrame(message.frame); callbacks.current.onFrame(message.frame); }
      if (message.type === 'error') setStats(s => ({ ...s, status: 'error', message: message.message }));
      if (message.type === 'checkpoint') callbacks.current.onSave(message.checkpoint);
      if (message.type === 'report') {
        setSavedReport(message.report);
        try { localStorage.setItem(`pocket-circuit-comparison-v2-track-${track}`, JSON.stringify(message.report)); }
        catch { setReportNotice('Comparison results could not be saved. Keep this page open to retain them.'); }
      }
    };
    instance.onerror = event => setStats(s => ({ ...s, status: 'error', message: event.message ? `Training worker error: ${event.message}. Reload to retry; saved models are retained.` : 'The training worker could not load. Reload to retry; saved models are retained.' }));
    instance.postMessage({ type: 'init', track, checkpoint: config.checkpoint, preset: config.preset, seed: config.seed } satisfies WorkerCommand);
    const pauseHidden = () => { if (document.hidden) instance.postMessage({ type: 'pause' }); };
    document.addEventListener('visibilitychange', pauseHidden);
    return () => { active = false; instance.terminate(); worker.current = null; document.removeEventListener('visibilitychange', pauseHidden); };
  }, [track, config]);
  const command = (message: WorkerCommand) => worker.current?.postMessage(message);
  const busy = ['training', 'evaluating', 'playing'].includes(stats.status), unavailable = ['loading', 'error'].includes(stats.status);
  const comparing = !!stats.comparison && !stats.comparison.complete;
  const report = stats.comparison ?? savedReport;
  const rewardConfig = PRESETS[stats.preset], bestEval = stats.best?.evaluation;
  return <>
    <div className="session-label"><span>{PRESETS[stats.preset].label} · seed {stats.seed}</span><span className={'training-status ' + (busy ? 'active' : '')}>{stats.status.replace('-', ' ')}</span></div>
    <div className="training-actions">
      <Button className="train-button" disabled={unavailable} onClick={() => command({ type: busy ? 'pause' : 'train' })}>{busy ? <Pause size={16}/> : <Play size={16}/>} {busy ? 'Pause' : stats.steps ? 'Resume training' : 'Start training'}</Button>
      <Button variant="outline" disabled={!stats.best || unavailable || stats.status === 'playing'} onClick={() => command({ type: 'play' })}><Play size={16}/> Run best model</Button>
      <Button variant="outline" disabled={!stats.best || unavailable || comparing || stats.status === 'evaluating'} onClick={() => command({ type: 'evaluate' })}>Evaluate best · 5 starts</Button>
      <label>Training speed<select value={speed} onChange={e => { const next = Number(e.target.value); setSpeed(next); command({ type: 'speed', speed: next }); }}><option value={1}>1× · watch each attempt</option><option value={4}>4×</option><option value={20}>20×</option><option value={0}>Fastest · sampled view</option></select></label>
    </div>
    <output className="training-message">{stats.message}{stats.evaluationCase && <span className="evaluation-case">{stats.evaluationCase}</span>}</output>
    <div className="training-metrics">
      <Metric label="Episodes completed" value={stats.episode.toLocaleString()}/><Metric label="Current score" value={frame ? frame.score.toFixed(0) : '—'}/>
      <Metric label="Best evaluation · mean score" value={bestEval ? bestEval.meanScore.toFixed(0) : '—'} detail={stats.best ? `This circuit · model episode ${stats.best.episode}` : 'First evaluation after episode 1'}/>
      <Metric label="Training loss" value={stats.loss === null ? '—' : stats.loss.toFixed(5)} detail={`${stats.updates.toLocaleString()} gradient updates`}/>
      <Metric label="Mean training score · last 20" value={stats.mean === null ? '—' : stats.mean.toFixed(0)}/>
      <Metric label="Training lap completion" value={stats.completion === null ? '—' : `${(stats.completion * 100).toFixed(1)}%`} detail="Includes exploratory actions"/>
      <Metric label="Exploration" value={`${(stats.epsilon * 100).toFixed(1)}%`}/><Metric label="Replay memory" value={stats.replaySize.toLocaleString()} detail={`${stats.steps.toLocaleString()} decisions collected`}/>
    </div>
    <EvaluationMetrics evaluation={stats.evaluation}/>
    <div className="training-live"><span>{stats.status === 'playing' || stats.status === 'playback-ended' ? 'BEST MODEL' : stats.status === 'evaluating' ? 'EVALUATION · NO EXPLORATION' : 'CURRENT ATTEMPT'}</span><strong>{frame ? ACTION_NAMES[frame.action] : 'Waiting'}</strong><label>Lap progress<progress max={1} value={frame?.progress ?? 0}/><b>{((frame?.progress ?? 0) * 100).toFixed(1)}%</b></label></div>
    <div className="training-charts"><TrainingChart title="Score per episode" description="Lime: each attempt. Blue: rolling mean of 20." data={stats.history} kind="score"/><TrainingChart title="Learning loss" description="Reward-prediction error. Lower loss alone does not mean better driving." data={stats.history} kind="loss"/></div>
    <details className="comparison-controls"><summary>Controlled comparison · P1 and P2</summary>
      <p>Four experiments × seeds 42, 1337, and 2026. Each run starts with random weights, the same training start, the same episode budget, and the same five evaluation poses. Adjacent experiments change one factor. Existing saves are retained; starting a comparison ends the current live run.</p>
      <label>Episodes per run<select value={budget} onChange={e => setBudget(Number(e.target.value))}><option value={100}>100 · short comparison</option><option value={400}>400</option><option value={1000}>1,000 · longer comparison</option></select></label>
      <Button variant="outline" disabled={unavailable || busy || comparing} onClick={() => command({ type: 'compare', episodes: budget })}>Run 12 fresh training runs</Button>
      {comparing && <p>Run {stats.comparisonRun}/12. Use Pause and Resume training above. Fastest is recommended; this may take a while.</p>}
      {report && <ComparisonResults report={report}/>}{reportNotice && <p>{reportNotice}</p>}
    </details>
    <div className="training-explanation"><details><summary>Rewards and inputs in this experiment</summary><dl>
      <div><dt>Full lap through three checkpoints</dt><dd>+1,000</dd></div><div><dt>New forward progress</dt><dd>{rewardConfig.normalizedProgress ? '+750 / full lap' : '+3 / world unit'}</dd></div><div><dt>Extra speed reward</dt><dd>{rewardConfig.speedBonus ? 'Up to +1 / unit' : 'None'}</dd></div><div><dt>Off the road</dt><dd>−50 / second</dd></div><div><dt>Reverse progress</dt><dd>{rewardConfig.normalizedProgress ? '−750 / lap length' : '−3 / world unit'}</dd></div><div><dt>Time passing</dt><dd>−1 / second</dd></div><div><dt>Failure or timeout</dt><dd>−100</dd></div>
      </dl><p>34 input slots include the 12 ray distances, speed and controls, relative road position and heading, map headings ahead, and off-road duration. New history inputs expose elapsed time, stalled time, signed progress, progress already rewarded, checkpoint count, and relative distance to the next checkpoint.</p><p>{rewardConfig.absolutePosition ? 'This comparison stage also uses X/Z and absolute lap-position features.' : 'X/Z and absolute lap-position features are masked to zero. Relative task progress remains available so rewards and termination do not depend on hidden history.'} This is still map-assisted driving because road headings ahead are included.</p><p>Progress cannot earn points twice. Leaving the road for one second, moving more than three units beyond its edge, getting stuck for six seconds, or reaching 90 seconds ends an attempt. Normal playback starts at the finish line. Varied-start evaluations require a full circuit back to each test’s own starting position.</p>
      {frame && <p className="reward-now">Latest decision: progress {frame.reward.progress.toFixed(1)} · speed {frame.reward.speed.toFixed(1)} · off-road {frame.reward.offroad.toFixed(1)} · reverse {frame.reward.reverse.toFixed(1)} · time {frame.reward.time.toFixed(1)} · finish {frame.reward.finish} · failure {frame.reward.failure}</p>}</details>
      <details><summary>How evaluation and saving work</summary><p>Five fixed starts test the line, lateral and heading offsets, and two other positions around the circuit. Learning and exploration are off throughout evaluation. Best models are ranked by lap completion first, then mean reward within this experiment and circuit.</p><p>Evaluations run after episode 1 and every 10 episodes. Best-score reports appear every 100 episodes. Evaluation uses the latest learner unless you press Evaluate best. Lap time averages completed laps only; a dash means no completed lap. Off-road time averages all five runs.</p><p>Models are copied when transferred to a new circuit. Scores are cleared and measured again there. Resume training fine-tunes the copied model with a new replay buffer. Refreshing preserves saved weights but not optimizer state or unfinished training.</p></details></div>
    <div className="training-checkpoints"><h4>Every 100 episodes</h4>{stats.milestones.length ? <Table><TableHeader><TableRow><TableHead>Episode</TableHead><TableHead>Best mean score</TableHead><TableHead>Model from</TableHead><TableHead>Eval success</TableHead></TableRow></TableHeader><TableBody>{stats.milestones.slice().reverse().map(m => <TableRow key={m.episode}><TableCell>{m.episode}</TableCell><TableCell>{m.best.toFixed(0)}</TableCell><TableCell>{m.bestEpisode}</TableCell><TableCell>{(m.completion * 100).toFixed(0)}%</TableCell></TableRow>)}</TableBody></Table> : <p>The first report appears after episode 100 and its evaluation.</p>}</div>
    <p className="model-storage-note">Training and evaluation run in this browser. Hiding the tab pauses them. Switching circuits or sessions ends the current live run; select a saved model to reuse it.</p>
  </>;
}
function EvaluationMetrics({ evaluation }: { evaluation: EvaluationSummary | null }) {
  return <section className="evaluation-metrics" aria-label="Evaluation metrics"><h4>Latest evaluation · five varied starts</h4><div className="training-metrics">
    <Metric label="Evaluation lap completion" value={evaluation ? `${(evaluation.successRate * 100).toFixed(0)}%` : '—'} detail="No random actions"/>
    <Metric label="Mean lap time · successes" value={evaluation?.meanLapTime != null ? `${evaluation.meanLapTime.toFixed(2)} s` : '—'}/>
    <Metric label="Mean off-road time · all runs" value={evaluation ? `${evaluation.meanOffroadTime.toFixed(2)} s` : '—'}/>
    <Metric label="Mean circuit progress" value={evaluation ? `${(evaluation.meanProgress * 100).toFixed(1)}%` : '—'}/>
  </div>{evaluation && <details><summary>Individual evaluation attempts</summary><Table><TableHeader><TableRow><TableHead>Start</TableHead><TableHead>Lap</TableHead><TableHead>Time</TableHead><TableHead>Off-road</TableHead></TableRow></TableHeader><TableBody>{evaluation.runs.map(r => <TableRow key={r.name}><TableCell>{r.name}</TableCell><TableCell>{r.completed ? 'Complete' : `${(r.progress * 100).toFixed(0)}%`}</TableCell><TableCell>{r.completed ? r.time.toFixed(2) + 's' : '—'}</TableCell><TableCell>{r.offroadTime.toFixed(2)}s</TableCell></TableRow>)}</TableBody></Table></details>}</section>;
}
function ComparisonResults({ report }: { report: ComparisonReport }) {
  const groups = Object.entries(PRESETS).map(([preset, config]) => {
    const rows = report.rows.filter(r => r.preset === preset), runs = rows.flatMap(r => r.evaluation.runs), laps = runs.filter(r => r.completed);
    return { preset, label: config.label, count: rows.length, success: runs.length ? laps.length / runs.length : null,
      offroad: runs.length ? runs.reduce((sum, r) => sum + r.offroadTime, 0) / runs.length : null,
      lapTime: laps.length ? laps.reduce((sum, r) => sum + r.time, 0) / laps.length : null };
  });
  return <div className="comparison-results"><h4>{report.complete ? 'Completed comparison' : 'Partial comparison'} · {TRACKS[report.track].name}</h4><p>{report.budget} episodes per seed. Values use the final learner at the budget, not the best checkpoint. Episode budgets match; decision counts can differ.</p><Table><TableHeader><TableRow><TableHead>Experiment</TableHead><TableHead>Seeds</TableHead><TableHead>Success</TableHead><TableHead>Off-road</TableHead><TableHead>Lap time</TableHead></TableRow></TableHeader><TableBody>{groups.map(g => <TableRow key={g.preset}><TableCell>{g.label}</TableCell><TableCell>{g.count}/3</TableCell><TableCell>{g.success === null ? '—' : `${(g.success * 100).toFixed(0)}%`}</TableCell><TableCell>{g.offroad === null ? '—' : g.offroad.toFixed(2) + 's'}</TableCell><TableCell>{g.lapTime === null ? '—' : g.lapTime.toFixed(2) + 's'}</TableCell></TableRow>)}</TableBody></Table>
  <details><summary>Per-seed results</summary><Table><TableHeader><TableRow><TableHead>Preset / seed</TableHead><TableHead>Decisions</TableHead><TableHead>Success</TableHead><TableHead>Mean score</TableHead></TableRow></TableHeader><TableBody>{report.rows.map(row => <TableRow key={row.preset + row.seed}><TableCell>{row.preset} / {row.seed}</TableCell><TableCell>{row.steps}</TableCell><TableCell>{(row.evaluation.successRate * 100).toFixed(0)}%</TableCell><TableCell>{row.evaluation.meanScore.toFixed(0)}</TableCell></TableRow>)}</TableBody></Table></details><p>Reward scales differ across experiments. Compare completion, off-road time, and successful lap time rather than raw scores. Three seeds and five starts are a small evaluation sample, not a guarantee.</p></div>;
}
function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }
function TrainingChart({ title, description, data, kind }: { title: string; description: string; data: ReturnType<typeof emptyTrainingStats>['history']; kind: 'score' | 'loss' }) {
  return <figure><figcaption><strong>{title}</strong><span>{description}</span></figcaption>{data.length ? <ChartContainer className="rl-chart" config={{ score: { label: 'Score', color: '#daef8c' }, mean: { label: 'Mean / 20', color: '#84dcff' }, loss: { label: 'Loss', color: '#f99557' } }}><LineChart data={data} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}><CartesianGrid vertical={false} stroke="#35463b"/><XAxis dataKey="episode" minTickGap={30} tickLine={false} axisLine={false}/><YAxis width={48} tickLine={false} axisLine={false} tickFormatter={n => Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : Number(n).toFixed(kind === 'loss' ? 2 : 0)}/><ChartTooltip content={<ChartTooltipContent/>}/><Line type="linear" dataKey={kind} stroke={`var(--color-${kind})`} strokeWidth={1.5} dot={false} isAnimationActive={false}/>{kind === 'score' && <Line type="linear" dataKey="mean" stroke="var(--color-mean)" strokeWidth={2} dot={false} isAnimationActive={false}/>}</LineChart></ChartContainer> : <div className="chart-empty">Completed episodes will appear here.</div>}<small>Episode number · latest 300 attempts in this session</small></figure>;
}
