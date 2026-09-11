'use client';
import { LearningExplorer } from './learning-explorer';
import type { DecisionReading } from '../lib/rl/insights';
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
import type { FleetFrame } from '@/lib/rl/batch';

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
export function TrainingLab({ track, laps, onFrame, onFleet }: { track: number; laps: number; onFrame: (frame: AgentFrame) => void; onFleet: (frame: FleetFrame | null) => void }) {
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
      <label>Saved model · any circuit<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose a saved model</option>{models.map(entry => <option key={entry.key} value={entry.key}>{TRACKS[entry.model.track].name} · {entry.model.preset} · seed {entry.model.seed} · ep {entry.model.episode}{entry.legacy ? ' · legacy' : ''}{entry.model.guided ? ' · guided' : ''} · {entry.model.id.slice(-5)}</option>)}</select></label>
      <Button variant="outline" disabled={!saved} onClick={() => start(saved!.model)}>Load on {TRACKS[track].name}</Button>
      <p>Loading starts a new three-track session and evaluates the saved weights across that set. Run the model on the viewed circuit or continue shared training. Source weights are retained. A successful load does not guarantee a completed race.</p>
      <div className="experiment-controls"><label>New experiment<select value={preset} onChange={e => setPreset(e.target.value as Preset)}>{Object.entries(PRESETS).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></label><label>Training seed<input type="number" min={0} max={2147483647} value={seed} onChange={e => setSeed(Math.max(0, Math.min(2147483647, Math.floor(Number(e.target.value) || 0))))}/></label></div>
      <Button variant="outline" onClick={() => start(null)}>Start fresh session</Button><p>This ends the current live session. Saved models remain available.</p>
    </details>
    <TrainingSession key={session.revision} track={track} laps={laps} config={session} onFrame={onFrame} onFleet={onFleet} onSave={saveModel}/>
    <p className="model-storage-note">{notice} Models and reports stay in this browser. Older models load as the corrected baseline with their learned weights preserved.</p>
  </section>;
}
function TrainingSession({ track, laps, config, onFrame, onFleet, onSave }: { track: number; laps: number; config: Session; onFrame: (frame: AgentFrame) => void; onFleet: (frame: FleetFrame | null) => void; onSave: (model: Checkpoint) => void }) {
  const worker = useRef<Worker | null>(null), callbacks = useRef({ onFrame, onFleet, onSave, track, laps });
  const initialTrack = useRef(track);
  const initialLaps = useRef(laps);
  const fleetUiTime = useRef(0);
  useEffect(() => { callbacks.current = { onFrame, onFleet, onSave, track, laps }; }, [onFrame, onFleet, onSave, track, laps]);
  const [reading, setReading] = useState<DecisionReading | null>(null);
  const [fleet, setFleet] = useState<FleetFrame | null>(null);
  const [stats, setStats] = useState(emptyTrainingStats), [frame, setFrame] = useState<AgentFrame | null>(null);
  const [speed, setSpeed] = useState(4), [budget, setBudget] = useState(100);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [chartTrack, setChartTrack] = useState('all');
  const [draftTracks, setDraftTracks] = useState<number[]>([0, 1, 2]);
  const [multi, setMulti] = useState(true), [varied, setVaried] = useState(true);
  const [savedReport, setSavedReport] = useState<ComparisonReport | null>(null), [reportNotice, setReportNotice] = useState('');
  useEffect(() => {
    const track = initialTrack.current;
    let active = true, instance: Worker;
    try { const raw = localStorage.getItem(`pocket-circuit-comparison-v2-track-${track}`); if (raw) { const report = JSON.parse(raw) as ComparisonReport; if (report.track === track && Array.isArray(report.rows) && report.rows.every(row => PRESETS[row.preset] && Array.isArray(row.evaluation?.runs))) queueMicrotask(() => { if (active) setSavedReport(report); }); } } catch { /* Comparisons can run without persistence. */ }
    try { instance = new Worker(new URL(trainingWorkerUrl, window.location.href), { type: 'module' }); }
    catch { queueMicrotask(() => setStats(s => ({ ...s, status: 'error', message: 'This browser could not start the training worker.' }))); return; }
    worker.current = instance;
    instance.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (!active) return;
      const message = event.data;
      if (message.type === 'insight') setReading(message.reading);
      if (message.type === 'stats' && message.stats.track === callbacks.current.track && message.stats.targetLaps === callbacks.current.laps) setStats(message.stats);
      if (message.type === 'frame' && message.track === callbacks.current.track && message.frame.targetLaps === callbacks.current.laps) { setFrame(message.frame); callbacks.current.onFrame(message.frame); }
      if (message.type === 'fleet' && (!message.frame || message.frame.track === callbacks.current.track)) {
        if (!message.frame || message.frame.time === 0 || performance.now() - fleetUiTime.current > 150) { setFleet(message.frame); setFrame(null); fleetUiTime.current = performance.now(); }
        callbacks.current.onFleet(message.frame);
      }
      if (message.type === 'error') setStats(s => ({ ...s, status: 'error', message: message.message }));
      if (message.type === 'checkpoint') callbacks.current.onSave(message.checkpoint);
      if (message.type === 'report') {
        setSavedReport(message.report);
        try { localStorage.setItem(`pocket-circuit-comparison-v2-track-${message.report.track}`, JSON.stringify(message.report)); }
        catch { setReportNotice('Comparison results could not be saved. Keep this page open to retain them.'); }
      }
    };
    instance.onerror = event => setStats(s => ({ ...s, status: 'error', message: event.message ? `Training worker error: ${event.message}. Reload to retry; saved models are retained.` : 'The training worker could not load. Reload to retry; saved models are retained.' }));
    instance.postMessage({ type: 'init', coach: !config.checkpoint, trainingTracks: [0, 1, 2], variedStarts: true, track, laps: initialLaps.current, checkpoint: config.checkpoint, preset: config.preset, seed: config.seed } satisfies WorkerCommand);
    const pauseHidden = () => { if (document.hidden) instance.postMessage({ type: 'pause' }); };
    document.addEventListener('visibilitychange', pauseHidden);
    return () => { active = false; instance.terminate(); worker.current = null; document.removeEventListener('visibilitychange', pauseHidden); };
  }, [config]);
  useEffect(() => { worker.current?.postMessage({ type: 'track', track, laps } satisfies WorkerCommand); }, [track, laps]);
  const command = (message: WorkerCommand) => worker.current?.postMessage(message);
  const busy = ['coaching', 'training', 'evaluating', 'playing', 'replaying'].includes(stats.status), unavailable = ['loading', 'error'].includes(stats.status) || stats.track !== track || stats.targetLaps !== laps;
  const comparing = !!stats.comparison && !stats.comparison.complete;
  const report = stats.comparison?.track === track ? stats.comparison : savedReport?.track === track ? savedReport : null;
  const rewardConfig = PRESETS[stats.preset], bestEval = stats.best?.evaluation;
  const planTracks = multi ? [...draftTracks].sort((a,b)=>a-b) : [track];
  const planChanged = JSON.stringify(planTracks) !== JSON.stringify(stats.trainingTracks) || varied !== stats.variedStarts;
  const chartHistory = stats.history.filter(row=>chartTrack==='all'||row.track===Number(chartTrack));
  const chartData = chartHistory.map((row,index)=>({...row,mean:chartHistory.slice(Math.max(0,index-19),index+1).reduce((sum,item)=>sum+item.score,0)/Math.min(index+1,20)}));
  const bestResults = stats.best?.evaluations ?? [];
  const sharedScore = bestResults.length ? bestResults.reduce((sum,r)=>sum+r.meanScore,0)/bestResults.length : bestEval?.meanScore;
  return <>
    <LearningExplorer reading={reading} stats={stats} command={command}/>
    <fieldset className="training-plan">
      <legend>Training circuits</legend>
      <label><input type="checkbox" checked={multi} onChange={e=>setMulti(e.target.checked)}/> Train across three tracks</label>
      {multi && <div className="training-track-choices">{TRACKS.map((circuit,index)=><label key={circuit.name}><input type="checkbox" aria-label={`Train on ${circuit.name}`} checked={draftTracks.includes(index)} disabled={!draftTracks.includes(index) && draftTracks.length===3} onChange={e=>setDraftTracks(items=>e.target.checked ? [...items,index] : items.filter(t=>t!==index))}/><span>{circuit.name}<small>{circuit.kind}</small></span></label>)}</div>}
      <label><input type="checkbox" checked={varied} onChange={e=>setVaried(e.target.checked)}/> Mix in starts around the circuit</label>
      <small>{multi ? `${draftTracks.length}/3 selected. ` : 'Train on the circuit shown. '}Varied starts alternate finish-line starts with other positions. Each attempt still requires the requested full laps.</small>
      <Button variant="outline" disabled={unavailable || comparing || (multi && draftTracks.length!==3) || !planChanged} onClick={()=>command({type:'plan',tracks:planTracks,variedStarts:varied})}>Apply training setup</Button>
      <small>Applying restarts the current attempt and evaluates the retained weights. The circuit menu changes what you watch; it does not change an active three-track selection.</small>
    </fieldset>
    <div className="session-label"><span>{PRESETS[stats.preset].label} · seed {stats.seed}</span><span className={'training-status ' + (busy ? 'active' : '')}>{stats.status.replace('-', ' ')}</span></div>
    {stats.preset !== 'adaptive' && <details className="model-storage-note"><summary>Experimental corner rewards</summary><p>Corner-aware rewards are experimental and did not consistently improve our controlled tests. Switching retains weights but clears old scores and experience. Guided warm-up is the alternative tested below.</p><Button variant="outline" disabled={unavailable || comparing} onClick={()=>command({type:'upgrade'})}>Use corner-aware rewards</Button></details>}
    <div className="training-plan"><label><input type="checkbox" checked={stats.coachEnabled} disabled={unavailable || busy || comparing} onChange={event=>command({type:'coach',enabled:event.target.checked})}/> Guided warm-up before RL</label><small>A geometric instructor labels states on the selected training tracks. The neural network learns those examples, then continues reinforcement learning with a demonstration regularizer. Model playback never calls the instructor.</small>{stats.coachEnabled && <><progress max={16000} value={stats.coachSamples+stats.coachUpdates}/><small>{stats.coachSamples.toLocaleString()}/12,000 examples · {stats.coachUpdates.toLocaleString()}/4,000 warm-up updates{stats.coachLoss===null?'':` · lesson loss ${stats.coachLoss.toFixed(3)}`}</small></>}</div>
    <div className="training-actions">
      <Button className="train-button" disabled={unavailable} onClick={() => command({ type: busy ? 'pause' : 'resume' })}>{busy ? <Pause size={16}/> : <Play size={16}/>} {busy ? 'Pause all' : stats.pausedActivity === 'batch' || stats.pausedActivity === 'play' || stats.pausedActivity === 'coach' ? 'Resume all' : stats.steps ? 'Resume training' : 'Start training'}</Button>
      {stats.pausedActivity === 'play' && stats.status === 'paused' && <Button variant="outline" onClick={() => command({ type: 'train' })}>Return to training</Button>}
      <Button variant="outline" disabled={!stats.best || unavailable || stats.status === 'playing'} onClick={() => command({ type: 'play' })}><Play size={16}/> Run best model</Button>
      <Button variant="outline" disabled={!stats.best || unavailable || comparing || stats.status === 'evaluating'} onClick={() => command({ type: 'evaluate' })}>Evaluate best · {stats.trainingTracks.length * 5} starts</Button>
      <Button variant="outline" disabled={!stats.best || unavailable || comparing || stats.status==='evaluating'} onClick={()=>command({type:'validate'})}>Test all 5 tracks</Button>
      <label>Training speed<select value={speed} onChange={e => { const next = Number(e.target.value); setSpeed(next); command({ type: 'speed', speed: next }); }}><option value={1}>1×</option><option value={4}>4×</option><option value={20}>20×</option><option value={0}>Fastest</option></select></label>
      <label>Minimum movement / 1 s<select aria-label="Minimum movement / 1 s" disabled={unavailable || comparing} value={stats.minDistance} onChange={e => command({ type: 'motion', minDistance: Number(e.target.value) })}>{[0, .25, .5, 1, 2, 3, 5].map(value => <option key={value} value={value}>{value ? `${value} world units` : 'Off'}</option>)}</select></label>
    </div>
    <p className="model-storage-note">Moving less than the selected distance over one simulated second ends the run with {stats.preset === 'adaptive' ? '−250' : '−100'} points, including playback. Net displacement counts, so rocking back and forth can fail. Changing this setting restarts the attempt and evaluation, clears recordings and experience memory, and retains learned weights. A new session defaults to 1 unit.</p>
    {frame && <p className="model-storage-note">Movement over 1 s: {frame.motionDistance === null ? 'Measuring…' : `${frame.motionDistance.toFixed(2)} units`} · minimum {frame.minDistance}</p>}
    {stats.lastPlayback && <p className="model-storage-note">Last playback · model episode {stats.lastPlayback.episode}: {stats.lastPlayback.reason}. Score {stats.lastPlayback.score.toFixed(0)} · {stats.lastPlayback.completedLaps}/{stats.lastPlayback.targetLaps} laps.</p>}
    <div className="batch-summary">
      <strong>{stats.backgroundLearning ? "Background learner active" : "Learner paused"}</strong>
      <span>Training on {TRACKS[stats.trainingTrack]?.name} · start {(stats.startFraction*100).toFixed(0)}% around the circuit</span>
      <small>Active set: {stats.trainingTracks.map(t=>TRACKS[t].name).join(' · ')}. {stats.variedStarts ? 'Varied starts on.' : 'Finish-line starts only.'}</small>
      <small>{stats.playbackEpisode !== null ? `Watching model from episode ${stats.playbackEpisode}. ` : ""}{stats.queuedGroups} replay groups queued{stats.skippedGroups ? ` · ${stats.skippedGroups} older groups skipped to keep memory bounded` : ""}. Playback never adds training experiences.</small>
      <label>Replay speed <select aria-label="Replay speed" value={replaySpeed} onChange={event=>{const speed=Number(event.target.value);setReplaySpeed(speed);command({type:'replay-speed',speed});}}>{[1,2,4,8].map(speed=><option key={speed} value={speed}>{speed}×</option>)}</select></label>
      <small>{laps} laps per attempt · {stats.checkpointCount} checkpoints per lap · +{(1000 / stats.checkpointCount).toFixed(2).replace(/\.00$/, "")} each. Changing laps starts a new attempt and evaluation, retaining the learner.</small>
      <strong>{fleet ? `Episodes ${fleet.first}–${fleet.last} · ${fleet.poses.length} cars on this circuit` : `Next group · ${stats.batchCount}/50 recorded`}</strong>
      {fleet ? <><span>{fleet.poses.filter(p => !p.done).length} driving · {fleet.time.toFixed(1)} / {fleet.duration.toFixed(1)} s · replay {fleet.speed}×</span><progress value={fleet.time} max={fleet.duration}/><Button variant="outline" onClick={() => command({ type: 'skip-replay' })}>Skip this replay</Button></> : <><progress value={stats.batchCount} max={50}/><span>Training stays off-screen. Groups of 50 replay while training continues. Each circuit shows only its own recorded cars; switch circuits to see the others.</span></>}
      <small>Learning across: {stats.trainedTracks.length ? stats.trainedTracks.map(t => TRACKS[t].name).join(' · ') : 'No circuits yet'}. One learner shares experience across the active set.</small>
    </div>
    <output className="training-message">{stats.message}{stats.evaluationCase && <span className="evaluation-case">{stats.evaluationCase}</span>}</output>
    <div className="training-metrics">
      <Metric label="Laps completed" value={`${frame?.completedLaps ?? stats.completedLaps} / ${laps}`}/><Metric label="Checkpoints this lap" value={`${frame?.checkpoints ?? stats.checkpoints} / ${frame?.checkpointCount ?? stats.checkpointCount}`}/>
      <Metric label="Episodes completed" value={stats.episode.toLocaleString()}/><Metric label={frame ? 'Playback score' : 'Current training score'} value={frame ? frame.score.toFixed(0) : stats.currentScore.toFixed(0)}/>
      <Metric label="Best evaluation · mean score" value={sharedScore === undefined ? '—' : sharedScore.toFixed(0)} detail={stats.best ? `Shared model · ${bestResults.length || 1} circuit(s) · episode ${stats.best.episode}` : 'First evaluation after episode 1'}/>
      <Metric label="Training loss" value={stats.loss === null ? '—' : stats.loss.toFixed(5)} detail={`${stats.updates.toLocaleString()} gradient updates`}/>
      <Metric label="Mean training score · last 20" value={stats.mean === null ? '—' : stats.mean.toFixed(0)}/>
      <Metric label="Training race completion" value={stats.completion === null ? '—' : `${(stats.completion * 100).toFixed(1)}%`} detail="Includes exploratory actions"/>
      <Metric label="Exploration" value={`${(stats.epsilon * 100).toFixed(1)}%`}/><Metric label="Replay memory" value={stats.replaySize.toLocaleString()} detail={`${stats.steps.toLocaleString()} decisions collected`}/>
    </div>
    <div className="training-track-results"><h4>Latest evaluation by circuit</h4>{stats.trainingTracks.map(t=>{
      const result=stats.evaluations.find(r=>r.track===t),memory=stats.replayCounts.find(r=>r.track===t);
      return <div key={t}><strong>{TRACKS[t].name}</strong><span>{result ? `${(result.successRate*100).toFixed(0)}% completed · ${(result.meanProgress*100).toFixed(0)}% mean progress` : 'Waiting for evaluation'}</span>{result && <small>{Object.entries(result.runs.reduce<Record<string,number>>((counts,run)=>{counts[run.reason]=(counts[run.reason]??0)+1;return counts;},{})).map(([reason,count])=>`${reason}: ${count}/5`).join(' · ')}</small>}<small>{memory ? `${memory.count.toLocaleString()} experiences retained` : 'Single-track memory'}</small></div>;
    })}</div>
    <p className="model-storage-note">A plateau here is the saved best model, not necessarily the latest learner. Each selected circuit contributes five evaluation attempts. Training scores include exploration; judge driving by completion and failure causes below.</p>
    {stats.validation && <section className="training-track-results" aria-label="Transfer check"><h4>Transfer check · model episode {stats.validation.episode}</h4>{stats.validation.results.map(result=><div key={result.track}><strong>{TRACKS[result.track].name} · {stats.trainingTracks.includes(result.track) ? 'Training track' : 'Held out'}</strong><span>{(result.successRate*100).toFixed(0)}% complete · {(result.meanProgress*100).toFixed(0)}% mean progress</span><small>{result.runs.filter(run=>!run.completed).map(run=>run.reason).join(' · ') || 'All five attempts completed'}</small></div>)}<small>Read-only evaluation. These held-out scores never select or update the model.</small></section>}
    <EvaluationMetrics evaluation={stats.evaluation}/>
    {!stats.trainingTracks.includes(track) && <p className="model-storage-note">This circuit is outside the training set. Run the shared best model here to test transfer; it has no evaluation score for this circuit.</p>}
    {frame && <div className="training-live"><span>{stats.status === 'playing' || stats.status === 'playback-ended' ? 'BEST MODEL' : stats.status === 'evaluating' ? 'EVALUATION · NO EXPLORATION' : 'CURRENT ATTEMPT'}</span><strong>{frame ? ACTION_NAMES[frame.action] : 'Waiting'}</strong><label>Race progress<progress max={1} value={frame?.progress ?? 0}/><b>{((frame?.progress ?? 0) * 100).toFixed(1)}%</b></label></div>}
    <label className="chart-filter">Chart circuit <select aria-label="Chart circuit" value={chartTrack} onChange={e=>setChartTrack(e.target.value)}><option value="all">All training circuits</option>{TRACKS.map((circuit,index)=><option key={index} value={index}>{circuit.name}</option>)}</select></label>
    <div className="training-charts"><TrainingChart title="Score per episode" description="Lime: each attempt. Blue: rolling mean of 20." data={chartData} kind="score"/><TrainingChart title="Learning loss" description="Reward-prediction error; guided training also includes a demonstration loss. Lower loss alone does not mean better driving." data={chartData} kind="loss"/></div>
    <details className="comparison-controls"><summary>Controlled comparison · P1 and P2</summary>
      <p>Use single-track training to run this comparison. Four experiments × seeds 42, 1337, and 2026. Each run starts with random weights, the same training start, the same episode budget, and the same five evaluation poses. Adjacent experiments change one factor. Existing saves are retained; starting a comparison ends the current live run.</p>
      <label>Episodes per run<select value={budget} onChange={e => setBudget(Number(e.target.value))}><option value={100}>100 · short comparison</option><option value={400}>400</option><option value={1000}>1,000 · longer comparison</option></select></label>
      <Button variant="outline" disabled={unavailable || busy || comparing || stats.trainingTracks.length > 1} onClick={() => command({ type: 'compare', episodes: budget })}>Run 12 fresh training runs</Button>
      {comparing && <p>Run {stats.comparisonRun}/12. Use Pause and Resume training above. Fastest is recommended; this may take a while.</p>}
      {report && <ComparisonResults report={report}/>}{reportNotice && <p>{reportNotice}</p>}
    </details>
    <div className="training-explanation"><details><summary>Rewards and inputs in this experiment</summary><dl>
      <div><dt>Finish a lap after all checkpoints</dt><dd>+1,000</dd></div><div><dt>Each checkpoint, once per lap</dt><dd>+{(1000 / stats.checkpointCount).toFixed(2)}</dd></div><div><dt>New forward progress</dt><dd>{rewardConfig.normalizedProgress ? '+750 / full lap' : '+3 / world unit'}</dd></div><div><dt>Extra speed reward</dt><dd>{rewardConfig.speedBonus ? 'Up to +1 / unit' : 'None'}</dd></div><div><dt>Off the road</dt><dd>−50 / second</dd></div><div><dt>Reverse progress</dt><dd>{rewardConfig.normalizedProgress ? '−750 / lap length' : '−3 / world unit'}</dd></div><div><dt>Time passing</dt><dd>−1 / second</dd></div>{stats.preset === 'adaptive' && <div><dt>Overspeed, edge proximity and misalignment</dt><dd>Continuous penalty</dd></div>}<div><dt>Failure or timeout</dt><dd>{stats.preset === 'adaptive' ? '−250' : '−100'}</dd></div>
      </dl><p>52 input slots include the 12 ray distances, speed and controls, relative road position and heading, map headings ahead, and off-road duration. New history inputs expose elapsed time, stalled time, signed progress, progress already rewarded, checkpoint count, relative distance to the next checkpoint, completed-lap fraction, and the requested lap count.</p><p>{rewardConfig.absolutePosition ? 'This comparison stage also uses X/Z and absolute lap-position features.' : 'X/Z and absolute lap-position features are masked to zero. Relative task progress remains available to help predict rewards. Recent net movement, window age and its threshold are included; the full rolling history is not.'} Local waypoint positions, road width and a braking-aware corner-speed estimate help plan turns. This is map-assisted driving, not a sensor-only agent.</p><p>Progress cannot earn points twice. Leaving the road for one second, moving more than three units beyond its edge, moving less than the selected minimum in one second, six seconds without forward progress, or reaching 90 seconds per requested lap ends an attempt. Normal playback starts at the finish line. Varied-start evaluations require a full circuit back to each test’s own starting position.</p>
      {frame && <p className="reward-now">Latest decision: safety {frame.reward.safety.toFixed(1)} · checkpoint {frame.reward.checkpoint.toFixed(1)} · progress {frame.reward.progress.toFixed(1)} · speed {frame.reward.speed.toFixed(1)} · off-road {frame.reward.offroad.toFixed(1)} · reverse {frame.reward.reverse.toFixed(1)} · time {frame.reward.time.toFixed(1)} · finish {frame.reward.finish} · failure {frame.reward.failure}</p>}</details>
      <details><summary>How evaluation and saving work</summary><p>Five fixed starts test the line, lateral and heading offsets, and two other positions around the circuit. Learning and exploration are off throughout evaluation. Best models are ranked by lap completion first, then mean reward across the selected circuits, with equal weight per circuit. Ties prefer better completion on the weakest circuit, then mean score.</p><p>Evaluations run after episode 1 and every 10 episodes. Best-score reports appear every 100 episodes. Evaluation uses the latest learner unless you press Evaluate best. Lap time is the average per lap in completed races; a dash means no completed lap. Off-road time averages all five runs.</p><p>In three-track mode, switching the viewed circuit does not interrupt learning or change its training set. Each selected circuit receives an equal share of replay-memory capacity and sampling probability. Loading a saved model instead starts a separate session with a fresh experience buffer. Refreshing preserves saved weights but not optimizer state or unfinished training.</p></details></div>
    <div className="training-checkpoints"><h4>Every 100 episodes</h4>{stats.milestones.length ? <Table><TableHeader><TableRow><TableHead>Episode</TableHead><TableHead>Best mean score</TableHead><TableHead>Model from</TableHead><TableHead>Eval success</TableHead></TableRow></TableHeader><TableBody>{stats.milestones.slice().reverse().map(m => <TableRow key={m.episode}><TableCell>{m.episode}</TableCell><TableCell>{m.best.toFixed(0)}</TableCell><TableCell>{m.bestEpisode}</TableCell><TableCell>{(m.completion * 100).toFixed(0)}%</TableCell></TableRow>)}</TableBody></Table> : <p>The first report appears after episode 100 and its evaluation.</p>}</div>
    <p className="model-storage-note">Everything runs in this browser. Hiding the tab pauses it. Circuit changes retain weights, optimizer, exploration and experience memory. In three-track mode the view can change without resetting the learner or replay group. Starting a fresh session or loading a saved model resets live experience memory. Best-model playback allows five continuous seconds off-road.</p>
  </>;
}
function EvaluationMetrics({ evaluation }: { evaluation: EvaluationSummary | null }) {
  return <section className="evaluation-metrics" aria-label="Evaluation metrics"><h4>Latest evaluation · five varied starts</h4><div className="training-metrics">
    <Metric label="Evaluation race completion" value={evaluation ? `${(evaluation.successRate * 100).toFixed(0)}%` : '—'} detail="No random actions"/>
    <Metric label="Mean lap time · successes" value={evaluation?.meanLapTime != null ? `${evaluation.meanLapTime.toFixed(2)} s` : '—'}/>
    <Metric label="Mean off-road time · all runs" value={evaluation ? `${evaluation.meanOffroadTime.toFixed(2)} s` : '—'}/>
    <Metric label="Mean race progress" value={evaluation ? `${(evaluation.meanProgress * 100).toFixed(1)}%` : '—'}/>
  </div>{evaluation && <details><summary>Individual evaluation attempts</summary><Table><TableHeader><TableRow><TableHead>Start</TableHead><TableHead>Lap</TableHead><TableHead>Time</TableHead><TableHead>Off-road</TableHead><TableHead>Outcome</TableHead></TableRow></TableHeader><TableBody>{evaluation.runs.map(r => <TableRow key={r.name}><TableCell>{r.name}</TableCell><TableCell>{r.completed ? 'Complete' : `${(r.progress * 100).toFixed(0)}%`}</TableCell><TableCell>{r.completed ? r.time.toFixed(2) + 's' : '—'}</TableCell><TableCell>{r.offroadTime.toFixed(2)}s</TableCell><TableCell>{r.reason}{!r.completed && r.terminalSpeed !== undefined && <small> · speed {r.terminalSpeed.toFixed(1)} · track {((r.terminalArc ?? 0)*100).toFixed(0)}%</small>}</TableCell></TableRow>)}</TableBody></Table></details>}</section>;
}
function ComparisonResults({ report }: { report: ComparisonReport }) {
  const groups = Object.entries(PRESETS).filter(([preset])=>preset!=='adaptive').map(([preset, config]) => {
    const rows = report.rows.filter(r => r.preset === preset), runs = rows.flatMap(r => r.evaluation.runs), laps = runs.filter(r => r.completed);
    return { preset, label: config.label, count: rows.length, success: runs.length ? laps.length / runs.length : null,
      offroad: runs.length ? runs.reduce((sum, r) => sum + r.offroadTime, 0) / runs.length : null,
      lapTime: laps.length ? laps.reduce((sum, r) => sum + r.time, 0) / laps.length / (report.targetLaps ?? 1) : null };
  });
  return <div className="comparison-results"><h4>{report.complete && report.rows.length === 12 ? 'Completed comparison' : 'Partial comparison'} · {TRACKS[report.track].name}</h4><p>{report.budget} episodes per seed · {report.targetLaps ?? 1} laps per attempt. Values use the final learner at the budget, not the best checkpoint. Episode budgets match; decision counts can differ.</p><Table><TableHeader><TableRow><TableHead>Experiment</TableHead><TableHead>Seeds</TableHead><TableHead>Success</TableHead><TableHead>Off-road</TableHead><TableHead>Lap time</TableHead></TableRow></TableHeader><TableBody>{groups.map(g => <TableRow key={g.preset}><TableCell>{g.label}</TableCell><TableCell>{g.count}/3</TableCell><TableCell>{g.success === null ? '—' : `${(g.success * 100).toFixed(0)}%`}</TableCell><TableCell>{g.offroad === null ? '—' : g.offroad.toFixed(2) + 's'}</TableCell><TableCell>{g.lapTime === null ? '—' : g.lapTime.toFixed(2) + 's'}</TableCell></TableRow>)}</TableBody></Table>
  <details><summary>Per-seed results</summary><Table><TableHeader><TableRow><TableHead>Preset / seed</TableHead><TableHead>Decisions</TableHead><TableHead>Success</TableHead><TableHead>Mean score</TableHead></TableRow></TableHeader><TableBody>{report.rows.map(row => <TableRow key={row.preset + row.seed}><TableCell>{row.preset} / {row.seed}</TableCell><TableCell>{row.steps}</TableCell><TableCell>{(row.evaluation.successRate * 100).toFixed(0)}%</TableCell><TableCell>{row.evaluation.meanScore.toFixed(0)}</TableCell></TableRow>)}</TableBody></Table></details><p>Reward scales differ across experiments. Compare completion, off-road time, and successful lap time rather than raw scores. Three seeds and five starts are a small evaluation sample, not a guarantee.</p></div>;
}
function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }
function TrainingChart({ title, description, data, kind }: { title: string; description: string; data: ReturnType<typeof emptyTrainingStats>['history']; kind: 'score' | 'loss' }) {
  return <figure><figcaption><strong>{title}</strong><span>{description}</span></figcaption>{data.length ? <ChartContainer className="rl-chart" config={{ score: { label: 'Score', color: '#daef8c' }, mean: { label: 'Mean / 20', color: '#84dcff' }, loss: { label: 'Loss', color: '#f99557' } }}><LineChart data={data} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}><CartesianGrid vertical={false} stroke="#35463b"/><XAxis dataKey="episode" minTickGap={30} tickLine={false} axisLine={false}/><YAxis width={48} tickLine={false} axisLine={false} tickFormatter={n => Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : Number(n).toFixed(kind === 'loss' ? 2 : 0)}/><ChartTooltip content={<ChartTooltipContent/>}/><Line type="linear" dataKey={kind} stroke={`var(--color-${kind})`} strokeWidth={1.5} dot={false} isAnimationActive={false}/>{kind === 'score' && <Line type="linear" dataKey="mean" stroke="var(--color-mean)" strokeWidth={2} dot={false} isAnimationActive={false}/>}</LineChart></ChartContainer> : <div className="chart-empty">Completed episodes will appear here.</div>}<small>Episode number · latest 300 attempts in this session</small></figure>;
}
