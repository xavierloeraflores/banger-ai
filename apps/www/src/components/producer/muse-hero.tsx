"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@banger/shadcn';
import type { MusicProgram } from '@banger/compiler';
import type { StageView } from '@banger/stage';
import { createHeroChart, HERO_COLORS, HERO_KEYS, HeroRun } from '@/lib/muse-hero';
import { usePlayer } from './use-player';
import { drawHighway } from './muse-highway';
import './muse-hero.css';

type Phase = 'ready' | 'countdown' | 'playing' | 'finished';
const clockLabel = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;

export function MuseHero({ program, fileName, onOpen, disabled }: { program: MusicProgram; fileName: string; onOpen: () => void; disabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <Button ref={trigger} variant="secondary" disabled={disabled} onClick={() => { onOpen(); setOpen(true); dialog.current?.showModal(); }} aria-haspopup="dialog" aria-controls="muse-hero">Muse Hero</Button>
    <dialog id="muse-hero" ref={dialog} className="muse-dialog" aria-label="Muse Hero rhythm game" onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      {open && <HeroGame program={program} fileName={fileName} onClose={() => dialog.current?.close()} />}
    </dialog>
  </>;
}

function HeroGame({ program, fileName, onClose }: { program: MusicProgram; fileName: string; onClose: () => void }) {
  const player = usePlayer(program);
  const { readPerformance, play, stop } = player;
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [track, setTrack] = useState('');
  const [autoplay, setAutoplay] = useState(false);
  const [phase, setPhase] = useState<Phase>('ready');
  const [display, setDisplay] = useState({ score: 0, combo: 0, best: 0, perfect: 0, great: 0, good: 0, miss: 0, held: 0, accuracy: 100, multiplier: 1, time: -3, judgment: '', countdown: 3 });
  const chart = useMemo(() => createHeroChart(program, track), [program, track]);
  const run = useRef(new HeroRun(chart));
  const mode = useRef<Phase>('ready');
  const pressed = useRef(new Set<number>());
  const countdownStart = useRef(0);
  const currentTime = useRef(-3);
  const auto = useRef(false);
  const startPending = useRef(false);
  const request = useRef(0);
  const setMode = useCallback((next: Phase) => { mode.current = next; setPhase(next); }, []);

  useEffect(() => {
    let cancelled = false;
    let stage: StageView | undefined;
    void import('@banger/stage').then(({ createStage }) => {
      if (cancelled || !viewport.current) return;
      stage = createStage(viewport.current, { readPerformance, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, onError: setStageError });
    }).catch(error => { if (!cancelled) setStageError(error instanceof Error ? error.message : 'The band could not load.'); });
    return () => { cancelled = true; stage?.dispose(); };
  }, [readPerformance]);

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
      if (canvas.current) drawHighway(canvas.current, run.current, time, pressed.current, program.tempo);
      if (now - lastDisplay > 40) {
        lastDisplay = now;
        const game = run.current;
        setDisplay({ ...game.stats, accuracy: game.accuracy, multiplier: game.multiplier, time, judgment: time - game.judgmentAt < .65 ? game.judgment : '', countdown: Math.max(1, Math.ceil(-time)) });
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [play, readPerformance, stop, program.tempo, setMode]);

  const inputTime = useCallback(() => {
    const state = readPerformance().state;
    return mode.current === 'playing' ? (Math.max(1, state.bar) - 1 + state.phase) * 240 / program.tempo : currentTime.current;
  }, [program.tempo, readPerformance]);
  const press = useCallback((lane: number) => {
    if (pressed.current.has(lane) || mode.current !== 'playing' || auto.current) return;
    pressed.current.add(lane); run.current.hit(lane, inputTime());
  }, [inputTime]);
  const release = useCallback((lane: number) => {
    pressed.current.delete(lane);
    if (mode.current === 'playing' && !auto.current) run.current.release(lane, inputTime());
  }, [inputTime]);
  const end = useCallback(() => { request.current++; stop(); pressed.current.clear(); setMode('finished'); }, [setMode, stop]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) return;
      const lane = HERO_KEYS.indexOf(event.code);
      if (lane >= 0) { event.preventDefault(); if (!event.repeat) press(lane); }
    };
    const up = (event: KeyboardEvent) => { const lane = HERO_KEYS.indexOf(event.code); if (lane >= 0) release(lane); };
    const blur = () => { if (mode.current === 'playing' || mode.current === 'countdown') end(); };
    const hidden = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); };
  }, [press, release, end]);

  function start() {
    request.current++; stop(); run.current = new HeroRun(chart); pressed.current.clear();
    auto.current = autoplay; currentTime.current = -3; countdownStart.current = performance.now(); startPending.current = false; setMode('countdown');
  }
  const active = phase === 'playing' || phase === 'countdown';
  const progress = Math.min(100, Math.max(0, display.time / chart.duration * 100));
  const title = fileName.replace(/\.banger$/i, '').replaceAll('-', ' ');
  return <div className="muse-game" data-phase={phase} data-score={display.score} data-time={display.time.toFixed(3)}>
    <div className="muse-stage" ref={viewport} aria-hidden="true" />
    <div className="muse-vignette" />
    <canvas ref={canvas} className="muse-highway" aria-label="Five fret lanes. Press A, S, D, F or G as notes reach the glowing line. Hold long notes until their tails finish." />
    <header className="muse-heading">
      <h1><span className="muse-mark">m</span> muse<span>hero</span><small>YOUR MUSIC. YOUR STAGE.</small></h1>
      <div className="muse-song"><span>{active ? autoplay ? 'PRACTICE AUTOPLAY' : 'ON STAGE' : 'LOADED FROM .BANGER'}</span><strong>{title}</strong><small>{program.tempo} BPM <i /> {program.tracks.length} tracks <i /> {clockLabel(chart.duration)}</small></div>
      <button className="muse-exit" onClick={onClose} aria-label="Close Muse Hero">Back to studio <kbd>esc</kbd></button>
    </header>
    <div className="muse-score muse-glass"><span>SCORE</span><strong>{display.score.toLocaleString().padStart(6, '0')}</strong><small>{autoplay ? 'PRACTICE RUN' : `${chart.notes.length} NOTES IN YOUR CHART`}</small></div>
    <div className="muse-energy"><div className="muse-stars" aria-label={`${Math.min(5, Math.floor(progress / 20 * display.accuracy / 100))} of 5 stars`}>{Array.from({ length: 5 }, (_, index) => <span key={index} className={progress / 20 * display.accuracy / 100 >= index + 1 ? 'earned' : ''}>★</span>)}</div><div className="muse-progress" role="progressbar" aria-label="Song progress" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div><small>{clockLabel(display.time)} <span>/ {clockLabel(chart.duration)}</span></small></div>
    <div className="muse-combo"><div><span>COMBO</span><strong>{display.combo}<small> streak</small></strong></div><b>×{display.multiplier}</b></div>
    {phase === 'countdown' && <div className="muse-countdown" role="status"><strong>{display.countdown}</strong><span>GET READY</span></div>}
    {phase === 'playing' && display.judgment && <div className={`muse-judgment ${display.judgment === 'Miss' || display.judgment === 'Hold lost' ? 'miss' : ''}`}>{display.judgment}<small>{display.combo > 1 ? `${display.combo} NOTE STREAK` : 'KEEP THE RHYTHM'}</small></div>}
    {!active && <section className="muse-menu muse-glass" aria-label={phase === 'finished' ? 'Run results' : 'Game setup'}>
      <span className="muse-eyebrow">{phase === 'finished' ? display.time >= chart.duration ? 'SET COMPLETE' : 'RUN ENDED' : 'STEP INTO THE SPOTLIGHT'}</span>
      <h2>{phase === 'finished' ? 'Your encore awaits.' : 'Play your banger.'}</h2>
      <p>{phase === 'finished' ? `${display.accuracy.toFixed(1)}% accuracy · ${display.best} best streak · ${display.held} holds` : 'Hit the glowing line. Hold the long notes. Find your rhythm.'}</p>
      <label className="muse-track-label">Chart <select aria-label="Muse Hero chart" value={track} onChange={event => { setTrack(event.target.value); setMode('ready'); }}><option value="">Full band</option>{program.tracks.map(track => <option key={track.name} value={track.name}>{track.name}</option>)}</select></label>
      <label className="muse-autoplay"><input type="checkbox" checked={autoplay} onChange={event => setAutoplay(event.target.checked)} /> Practice autoplay</label>
      <button className="muse-start" onClick={start} disabled={!chart.notes.length || player.starting}>{player.starting ? 'Starting audio…' : phase === 'finished' ? 'Play again' : 'Take the stage'} <span>↗</span></button>
      {!chart.notes.length && <p role="status">No audible notes in this chart. Choose another track or unmute tracks in the studio.</p>}
    </section>}
    <div className="muse-frets" aria-label="Fret controls">{HERO_KEYS.map((key, lane) => <button key={key} style={{ '--fret': HERO_COLORS[lane] } as CSSProperties} aria-label={`Fret ${lane + 1}, ${key.slice(-1)}`} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.repeat) press(lane); } }} onKeyUp={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); release(lane); } }} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); press(lane); }} onPointerUp={() => release(lane)} onPointerCancel={() => release(lane)} onLostPointerCapture={() => release(lane)}><kbd>{key.slice(-1)}</kbd></button>)}</div>
    <footer className="muse-footer"><span>HIT <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><kbd>G</kbd> <i /> HOLD FOR SUSTAINS</span>{active && <button onClick={end}>End run</button>}<span className="muse-footer-right">{autoplay ? 'AUTOPLAY' : 'FIVE FRETS. ONE BAND.'}</span></footer>
    <aside className="muse-stats muse-glass" aria-label="Performance"><span>PERFORMANCE <b>{display.accuracy.toFixed(1)}%</b></span>{(['perfect', 'great', 'good', 'miss'] as const).map(label => <div key={label} className={label}><span>{label}</span><b>{display[label]}</b></div>)}</aside>
    {(player.error || stageError) && <p className="muse-error" role="alert">{player.error || `Band view unavailable. You can still play. ${stageError}`}</p>}
  </div>;
}
