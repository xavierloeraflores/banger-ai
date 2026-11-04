"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@banger/shadcn";
import type { MusicProgram } from "@banger/compiler";
import { MuseHero } from "./muse-hero";
import type { PerformanceSnapshot, StageView } from "@banger/stage";
import "./performance-stage.css";

interface Props {
  program: MusicProgram;
  fileName: string;
  heroDisabled: boolean;
  stopGame: () => void;
  readPerformance: () => PerformanceSnapshot;
  playing: boolean;
  starting: boolean;
  tempo: number;
  tracks: number;
  error: string | null;
  onPlay: () => Promise<void>;
  onStop: () => void;
}
export function PerformanceStage({ program, fileName, heroDisabled, stopGame, readPerformance, playing, starting, tempo, tracks, error, onPlay, onStop }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<StageView | null>(null);
  const heroTrigger = useRef<HTMLButtonElement>(null);
  const [hero, setHero] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [failure, setFailure] = useState<string | null>(null);
  const [still, setStill] = useState(false);
  const [manualCamera, setManualCamera] = useState(false);
  const manualCameraRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reducedMotion = still || media.matches;
    void import("@banger/stage").then(({ createStage }) => {
      if (cancelled || !viewport.current) return;
      stage.current = createStage(viewport.current, { readPerformance, reducedMotion, onError: message => {
        setFailure(message); setStatus("error");
      } });
      stage.current.setManualCamera(manualCameraRef.current);
      setStatus("ready");
    }).catch(cause => {
      if (cancelled) return;
      setFailure(cause instanceof Error ? cause.message : "The 3D view could not start.");
      setStatus("error");
    });
    return () => { cancelled = true; stage.current?.dispose(); stage.current = null; };
  }, [open, readPerformance, still]);

  function hideHero() {
    setHero(false);
    requestAnimationFrame(() => heroTrigger.current?.focus());
  }
  function toggleCamera() {
    const manual = !manualCameraRef.current;
    manualCameraRef.current = manual; setManualCamera(manual);
    stage.current?.setManualCamera(manual);
  }
  function show() {
    manualCameraRef.current = false; setManualCamera(false);
    setFailure(null); setStatus("loading"); setOpen(true); dialog.current?.showModal();
  }
  return <>
    <Button ref={trigger} variant="secondary" onClick={show} aria-haspopup="dialog" aria-controls="performance-stage">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 3 9 5v8l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v8" /></svg>
      Band stage
    </Button>
    <dialog ref={dialog} id="performance-stage" className={`performance-dialog${hero ? " performance-with-hero" : ""}`} aria-labelledby="performance-title" aria-describedby="performance-description" onCancel={event => { if (hero) { event.preventDefault(); hideHero(); } }} onClose={() => { setHero(false); setOpen(false); trigger.current?.focus(); }}>
      <header className="performance-heading" hidden={hero}>
        <div><span className="performance-eyebrow">BANGER / LIVE ROOM</span><h2 id="performance-title">Meet your band<span className={playing ? "performance-live playing" : "performance-live"}>{playing ? "LIVE" : "READY"}</span></h2><p id="performance-description">One little performer for every track. Your music brings them to life.</p></div>
        <Button variant="secondary" onClick={() => dialog.current?.close()} aria-label="Close band stage">Close <span aria-hidden="true">×</span></Button>
      </header>
      <div className="performance-viewport" ref={viewport}>
        {open && status === "loading" && <div className="performance-overlay" role="status">Getting the band together…</div>}
        {open && status === "error" && <div className="performance-overlay" role="alert"><strong>Couldn’t open the stage</strong><p>{failure}</p><p>Close and reopen to retry. The studio is still available.</p></div>}
        {open && tracks === 0 && status === "ready" && <div className="performance-overlay">Add a track to meet your first performer.</div>}
        {!hero && <div id="performance-camera-help" className="performance-camera-hint">{manualCamera ? "Drag to orbit · Right-drag to pan · Scroll or pinch to zoom" : still ? "Camera paused in still mode" : "Automatic camera · Take control to explore"}</div>}
      </div>
      {open && hero && <MuseHero program={program} fileName={fileName} readPerformance={readPerformance} play={onPlay} stop={stopGame} starting={starting} error={error} onPrepare={onStop} onClose={hideHero} />}
      <Button ref={heroTrigger} className="performance-hero-trigger" variant="secondary" hidden={hero} disabled={heroDisabled || status !== "ready" || tracks === 0} aria-expanded={hero} aria-controls="muse-hero" onClick={() => setHero(true)}>Muse Hero <span aria-hidden="true">↗</span></Button>
      <footer className="performance-footer" hidden={hero}>
        <div className="performance-transport"><Button variant="primary" onClick={() => void onPlay()} disabled={playing || starting || status !== "ready" || tracks === 0}>{starting ? "Starting…" : playing ? "Playing" : "Play band"}</Button><Button variant="secondary" onClick={onStop} disabled={!playing && !starting}>Stop</Button><span>{tempo} BPM<span className="performance-divider">/</span>{tracks} {tracks === 1 ? "performer" : "performers"}</span></div>
        <div className="performance-options"><div className="performance-camera-controls" role="group" aria-label="Camera controls">
          <Button variant="secondary" disabled={status !== "ready"} aria-pressed={manualCamera} aria-describedby="performance-camera-help" onClick={toggleCamera}>{manualCamera ? "Auto camera" : "Take control"}</Button>
          {manualCamera && <><Button variant="secondary" aria-label="Zoom in" disabled={status !== "ready"} onClick={() => stage.current?.zoomCamera(.85)}>+</Button><Button variant="secondary" aria-label="Zoom out" disabled={status !== "ready"} onClick={() => stage.current?.zoomCamera(1 / .85)}>−</Button></>}
          <Button variant="secondary" disabled={status !== "ready"} onClick={() => stage.current?.resetCamera()}>Reset view</Button>
        </div><label><input type="checkbox" checked={still} onChange={event => setStill(event.target.checked)} /> Still mode</label></div>
      </footer>
      {error && !hero && <p className="performance-error" role="alert">{error}</p>}
    </dialog>
  </>;
}
