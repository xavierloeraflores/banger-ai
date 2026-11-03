"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@banger/shadcn";
import type { PerformanceSnapshot, StageView } from "@banger/stage";
import "./performance-stage.css";

interface Props {
  readPerformance: () => PerformanceSnapshot;
  playing: boolean;
  starting: boolean;
  tempo: number;
  tracks: number;
  error: string | null;
  onPlay: () => Promise<void>;
  onStop: () => void;
}
export function PerformanceStage({ readPerformance, playing, starting, tempo, tracks, error, onPlay, onStop }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<StageView | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [failure, setFailure] = useState<string | null>(null);
  const [still, setStill] = useState(false);

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
      setStatus("ready");
    }).catch(cause => {
      if (cancelled) return;
      setFailure(cause instanceof Error ? cause.message : "The 3D view could not start.");
      setStatus("error");
    });
    return () => { cancelled = true; stage.current?.dispose(); stage.current = null; };
  }, [open, readPerformance, still]);

  function show() {
    setFailure(null); setStatus("loading"); setOpen(true); dialog.current?.showModal();
  }
  return <>
    <Button ref={trigger} variant="secondary" onClick={show} aria-haspopup="dialog" aria-controls="performance-stage">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 3 9 5v8l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v8" /></svg>
      Band stage
    </Button>
    <dialog ref={dialog} id="performance-stage" className="performance-dialog" aria-labelledby="performance-title" aria-describedby="performance-description" onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      <header className="performance-heading">
        <div><span className="performance-eyebrow">BANGER / LIVE ROOM</span><h2 id="performance-title">Meet your band<span className={playing ? "performance-live playing" : "performance-live"}>{playing ? "LIVE" : "READY"}</span></h2><p id="performance-description">One little performer for every track. Your music brings them to life.</p></div>
        <Button variant="secondary" onClick={() => dialog.current?.close()} aria-label="Close band stage">Close <span aria-hidden="true">×</span></Button>
      </header>
      <div className="performance-viewport" ref={viewport}>
        {open && status === "loading" && <div className="performance-overlay" role="status">Getting the band together…</div>}
        {open && status === "error" && <div className="performance-overlay" role="alert"><strong>Couldn’t open the stage</strong><p>{failure}</p><p>Close and reopen to retry. The studio is still available.</p></div>}
        {open && tracks === 0 && status === "ready" && <div className="performance-overlay">Add a track to meet your first performer.</div>}
        <div className="performance-camera-hint" aria-hidden="true">Drag to orbit · Scroll to zoom</div>
      </div>
      <footer className="performance-footer">
        <div className="performance-transport"><Button variant="primary" onClick={() => void onPlay()} disabled={playing || starting || status !== "ready" || tracks === 0}>{starting ? "Starting…" : playing ? "Playing" : "Play band"}</Button><Button variant="secondary" onClick={onStop} disabled={!playing && !starting}>Stop</Button><span>{tempo} BPM<span className="performance-divider">/</span>{tracks} {tracks === 1 ? "performer" : "performers"}</span></div>
        <div className="performance-options"><label><input type="checkbox" checked={still} onChange={event => setStill(event.target.checked)} /> Still mode</label><Button variant="secondary" onClick={() => stage.current?.resetCamera()}>Reset view</Button></div>
      </footer>
      {error && <p className="performance-error" role="alert">{error}</p>}
    </dialog>
  </>;
}
