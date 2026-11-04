"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FirstSongDialog } from "./first-song-dialog";
import { ProjectIcon } from "./project-icon";
import { createDefaultProgram, serializeMusic } from "@banger/compiler";
import { getProjectWorkspace } from "@/lib/browser-workspace";
import { Button, Select, Modal, Input, type ModalHandle } from "@banger/shadcn";

import type { ProjectFolder, WorkspaceFile as File } from "@/lib/project-workspace";
type Bridge = NonNullable<Window["bangerWorkspace"]>;
const message = (error: unknown) => error instanceof Error ? error.message : "The project operation failed.";

export function DesktopProjectWorkspace({ initialFolder, savedFile, studioBusy, onBusyChange, onFolderChange, onLoad, onProjectOpened, canReplace, canChangeProject, songCard, cloudControls }: { initialFolder?: ProjectFolder; savedFile: File | null; studioBusy: boolean; onBusyChange(busy: boolean): void; onFolderChange(folder: ProjectFolder): void; canReplace(): boolean; canChangeProject?(): boolean; onProjectOpened(): void; songCard: ReactNode; cloudControls: ReactNode; onLoad(file: File, savedSource: string, projectName: string): Promise<void> }) {
  const [emptyFolder, setEmptyFolder] = useState<ProjectFolder | null>(null);
  const [available, setAvailable] = useState(false);
  const [name, setName] = useState(initialFolder?.name ?? "");
  const [paths, setPaths] = useState<string[]>(initialFolder?.paths ?? []);
  const songDialog = useRef<ModalHandle>(null);
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
    // Refresh after a hidden dialog resumes, including edits made by the project agent.
    let active = true;
    void bridge.list().then(paths => { if (active) setPaths(paths); }).catch(() => { /* Folder actions report their own errors. */ });
    const unsubscribe = bridge.onEvent(event => {
      if (event.type === "file-changed" && event.file && (!event.projectId || event.projectId === initialFolder?.id)) {
        const path = event.file.path;
        setPaths(previous => [...new Set([...previous, path])].sort());
      }
    });
    return () => { active = false; unsubscribe(); };
  }, [initialFolder?.id]);
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
  async function openFolder(next: ProjectFolder) {
    onFolderChange(next); setName(next.name); setPaths(next.paths);
    if (next.file) {
      await load(next.file, next.name);
      onProjectOpened();
    }
    setEmptyFolder(null);
  }
  function changeProject(create: boolean) {
    if (!(canChangeProject ?? canReplace)()) return;
    void action(async bridge => {
      const next = create
        ? await bridge.create()
        : await bridge.open();
      if (!next) return;
      if (!next.paths.length) setEmptyFolder(next);
      else await openFolder(next);
    });
  }
  return <>
    {emptyFolder && <FirstSongDialog folder={emptyFolder} onCreated={openFolder} />}
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
        <label>Song in project<Select id="workspace-file" value={savedFile?.path ?? ""} disabled={busy} onChange={event => {
          const path = event.target.value;
          if (path && canReplace()) void action(async bridge => { await bridge.activate(); await load(await bridge.read(path)); });
        }}>
          <option value="" disabled>Choose a song</option>{paths.map(path => <option key={path}>{path}</option>)}
        </Select></label>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => { setSongName(""); setNotice(""); songDialog.current?.showModal(); }}>Create Song</Button>
      </div>}
    <Modal ref={songDialog} className="producer-project-dialog create-song-dialog" aria-labelledby="create-song-title" onCancel={event => { if (busy) event.preventDefault(); }}>
        <form aria-busy={busy} onSubmit={event => {
          event.preventDefault();
          if (!canReplace()) return;
          void action(async bridge => {
            const stem = songName.trim().replace(/\.banger$/i, "");
            if (!stem || stem.startsWith(".") || /[\\/:*?"<>|\x00-\x1f]/.test(stem)) throw new Error("Enter a song name without slashes or special characters.");
            const next = await bridge.save(`${stem}.banger`, serializeMusic(createDefaultProgram()), null);
            setPaths(await bridge.list()); await bridge.activate(); await load(next); setSongName(""); songDialog.current?.close();
          });
        }}>
          <h2 id="create-song-title">Create new song</h2>
          <label>New song name<Input data-autofocus autoFocus aria-label="New song name" value={songName} maxLength={80} disabled={busy} onChange={event => setSongName(event.target.value)} placeholder="Untitled" /></label>
          {notice && <p role="alert">{notice}</p>}
          <Button type="button" variant="secondary" disabled={busy} onClick={() => songDialog.current?.close()}>Cancel</Button>
          <Button type="submit" variant="secondary" disabled={busy || !songName.trim()}>Create New Song</Button>
        </form>
    </Modal>
    {notice && <p className="project-workspace-notice" role="status">{notice}</p>}
  </section></>;
}
