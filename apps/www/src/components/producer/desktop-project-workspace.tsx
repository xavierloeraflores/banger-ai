"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ProjectIcon } from "./project-icon";
import { createDefaultProgram, serializeMusic } from "@banger/compiler";
import { getProjectWorkspace } from "@/lib/browser-workspace";
import { Button } from "@banger/shadcn";

import type { ProjectFolder, WorkspaceFile as File } from "@/lib/project-workspace";
type Bridge = NonNullable<Window["bangerWorkspace"]>;
const message = (error: unknown) => error instanceof Error ? error.message : "The project operation failed.";

export function DesktopProjectWorkspace({ initialFolder, savedFile, studioBusy, onBusyChange, onFolderChange, onLoad, canReplace, songCard, cloudControls }: { initialFolder?: ProjectFolder; savedFile: File | null; studioBusy: boolean; onBusyChange(busy: boolean): void; onFolderChange(folder: ProjectFolder): void; canReplace(): boolean; songCard: ReactNode; cloudControls: ReactNode; onLoad(file: File, savedSource: string, projectName: string): Promise<void> }) {
  const [available, setAvailable] = useState(false);
  const [name, setName] = useState(initialFolder?.name ?? "");
  const [paths, setPaths] = useState<string[]>(initialFolder?.paths ?? []);
  const [file, setFile] = useState<File | null>(initialFolder?.file ?? null);
  const [source, setSource] = useState(initialFolder?.file?.source ?? "");
  const [songName, setSongName] = useState("");
  const [desktop, setDesktop] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [working, setBusy] = useState(false);
  const busy = working || studioBusy;
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const editor = useRef({ file, source });
  const pending = useRef(false);
  useEffect(() => { editor.current = { file, source }; }, [file, source]);
  useEffect(() => {
    if (!savedFile) return;
    const current = editor.current;
    if (current.file?.path !== savedFile.path || current.source === current.file?.source) {
      editor.current = { file: savedFile, source: savedFile.source };
      queueMicrotask(() => { setFile(savedFile); setSource(savedFile.source); setPaths(previous => [...new Set([...previous, savedFile.path])].sort()); });
    }
  }, [savedFile]);
  const dirty = Boolean(file && source !== file.source);
  useEffect(() => {
    const bridge = getProjectWorkspace();
    queueMicrotask(() => { setAvailable(true); setDesktop(Boolean(window.bangerWorkspace)); });
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
    if (pending.current || studioBusy) return;
    pending.current = true; setBusy(true); onBusyChange(true); setNotice("");
    try { await work(getProjectWorkspace()); }
    catch (error) { setNotice(message(error)); }
    finally { pending.current = false; setBusy(false); onBusyChange(false); }
  }
  async function load(next: File, project = name) {
    await onLoad(next, next.source, project);
    adopt(next);
  }
  function changeProject(create: boolean) {
    if (!discard() || !canReplace()) return;
    void action(async bridge => {
      const next = create
        ? await bridge.create("Untitled.banger", serializeMusic(createDefaultProgram()))
        : await bridge.open();
      if (!next) return;
      onFolderChange(next); setName(next.name); setPaths(next.paths); setFile(null); setSource(""); setEvents([]); setPrompt("");
      if (next.file) await load(next.file, next.name);
    });
  }
  return <>
    <section className="project-workspace project-folder-workspace" aria-label="Project workspace">
      <div className="project-workspace-heading"><div className="project-folder-identity"><ProjectIcon name="folder" /><div><h2>Project Workspace</h2><p>{name || "No project folder selected"}</p></div></div>
        <div className="project-workspace-actions">
          <Button variant="secondary" disabled={busy || running} onClick={() => changeProject(false)}><ProjectIcon name="external" />Open Project</Button>
          <Button variant="secondary" disabled={busy || running} onClick={() => changeProject(true)}>Create New Project</Button>
        </div>
      </div>
      {cloudControls}
    </section>
    <section className="project-file-card project-workspace" aria-label="Studio file">
      {songCard}
      {name && <div className="project-song-controls">
        <label>Song in project<select id="workspace-file" value={savedFile?.path ?? ""} disabled={busy || running} onChange={event => {
          const path = event.target.value;
          if (path && discard() && canReplace()) void action(async bridge => { await bridge.activate(); await load(await bridge.read(path)); });
        }}>
          <option value="" disabled>Choose a song</option>{paths.map(path => <option key={path}>{path}</option>)}
        </select></label>
        <form onSubmit={event => {
          event.preventDefault();
          if (!discard() || !canReplace()) return;
          void action(async bridge => {
            const stem = songName.trim().replace(/\.banger$/i, "");
            if (!stem || stem.startsWith(".") || /[\\/:*?"<>|\x00-\x1f]/.test(stem)) throw new Error("Enter a song name without slashes or special characters.");
            const next = await bridge.save(`${stem}.banger`, serializeMusic(createDefaultProgram()), null);
            setPaths(await bridge.list()); await bridge.activate(); await load(next); setSongName("");
          });
        }}>
          <label>New song name<input aria-label="New song name" value={songName} maxLength={80} disabled={busy || running} onChange={event => setSongName(event.target.value)} placeholder="Untitled" /></label>
          <Button type="submit" variant="secondary" disabled={busy || running || !songName.trim()}>Create New Song</Button>
        </form>
      </div>}
      {name && <details className="project-song-advanced"><summary>Song source and project agent</summary>
        <div className="project-workspace-actions"><Button disabled={busy || running} onClick={() => { if (discard()) void action(async bridge => { setPaths(await bridge.list()); if (file) adopt(await bridge.read(file.path)); }); }}>Reload files</Button></div>
      {file ? <>
        <label htmlFor="workspace-source">{file.path}{dirty ? " · Unsaved draft" : " · Saved"}</label>
        <textarea id="workspace-source" spellCheck={false} value={source} disabled={busy || running} onChange={event => setSource(event.target.value)} />
        <div className="project-workspace-actions"><Button disabled={!dirty || busy || running} onClick={() => void action(async bridge => { adopt(await bridge.save(file.path, source, file.source)); setNotice(`Saved ${file.path}.`); })}>Save project file</Button>
          <Button disabled={busy || running} onClick={() => { if (canReplace()) void action(async () => { await onLoad({ path: file.path, source }, file.source, name); }); }}>Load workspace file in studio</Button></div>
      </> : <p>No songs yet. Create a new song above.</p>}
      {desktop && <form onSubmit={event => { event.preventDefault(); if (dirty || running) return; void action(async bridge => {
        setRunning(true); setEvents([]);
        try { const result = await bridge.run(prompt, file?.path); setNotice(result.ok ? result.reply.text : result.error); setPaths(await bridge.list()); }
        finally { setRunning(false); }
      }); }}>
        <label htmlFor="workspace-prompt">Project agent task</label>
        <textarea id="workspace-prompt" value={prompt} maxLength={16000} disabled={running} onChange={event => setPrompt(event.target.value)} placeholder="Add a bass part to verse.banger, then soften the drums in chorus.banger." />
        <p>Uses the model selected in AI settings. Changes compile and save directly to this folder. Follow-up tasks keep the same project conversation.</p>
        {dirty && <p role="status">Save or reload your draft before running the agent.</p>}
        <div className="project-workspace-actions"><Button type="submit" disabled={dirty || busy || running || !prompt.trim()}>Run project task</Button>{running && <Button type="button" onClick={() => { void window.bangerWorkspace?.cancel().catch(error => setNotice(message(error))); }}>Stop project task</Button>}</div>
      </form>}
      {events.length > 0 && <ol className="project-workspace-events" aria-label="Project agent activity" aria-live="polite">{events.map((event, index) => <li key={index}>{event}</li>)}</ol>}
    </details>}
    {notice && <p className="project-workspace-notice" role="status">{notice}</p>}
  </section></>;
}
