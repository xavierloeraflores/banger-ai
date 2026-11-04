"use client";

import { forwardRef, useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { Button } from "@banger/shadcn";
import type { MusicProgram } from "@banger/compiler";
import { MuseHero } from "./muse-hero";
import type { PerformanceSnapshot, StageView } from "@banger/stage";
import "./performance-stage.css";

export const BandStageButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof Button>>(function BandStageButton(props, ref) {
  return <Button {...props} ref={ref} className="performance-stage-trigger" variant="secondary" aria-haspopup="dialog" aria-controls="performance-stage">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 3 9 5v8l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v8" /></svg>
    Band stage
  </Button>;
});

interface Props {
  duration?: number;
  onOpen?: () => void;
  onClose?: () => void;
  program: MusicProgram;
  fileName: string;
  heroDisabled: boolean;
  readPerformance: () => PerformanceSnapshot;
  playing: boolean;
  starting: boolean;
  tempo: number;
  tracks: number;
  error: string | null;
  onPlay: () => Promise<void>;
  onStop: () => void;
}
export function PerformanceStage({ duration, onOpen, onClose, program, fileName, heroDisabled, readPerformance, playing, starting, tempo, tracks, error, onPlay, onStop }: Props) {
  const singer = Boolean(readPerformance().vocals);
  const performers = tracks + (singer ? 1 : 0);
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
  const [showLabels, setShowLabels] = useState(false);
  const showLabelsRef = useRef(false);
  const [manualCamera, setManualCamera] = useState(false);
  const manualCameraRef = useRef(false);
  const autoplayAttempted = useRef(false);
  const controls = useRef<HTMLDivElement>(null);
  const controlsTrigger = useRef<HTMLButtonElement>(null);
  const [controlsOpen, setControlsOpen] = useState(false);

  // Each opening gets one attempt; stopping or rebuilding the camera must stay stopped.
  useEffect(() => {
    if (!open || status !== "ready" || performers === 0 || autoplayAttempted.current) return;
    autoplayAttempted.current = true;
    if (!playing && !starting) void onPlay();
  }, [open, status, performers, playing, starting, onPlay]);

  useEffect(() => {
    if (!controlsOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !controls.current?.contains(event.target)) setControlsOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [controlsOpen]);

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
      stage.current.setLabelsVisible(showLabelsRef.current);
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
  function toggleLabels(visible: boolean) {
    showLabelsRef.current = visible; setShowLabels(visible);
    stage.current?.setLabelsVisible(visible);
  }
  function close() {
    setOpen(false);
    onClose?.();
    dialog.current?.close();
  }
  function show() {
    onOpen?.();
    autoplayAttempted.current = false;
    setControlsOpen(false);
    manualCameraRef.current = false; setManualCamera(false);
    setFailure(null); setStatus("loading"); setOpen(true); dialog.current?.showModal();
  }
  return <>
    <BandStageButton ref={trigger} onClick={show} />
    <dialog ref={dialog} id="performance-stage" className={`performance-dialog${hero ? " performance-with-hero" : ""}`} aria-label="Band stage" onCancel={event => { if (hero) { event.preventDefault(); hideHero(); } else if (controlsOpen) { event.preventDefault(); setControlsOpen(false); controlsTrigger.current?.focus(); } else { setOpen(false); onClose?.(); } }} onClose={() => { if (dialog.current?.open) return; setHero(false); setControlsOpen(false); setOpen(false); onClose?.(); trigger.current?.focus(); }}>
      <header className="performance-heading" hidden={hero}>
        <Button variant="secondary" onClick={close} aria-label="Close band stage">Close <span aria-hidden="true">×</span></Button>
      </header>
      <div className="performance-viewport" ref={viewport}>
        {open && status === "loading" && <div className="performance-overlay" role="status">Getting the band together…</div>}
        {open && status === "error" && <div className="performance-overlay" role="alert"><strong>Couldn’t open the stage</strong><p>{failure}</p><p>Close and reopen to retry. The studio is still available.</p></div>}
        {open && performers === 0 && status === "ready" && <div className="performance-overlay">Add a track to meet your first performer.</div>}
      </div>
      {open && hero && <MuseHero duration={duration} program={program} fileName={fileName} readPerformance={readPerformance} play={onPlay} starting={starting} error={error} onPrepare={onStop} onClose={hideHero} />}
      <Button ref={heroTrigger} className="performance-hero-trigger" variant="secondary" hidden={hero} disabled={heroDisabled || status !== "ready" || tracks === 0} aria-expanded={hero} aria-controls="muse-hero" onClick={() => setHero(true)}>Muse Hero <span aria-hidden="true">↗</span></Button>
      <footer className="performance-footer" hidden={hero}>
        <div className="performance-transport"><Button variant="primary" onClick={() => { if (playing || starting) onStop(); else void onPlay(); }} disabled={!playing && !starting && (status !== "ready" || performers === 0)}>{playing || starting ? "Stop" : "Play"}</Button><span>{tempo} BPM<span className="performance-divider">/</span>{performers} {performers === 1 ? "performer" : "performers"}</span></div>
        <div className="performance-controls" ref={controls}>
          <Button ref={controlsTrigger} variant="secondary" className="performance-controls-trigger" aria-label="Band controls" aria-expanded={controlsOpen} aria-controls="performance-controls" onClick={() => setControlsOpen(value => !value)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7h10c2 0 3 1.5 3.5 4l1 6c.4 2-1.8 3-3.2 1.6L15.5 16h-7l-2.8 2.6C4.3 20 2.1 19 2.5 17l1-6C4 8.5 5 7 7 7Z M7.5 10v4 M5.5 12h4" /><circle cx="16" cy="11" r=".7" fill="currentColor" /><circle cx="18" cy="13" r=".7" fill="currentColor" /></svg>
          </Button>
          {controlsOpen && <div id="performance-controls" className="performance-options" role="group" aria-label="Band controls"><div className="performance-camera-controls" role="group" aria-label="Camera controls">
            <Button variant="secondary" disabled={status !== "ready"} aria-pressed={manualCamera} aria-describedby="performance-camera-help" onClick={toggleCamera}>{manualCamera ? "Auto camera" : "Take control"}</Button>
            {manualCamera && <><Button variant="secondary" aria-label="Zoom in" disabled={status !== "ready"} onClick={() => stage.current?.zoomCamera(.85)}>+</Button><Button variant="secondary" aria-label="Zoom out" disabled={status !== "ready"} onClick={() => stage.current?.zoomCamera(1 / .85)}>−</Button></>}
            <Button variant="secondary" disabled={status !== "ready"} onClick={() => stage.current?.resetCamera()}>Reset view</Button>
          </div><label><input type="checkbox" checked={still} onChange={event => setStill(event.target.checked)} /> Still mode</label>
            <label><input type="checkbox" checked={showLabels} onChange={event => toggleLabels(event.target.checked)} /> Show character labels</label>
            <p id="performance-camera-help">{manualCamera ? "Drag to orbit · Right-drag to pan · Scroll or pinch to zoom" : still ? "Camera paused in still mode" : "Automatic camera"}</p>
          </div>}
        </div>
      </footer>
      {error && !hero && <p className="performance-error" role="alert">{error}</p>}
    </dialog>
  </>;
}
