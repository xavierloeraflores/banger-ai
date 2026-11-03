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
  const [songName, setSongName] = useState("");
  const [working, setBusy] = useState(false);
  const busy = working || studioBusy;
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    if (savedFile) queueMicrotask(() => setPaths(previous => [...new Set([...previous, savedFile.path])].sort()));
  }, [savedFile]);
  useEffect(() => {
    const bridge = getProjectWorkspace();
    queueMicrotask(() => setAvailable(true));
    return bridge.onEvent(event => {
      if (event.type === "file-changed" && event.file) {
        const path = event.file.path;
        setPaths(previous => [...new Set([...previous, path])].sort());
      }
    });
  }, []);
  if (!available) return null;
  async function action(work: (bridge: Bridge) => Promise<void>) {
    if (pending.current || studioBusy) return;
    pending.current = true; setBusy(true); onBusyChange(true); setNotice("");
    try { await work(getProjectWorkspace()); }
    catch (error) { setNotice(message(error)); }
    finally { pending.current = false; setBusy(false); onBusyChange(false); }
  }
  async function load(next: File, project = name) {
    await onLoad(next, next.source, project);
  }
  function changeProject(create: boolean) {
    if (!canReplace()) return;
    void action(async bridge => {
      const next = create
        ? await bridge.create("Untitled.banger", serializeMusic(createDefaultProgram()))
        : await bridge.open();
      if (!next) return;
      onFolderChange(next); setName(next.name); setPaths(next.paths);
      if (next.file) await load(next.file, next.name);
    });
  }
  return <>
    <section className="project-workspace project-folder-workspace" aria-label="Project workspace">
      <div className="project-workspace-heading"><div className="project-folder-identity"><ProjectIcon name="folder" /><div><h2>Project Workspace</h2><p>{name || "No project folder selected"}</p></div></div>
        <div className="project-workspace-actions">
          <Button variant="secondary" disabled={busy} onClick={() => changeProject(false)}><ProjectIcon name="external" />Open Project</Button>
          <Button variant="secondary" disabled={busy} onClick={() => changeProject(true)}>Create New Project</Button>
        </div>
      </div>
      {cloudControls}
    </section>
    <section className="project-file-card project-workspace" aria-label="Studio file">
      {songCard}
      {name && <div className="project-song-controls">
        <label>Song in project<select id="workspace-file" value={savedFile?.path ?? ""} disabled={busy} onChange={event => {
          const path = event.target.value;
          if (path && canReplace()) void action(async bridge => { await bridge.activate(); await load(await bridge.read(path)); });
        }}>
          <option value="" disabled>Choose a song</option>{paths.map(path => <option key={path}>{path}</option>)}
        </select></label>
        <form onSubmit={event => {
          event.preventDefault();
          if (!canReplace()) return;
          void action(async bridge => {
            const stem = songName.trim().replace(/\.banger$/i, "");
            if (!stem || stem.startsWith(".") || /[\\/:*?"<>|\x00-\x1f]/.test(stem)) throw new Error("Enter a song name without slashes or special characters.");
            const next = await bridge.save(`${stem}.banger`, serializeMusic(createDefaultProgram()), null);
            setPaths(await bridge.list()); await bridge.activate(); await load(next); setSongName("");
          });
        }}>
          <label>New song name<input aria-label="New song name" value={songName} maxLength={80} disabled={busy} onChange={event => setSongName(event.target.value)} placeholder="Untitled" /></label>
          <Button type="submit" variant="secondary" disabled={busy || !songName.trim()}>Create New Song</Button>
        </form>
      </div>}
    {notice && <p className="project-workspace-notice" role="status">{notice}</p>}
  </section></>;
}
