"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { MusicProgram } from '@banger/compiler';
import type { PerformanceSnapshot } from '@banger/stage';
import { createHeroChart, HERO_COLORS, HERO_KEYS, HeroRun } from '@/lib/muse-hero';
import { HERO_DIFFICULTIES, useHeroDifficulty } from '@/lib/muse-hero-settings';
import { drawHighway } from './muse-highway';
import './muse-hero.css';

type Phase = 'ready' | 'countdown' | 'playing' | 'finished';
const clockLabel = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;

interface Props {
  program: MusicProgram;
  fileName: string;
  readPerformance: () => PerformanceSnapshot;
  play: () => Promise<void>;
  stop: () => void;
  starting: boolean;
  error: string | null;
  onPrepare: () => void;
  onClose: () => void;
}

/** Game overlay for the existing stage and audio transport. */
export function MuseHero(props: Props) {
  const difficulty = useHeroDifficulty();
  const laneCount = HERO_DIFFICULTIES.find(option => option.value === difficulty)!.lanes;
  return <MuseHeroGame key={difficulty} {...props} laneCount={laneCount} />;
}

function MuseHeroGame({ program, fileName, readPerformance, play, stop, starting, error, onPrepare, onClose, laneCount }: Props & { laneCount: 2 | 3 | 4 | 5 }) {
  const keys = HERO_KEYS.slice(0, laneCount);
  const backButton = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [track, setTrack] = useState('');
  const [autoplay, setAutoplay] = useState(false);
  const [phase, setPhase] = useState<Phase>('ready');
  const [display, setDisplay] = useState({ score: 0, combo: 0, best: 0, perfect: 0, great: 0, good: 0, miss: 0, held: 0, accuracy: 100, multiplier: 1, time: -3, judgment: '', countdown: 3 });
  const chart = useMemo(() => createHeroChart(program, track, laneCount), [program, track, laneCount]);
  const run = useRef(new HeroRun(chart));
  const mode = useRef<Phase>('ready');
  const pressed = useRef(new Set<number>());
  const countdownStart = useRef(0);
  const currentTime = useRef(-3);
  const auto = useRef(false);
  const startPending = useRef(false);
  const request = useRef(0);
  const setMode = useCallback((next: Phase) => { mode.current = next; setPhase(next); }, []);

  useEffect(() => { backButton.current?.focus(); }, []);

  useEffect(() => () => {
    request.current++;
    if (mode.current !== 'ready') stop();
  }, [stop]);

  useEffect(() => {
    let frame = 0;
    let lastDisplay = 0;
    let cancelled = false;
    function tick(now: number) {
      let time = currentTime.current;
      if (mode.current === 'countdown') {
        time = Math.min(0, (now - countdownStart.current) / 1000 - 3);
        if (time >= 0 && !startPending.current) {
          startPending.current = true;
          const id = request.current;
          void play().then(() => {
            if (!cancelled && id === request.current) {
              startPending.current = false;
              setMode(readPerformance().state.playing ? 'playing' : 'ready');
            }
          });
        }
      }
      if (mode.current === 'playing') {
        const state = readPerformance().state;
        // Use the audio clock, not accumulated animation frames, to judge every hit.
        time = (Math.max(1, state.bar) - 1 + state.phase) * 240 / program.tempo;
        run.current.advance(time, auto.current);
        if (time >= run.current.chart.duration + .2) { stop(); pressed.current.clear(); setMode('finished'); }
      }
      currentTime.current = time;
      if (canvas.current) drawHighway(canvas.current, run.current, time, pressed.current, program.tempo, laneCount);
      if (now - lastDisplay > 40) {
        lastDisplay = now;
        const game = run.current;
        setDisplay({ ...game.stats, accuracy: game.accuracy, multiplier: game.multiplier, time, judgment: time - game.judgmentAt < .65 ? game.judgment : '', countdown: Math.max(1, Math.ceil(-time)) });
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [play, readPerformance, stop, program.tempo, setMode, laneCount]);

  const inputTime = useCallback(() => {
    const state = readPerformance().state;
    return mode.current === 'playing' ? (Math.max(1, state.bar) - 1 + state.phase) * 240 / program.tempo : currentTime.current;
  }, [program.tempo, readPerformance]);
  const press = useCallback((lane: number) => {
    if (pressed.current.has(lane) || (mode.current !== 'playing' && mode.current !== 'countdown') || auto.current) return;
    pressed.current.add(lane); run.current.hit(lane, inputTime());
  }, [inputTime]);
  const release = useCallback((lane: number) => {
    pressed.current.delete(lane);
    if ((mode.current === 'playing' || mode.current === 'countdown') && !auto.current) run.current.release(lane, inputTime());
  }, [inputTime]);
  const end = useCallback(() => { request.current++; stop(); pressed.current.clear(); setMode('finished'); }, [setMode, stop]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) return;
      const lane = HERO_KEYS.indexOf(event.code);
      if (lane >= 0 && lane < laneCount) { event.preventDefault(); if (!event.repeat) press(lane); }
    };
    const up = (event: KeyboardEvent) => { const lane = HERO_KEYS.indexOf(event.code); if (lane >= 0 && lane < laneCount) release(lane); };
    const blur = () => { if (mode.current === 'playing' || mode.current === 'countdown') end(); };
    const hidden = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); };
  }, [press, release, end, laneCount]);

  function start() {
    request.current++; onPrepare(); run.current = new HeroRun(chart); pressed.current.clear();
    auto.current = autoplay; currentTime.current = -3; countdownStart.current = performance.now(); startPending.current = false; setMode('countdown');
  }
  const active = phase === 'playing' || phase === 'countdown';
  const progress = Math.min(100, Math.max(0, display.time / chart.duration * 100));
  const title = fileName.replace(/\.banger$/i, '').replaceAll('-', ' ');
  return <div id="muse-hero" className="muse-game" role="region" aria-label="Muse Hero rhythm game" data-phase={phase} data-score={display.score} data-time={display.time.toFixed(3)}>
    <div className="muse-vignette" />
    <canvas ref={canvas} className="muse-highway" aria-label={`${laneCount} fret lanes. Press ${keys.map(key => key.slice(-1)).join(', ')} as notes reach the glowing line. Hold long notes until their tails finish.`} />
    <header className="muse-heading">
      {active && <div className="muse-song"><span>{autoplay ? 'PRACTICE AUTOPLAY' : 'ON STAGE'}</span><strong>{title}</strong><small>{program.tempo} BPM <i /> {program.tracks.length} tracks <i /> {clockLabel(chart.duration)}</small></div>}
      <button ref={backButton} className="muse-exit" onClick={onClose} aria-label="Hide Muse Hero">Back to band <kbd>esc</kbd></button>
    </header>
    <div className="muse-score muse-glass"><span>SCORE</span><strong>{display.score.toLocaleString().padStart(6, '0')}</strong><small>{autoplay ? 'PRACTICE RUN' : `${chart.notes.length} NOTES IN YOUR CHART`}</small></div>
    <div className="muse-energy"><div className="muse-stars" aria-label={`${Math.min(5, Math.floor(progress / 20 * display.accuracy / 100))} of 5 stars`}>{Array.from({ length: 5 }, (_, index) => <span key={index} className={progress / 20 * display.accuracy / 100 >= index + 1 ? 'earned' : ''}>★</span>)}</div><div className="muse-progress" role="progressbar" aria-label="Song progress" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div><small>{clockLabel(display.time)} <span>/ {clockLabel(chart.duration)}</span></small></div>
    {phase === 'playing' && <div className="muse-combo"><div><span>COMBO</span><strong>{display.combo}<small> streak</small></strong></div><b>×{display.multiplier}</b></div>}
    {phase === 'countdown' && <div className="muse-countdown" role="status"><strong>{display.countdown}</strong><span>GET READY</span></div>}
    {phase === 'playing' && display.judgment && <div className={`muse-judgment ${display.judgment === 'Miss' || display.judgment === 'Hold lost' ? 'miss' : ''}`}>{display.judgment}{display.combo > 1 && <small>{display.combo} NOTE STREAK</small>}</div>}
    {!active && <section className="muse-menu muse-glass" aria-label={phase === 'finished' ? 'Run results' : 'Game setup'}>
      <span className="muse-eyebrow">{phase === 'finished' ? display.time >= chart.duration ? 'SET COMPLETE' : 'RUN ENDED' : 'STEP INTO THE SPOTLIGHT'}</span>
      <h2>{phase === 'finished' ? 'Your encore awaits.' : 'Play your banger.'}</h2>
      <p>{phase === 'finished' ? `${display.accuracy.toFixed(1)}% accuracy · ${display.best} best streak · ${display.held} holds` : 'Hit the glowing line. Hold the long notes. Find your rhythm.'}</p>
      <label className="muse-track-label">Chart <select aria-label="Muse Hero chart" value={track} onChange={event => { setTrack(event.target.value); setMode('ready'); }}><option value="">Full band</option>{program.tracks.map(track => <option key={track.name} value={track.name}>{track.name}</option>)}</select></label>
      <label className="muse-autoplay"><input type="checkbox" checked={autoplay} onChange={event => setAutoplay(event.target.checked)} /> Practice autoplay</label>
      <button className="muse-start" onClick={start} disabled={!chart.notes.length || starting}>{starting ? 'Starting audio…' : phase === 'finished' ? 'Play again' : 'Take the stage'} <span>↗</span></button>
      {!chart.notes.length && <p role="status">No audible notes in this chart. Choose another track or unmute tracks in the studio.</p>}
    </section>}
    <div className="muse-frets" style={{ '--lane-count': laneCount } as CSSProperties} aria-label="Fret controls">{keys.map((key, lane) => <button key={key} style={{ '--fret': HERO_COLORS[lane] } as CSSProperties} aria-label={`Fret ${lane + 1}, ${key.slice(-1)}`} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.repeat) press(lane); } }} onKeyUp={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); release(lane); } }} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); press(lane); }} onPointerUp={() => release(lane)} onPointerCancel={() => release(lane)} onLostPointerCapture={() => release(lane)}><kbd>{key.slice(-1)}</kbd></button>)}</div>
    {active && <footer className="muse-footer"><button onClick={end}>End run</button></footer>}
    <aside className="muse-stats muse-glass" aria-label="Performance"><span>PERFORMANCE <b>{display.accuracy.toFixed(1)}%</b></span>{(['perfect', 'great', 'good', 'miss'] as const).map(label => <div key={label} className={label}><span>{label}</span><b>{display[label]}</b></div>)}</aside>
    {error && <p className="muse-error" role="alert">{error}</p>}
  </div>;
}
