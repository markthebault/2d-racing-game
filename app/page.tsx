'use client';

import { useEffect, useRef, useState } from 'react';
import { Flag, ArrowUpRight, RotateCcw, Pause, Play, ChevronLeft, ChevronRight, Trophy, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TRACKS, trackCurve, trackBounds, formatTime } from '@/lib/race';
import { RaceEngine, type RaceStats } from '@/lib/engine';
import { SensorDebug } from '@/components/sensor-debug';
import { TrainingLab } from '@/components/training-lab';
import { vehicleTelemetry } from '@/lib/telemetry';
import type { FleetFrame } from '@/lib/rl/batch';

const TRACK_PREVIEWS = TRACKS.map((_, index) => {
  const points = trackCurve(index).getPoints(240);
  const bounds = trackBounds(points, 8);
  return {
    viewBox: [bounds.minX, bounds.minZ, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ].join(' '),
    path: points.map((point, i) => (i ? 'L' : 'M') + point.x + ',' + point.z).join(' ') + ' Z',
  };
});

export default function Home() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<RaceEngine | null>(null);
  const [learning, setLearning] = useState(false);
  const [fleet, setFleet] = useState<FleetFrame | null>(null);
  const [singlePlayback, setSinglePlayback] = useState(false);
  const fleetUiTime = useRef(0);
  const [track, setTrack] = useState(0);
  const [laps, setLaps] = useState(3);
  const [error,setError] = useState('');
  const [showRays,setShowRays] = useState(true);
  const [debugOpen,setDebugOpen] = useState(true);
  const [stats,setStats] = useState<RaceStats>({status:'ready',speed:0,lap:0,time:0,best:0,countdown:3,offroad:false,rays:[],vehicle:vehicleTelemetry()});
  useEffect(() => {
    if (!host.current) return;
    try { engine.current = new RaceEngine(host.current, track, laps, setStats); engine.current.setExternal(learning); }
    catch { setError('The game needs WebGL. Try a browser with hardware acceleration enabled.'); }
    return () => { engine.current?.dispose(); engine.current=null; };
  },[track,laps,learning]);
  useEffect(() => { engine.current?.setRaysVisible(showRays); },[showRays,track,laps,learning]);
  const running = stats.status !== 'ready' && stats.status !== 'finished';
  return <main className={"app-shell" + (debugOpen ? " debug-open" : "") + (learning ? " learning-mode" : "")}>
    <header className="topbar"><a className="brand" href="/" aria-label="Pocket Circuit home"><span className="brand-mark"><Flag size={21}/></span>POCKET<span>CIRCUIT</span><sup>01</sup></a><div className="top-note"><span className="live-dot"/> SINGLE PLAYER <span className="divider">/</span> TIME ATTACK</div></header>
    <div className="workspace">
      <aside className="setup">
        <div className="eyebrow">THE PADDOCK</div><h1>Small car.<br/>Big lap energy.</h1>
        <p className="intro">Pick your circuit. Find your line.</p>
        <div className="driver-mode" role="group" aria-label="Driver mode"><Button variant="ghost" aria-pressed={!learning} onClick={()=>setLearning(false)}>Manual drive</Button><Button variant="ghost" aria-pressed={learning} onClick={()=>{setLearning(true);setDebugOpen(false);}}>Train AI</Button></div>
        <div className="section-label"><span>01 / SELECT CIRCUIT</span><span>3 TRACKS</span></div>
        <div className="tracks">{TRACKS.map((t,i) => <Button key={t.name} variant="ghost" disabled={running&&!learning} className={`track-option ${track===i?'selected':''}`} onClick={()=>setTrack(i)} aria-pressed={track===i}>
          <svg className="track-map" viewBox={TRACK_PREVIEWS[i].viewBox} aria-hidden="true"><path d={TRACK_PREVIEWS[i].path} fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round"/></svg>
          <span className="track-copy"><strong>{t.name}</strong><small>{t.kind}</small></span><span className="selection-dot"/>
        </Button>)}</div>
        <p className="track-description">{TRACKS[track].description}</p>
        <div className="section-label"><label htmlFor="lap-count">02 / RACE DISTANCE</label></div>
        <div className="lap-picker"><Button variant="ghost" size="icon" aria-label="Fewer laps" disabled={(!learning&&running)||laps===1} onClick={()=>setLaps(laps-1)}><ChevronLeft/></Button><div><input id="lap-count" aria-label="Number of laps" type="number" min="1" max="10" value={laps} disabled={!learning&&running} onChange={e=>setLaps(Math.min(10,Math.max(1,Math.floor(Number(e.target.value)||1))))}/><span>{laps===1?'lap':'laps'}</span></div><Button variant="ghost" size="icon" aria-label="More laps" disabled={(!learning&&running)||laps===10} onClick={()=>setLaps(laps+1)}><ChevronRight/></Button></div>
        <Button className="start-button" disabled={learning||running||!!error} onClick={()=>engine.current?.start()}>{learning?'Use training controls':stats.status==='finished'?'Race again':'Start race'}<ArrowUpRight size={22}/></Button>
        <div className="controls"><div className="section-label"><span><Keyboard size={15}/> DRIVER CONTROLS</span></div><div><span><kbd>↑</kbd> Accelerate</span><span><kbd>↓</kbd> Brake / reverse</span></div><div><span><kbd>←</kbd><kbd>→</kbd> Steer</span><span><kbd>Esc</kbd> Pause</span></div><p><kbd>R</kbd> Return to track</p></div>
      </aside>
      <section className="race-panel" aria-label="Race track">
        <div className="race-heading"><div><span className="eyebrow">CIRCUIT 0{track+1}</span><h2>{TRACKS[track].name}</h2></div><span className="mode-tag">{learning?'AI DRIVING LAB':stats.status==='ready'?'READY TO RACE':stats.status==='finished'?'CHECKERED FLAG':'TIME ATTACK'}</span></div>
        <div className="game-view"><div ref={host} className="canvas-host"/>
          {(!learning || singlePlayback) && <div className="hud"><div><small>LAP</small><strong>{Math.min(stats.lap+1,laps)}<em> / {laps}</em></strong></div><div><small>RACE TIME</small><strong>{formatTime(stats.time)}</strong></div><div><small>BEST LAP</small><strong>{stats.best?formatTime(stats.best):'--:--.--'}</strong></div></div>}
          {learning&&!singlePlayback&&<div className="fleet-caption">{fleet&&fleet.track===track ? `EPISODES ${fleet.first}–${fleet.last} · ${fleet.poses.filter(p=>!p.done).length}/50 DRIVING · ${fleet.time.toFixed(1)} s · ${fleet.speed}× REPLAY` : 'LEARNING LAB · Cars appear together after each group of 50 attempts'}</div>}
          {!learning&&stats.status==='ready'&&<div className="ready-label"><span className="live-dot"/> ON THE GRID <small>Choose your laps, then start your engine.</small></div>}
          {!learning&&stats.status==='countdown'&&<div className="countdown" aria-live="assertive">{stats.countdown}</div>}
          {!learning&&stats.status==='paused'&&<div className="game-overlay"><h3>Taking a pit stop.</h3><Button className="start-button" onClick={()=>engine.current?.togglePause()}><Play/> Resume race</Button></div>}
          {!learning&&stats.status==='finished'&&<div className="game-overlay"><Trophy size={36}/><span className="eyebrow">RACE COMPLETE</span><h3>Across the line.</h3><strong className="result-time">{formatTime(stats.time)}</strong><p>{laps} {laps===1?'lap':'laps'} · Best {formatTime(stats.best)}</p><Button className="start-button" onClick={()=>engine.current?.start()}>Race again <RotateCcw/></Button></div>}
          {error&&<div className="game-overlay" role="alert"><h3>Couldn't start the engine.</h3><p>{error}</p></div>}
          {(!learning||singlePlayback)&&<div className="track-bottom"><span>{stats.offroad?'OFF ROAD · LOW GRIP':'ASPHALT · DRY'}</span><div className="speed"><strong>{Math.round(Math.abs(stats.speed)*5)}</strong><small>KM/H</small></div></div>}
          <div hidden={learning} className={learning?"ai-hidden":"touch-controls"} aria-label="Touch driving controls">{[['ArrowLeft','←'],['ArrowRight','→'],['ArrowDown','↓'],['ArrowUp','↑']].map(([key,label])=><button key={key} aria-label={key} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);engine.current?.setKey(key,true);}} onPointerUp={()=>engine.current?.setKey(key,false)} onPointerCancel={()=>engine.current?.setKey(key,false)}>{label}</button>)}</div>
        </div>
        <div className="race-footer"><span><span className="car-dot"/> {learning?'AI / CAR 01':'YOU / CAR 01'} <span className="footer-hint">Follow the track clockwise.</span></span><div><Button variant="ghost" disabled={learning} onClick={()=>engine.current?.reset()} aria-label="Reset race"><RotateCcw size={15}/> Reset</Button><Button variant="ghost" disabled={learning||!running||stats.status==='countdown'} onClick={()=>engine.current?.togglePause()}><Pause size={15}/>{stats.status==='paused'?'Resume':'Pause'}</Button></div></div>
        {learning&&<TrainingLab track={track} laps={laps} onFrame={frame=>{setSinglePlayback(true);engine.current?.showAgent(frame);}} onFleet={frame=>{if(!frame||frame.time===0||performance.now()-fleetUiTime.current>150){setSinglePlayback(false);setFleet(frame);fleetUiTime.current=performance.now();}engine.current?.showFleet(frame);}}/>}
      </section>
    </div>
    <SensorDebug readings={stats.rays} vehicle={stats.vehicle} visible={showRays} onToggle={()=>setShowRays(value=>!value)} open={debugOpen} onOpenChange={setDebugOpen}/>
    <footer className="page-footer"><span>POCKET CIRCUIT</span><span>Just you, the road, and the clock.</span><span>BUILT FOR THE ARROW KEYS</span></footer>
  </main>;
}
