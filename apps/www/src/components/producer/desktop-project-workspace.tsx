"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@banger/shadcn";

type File = { path: string; source: string };
type Event = { type: string; name?: string; path?: string; text?: string; ok?: boolean; error?: string; file?: File };
type Bridge = {
  open(): Promise<{ name: string; paths: string[] } | null>;
  list(): Promise<string[]>;
  read(path: string): Promise<File>;
  save(path: string, source: string, expected: string | null): Promise<File>;
  run(prompt: string, activeFile?: string): Promise<{ ok: true; reply: { text: string; status: string } } | { ok: false; error: string }>;
  cancel(): Promise<void>;
  onEvent(callback: (event: Event) => void): () => void;
};
declare global { interface Window { bangerWorkspace?: Bridge } }
const message = (error: unknown) => error instanceof Error ? error.message : "The project operation failed.";

export function DesktopProjectWorkspace({ onLoad }: { onLoad(file: { name: string; source: string }): void }) {
  const [available, setAvailable] = useState(false);
  const [name, setName] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const editor = useRef({ file, source });
  const pending = useRef(false);
  useEffect(() => { editor.current = { file, source }; }, [file, source]);
  const dirty = Boolean(file && source !== file.source);
  useEffect(() => {
    const bridge = window.bangerWorkspace;
    if (!bridge) return;
    queueMicrotask(() => setAvailable(true));
    return bridge.onEvent(event => {
      if (event.type === "file-changed" && event.file) {
        const changed = event.file;
        setPaths(previous => [...new Set([...previous, changed.path])].sort());
        const current = editor.current;
        if (current.file?.path === changed.path && current.source === current.file.source) {
          editor.current = { file: changed, source: changed.source };
          setFile(changed); setSource(changed.source);
        } else if (current.file?.path === changed.path) setNotice("The agent saved this file. Your draft is preserved. Save will check for a conflict; reload to inspect the saved version.");
      }
      const text = event.type === "file-changed" ? `Saved ${event.file?.path}` : event.type === "tool-start" ? `${event.name}${event.path ? ` · ${event.path}` : ""}` : event.type === "tool-result" && !event.ok ? event.error : event.type === "text" ? event.text : "";
      if (text) setEvents(previous => [...previous, text].slice(-80));
    });
  }, []);
  useEffect(() => {
    if (!dirty && !running) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, running]);
  if (!available) return null;
  function discard() { return !dirty || window.confirm("Discard unsaved edits in the project workspace?"); }
  function adopt(next: File) { editor.current = { file: next, source: next.source }; setFile(next); setSource(next.source); }
  async function action(work: (bridge: Bridge) => Promise<void>) {
    if (pending.current || !window.bangerWorkspace) return;
    pending.current = true; setBusy(true); setNotice("");
    try { await work(window.bangerWorkspace); }
    catch (error) { setNotice(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="project-workspace producer-panel" aria-label="Project workspace">
    <div className="project-workspace-heading"><div><h2>Project workspace</h2><p>{name || "Open a folder to edit music across files with the project agent."}</p></div>
      <Button disabled={busy || running} onClick={() => { if (discard()) void action(async bridge => {
        const next = await bridge.open();
        if (!next) return;
        setName(next.name); setPaths(next.paths); setFile(null); setSource(""); setEvents([]);
        if (next.paths[0]) adopt(await bridge.read(next.paths[0]));
      }); }}>Open project folder</Button></div>
    {name && <>
      <div className="project-workspace-files">
        <label>Music file<select id="workspace-file" value={file?.path ?? ""} disabled={busy || running} onChange={event => { const path = event.target.value; if (path && discard()) void action(async bridge => adopt(await bridge.read(path))); }}>
          <option value="" disabled>Choose a file</option>{paths.map(path => <option key={path}>{path}</option>)}
        </select></label>
        <Button disabled={busy || running} onClick={() => { if (discard()) void action(async bridge => { setPaths(await bridge.list()); if (file) adopt(await bridge.read(file.path)); }); }}>Reload files</Button>
      </div>
      {file ? <>
        <label htmlFor="workspace-source">{file.path}{dirty ? " · Unsaved draft" : " · Saved"}</label>
        <textarea id="workspace-source" spellCheck={false} value={source} disabled={busy || running} onChange={event => setSource(event.target.value)} />
        <div className="project-workspace-actions"><Button disabled={!dirty || busy || running} onClick={() => void action(async bridge => { adopt(await bridge.save(file.path, source, file.source)); setNotice(`Saved ${file.path}.`); })}>Save project file</Button>
          <Button disabled={busy || running} onClick={() => onLoad({ name: file.path.split("/").pop() ?? file.path, source })}>Load workspace file in studio</Button></div>
      </> : <p>No .banger files yet. Ask the agent to create the first music file.</p>}
      <form onSubmit={event => { event.preventDefault(); if (dirty || running) return; void action(async bridge => {
        setRunning(true); setEvents([]);
        try { const result = await bridge.run(prompt, file?.path); setNotice(result.ok ? result.reply.text : result.error); setPaths(await bridge.list()); }
        finally { setRunning(false); }
      }); }}>
        <label htmlFor="workspace-prompt">Project agent task</label>
        <textarea id="workspace-prompt" value={prompt} maxLength={16000} disabled={running} onChange={event => setPrompt(event.target.value)} placeholder="Add a bass part to verse.banger, then soften the drums in chorus.banger." />
        <p>Uses the model selected in AI settings. Changes compile and save directly to this folder. Follow-up tasks keep the same project conversation.</p>
        {dirty && <p role="status">Save or reload your draft before running the agent.</p>}
        <div className="project-workspace-actions"><Button type="submit" disabled={dirty || busy || running || !prompt.trim()}>Run project task</Button>{running && <Button type="button" onClick={() => { void window.bangerWorkspace?.cancel().catch(error => setNotice(message(error))); }}>Stop project task</Button>}</div>
      </form>
      {events.length > 0 && <ol className="project-workspace-events" aria-label="Project agent activity" aria-live="polite">{events.map((event, index) => <li key={index}>{event}</li>)}</ol>}
    </>}
    {notice && <p className="project-workspace-notice" role="status">{notice}</p>}
  </section>;
}
