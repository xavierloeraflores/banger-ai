"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@banger/shadcn";

type LocalStatus = {
  phase: "missing" | "downloading" | "verifying" | "ready" | "starting" | "running" | "error";
  installedVariants: ("small" | "dynamic")[]; variant: "small" | "dynamic"; selected: boolean; installed: boolean; completed: number; total: number; message: string;
  supported: boolean; memoryGB: number;
};
declare global {
  interface Window {
    bangerLocal?: {
      status(): Promise<LocalStatus>; choose(variant: "small" | "dynamic"): Promise<void>;
      download(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; select(value: boolean): Promise<void>;
    };
  }
}

export function LocalModelSettings() {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    if (!window.bangerLocal) return;
    let active = true;
    const refresh = async () => {
      try { const next = await window.bangerLocal!.status(); if (active) setStatus(next); }
      catch { if (active) setError("Could not read local model status."); }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function act(action: "download" | "start" | "stop" | "small" | "dynamic") {
    if (pending.current || !window.bangerLocal) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (action === "small" || action === "dynamic") await window.bangerLocal.choose(action);
      else await window.bangerLocal[action]();
      setStatus(await window.bangerLocal.status());
      window.dispatchEvent(new Event("banger:ai-settings-changed"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the local model."); }
    finally { pending.current = false; setBusy(false); }
  }
  if (!status) return error ? <p role="alert">{error}</p> : null;
  const working = ["downloading", "verifying", "starting"].includes(status.phase);
  const downloading = ["downloading", "verifying"].includes(status.phase);
  return <section className="local-model-settings" aria-labelledby="local-model-title">
    <div className="byok-heading"><h3 id="local-model-title">Muse Glimmer 30B</h3><span className="producer-tag">{status.selected ? "Selected · local AI" : "Local AI · no API key"}</span></div>
    <p className="byok-description">Generate .banger files on this computer. Download a Meta quantization once, then run it offline. Your prompts and projects stay on this device when local AI is selected.</p>
    <label className="local-model-size" htmlFor="local-model-size">Model size
      <select id="local-model-size" value={status.variant} disabled={busy || working || status.phase === "running"}
        onChange={event => void act(event.target.value as "small" | "dynamic")}>
        <option value="small">16 GB version · Q4_K_M · 16.8 GB download</option>
        <option value="dynamic">20 GB version · Q4_K_XL Dynamic · 19.7 GB download</option>
      </select>
    </label>
    <p className="byok-storage">{status.variant === "small" ? "15.6 GiB on disk. Allow 18 GB free space. Recommended memory: 24 GB or more." : "18.3 GiB on disk. Allow 21 GB free space. Recommended memory: 32 GB or more."} This computer has {status.memoryGB} GB. You can keep both downloads and switch while the model is stopped.</p>
    {status.memoryGB < (status.variant === "small" ? 24 : 32) && <p className="has-error">This computer has less than the recommended memory. Generation may be slow or fail to start.</p>}
    {!status.supported && <p role="alert">Automatic installation is unavailable on this operating system.</p>}
    <p role="status">{status.message}</p>
    {downloading && <div className="local-model-progress"><progress aria-label="Local model download" max={status.total} value={status.completed} /><span>{(status.completed / 1e9).toFixed(2)} / {(status.total / 1e9).toFixed(2)} GB</span></div>}
    <p className="byok-storage">Choose a downloaded model from the AI model menu at the top of the app to use it for chat.</p>
    <div className="byok-actions">
      {!status.installed && !working && <Button variant="primary" disabled={busy || !status.supported} onClick={() => void act("download")}>Download model</Button>}
      {status.installed && !working && status.phase !== "running" && <Button variant="primary" disabled={busy} onClick={() => void act("start")}>Start model</Button>}
      {(working || status.phase === "running") && <Button disabled={busy} onClick={() => void act("stop")}>{downloading ? "Pause download" : "Stop model"}</Button>}
      {status.phase === "error" && status.installed && <Button disabled={busy} onClick={() => void act("download")}>Repair runtime</Button>}
    </div>
    {error && <p className="has-error" role="alert">{error}</p>}
  </section>;
}
