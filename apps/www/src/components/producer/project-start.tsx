"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { FirstSongDialog } from "./first-song-dialog";
import { useRecentProjects } from "./recent-projects";
import { Button, Modal, type ModalHandle } from "@banger/shadcn";
import type { BangerFile } from "@banger/agent/protocol";
import { getProjectWorkspace } from "@/lib/browser-workspace";
import type { ProjectFolder } from "@/lib/project-workspace";

export function ProjectStart({ sample, onStart, onOpenLibrary, requiredStudio, onCancel, dialogRef, canChangeProject, studioBusy = false, children }: {
  sample: BangerFile;
  onStart(file: BangerFile, saved: boolean, folder?: ProjectFolder): void;
  onOpenLibrary?(): void;
  requiredStudio?: "beat" | "vocal";
  onCancel?(): void;
  dialogRef?: RefObject<ModalHandle | null>;
  canChangeProject?(): boolean;
  studioBusy?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  const localDialog = useRef<ModalHandle>(null);
  const dialog = dialogRef ?? localDialog;
  const modal = !!requiredStudio || !!dialogRef;
  useEffect(() => {
    if (!requiredStudio) return;
    const trigger = document.activeElement;
    const modal = dialog.current;
    modal?.showModal();
    return () => { modal?.close(); if (trigger instanceof HTMLElement) trigger.focus(); };
  }, [requiredStudio, dialog]);
  const [working, setBusy] = useState(false);
  const busy = working || studioBusy;
  const [error, setError] = useState("");
  const pending = useRef(false);
  const [emptyFolder, setEmptyFolder] = useState<ProjectFolder | null>(null);
  const recent = useRecentProjects();

  function start(folder: ProjectFolder) {
    if (!folder.file) { setEmptyFolder(folder); return; }
    setEmptyFolder(null);
    onStart({ name: folder.file.path.split("/").pop()!, source: folder.file.source }, true, folder);
  }

  async function choose(action: "create" | "open" | "sample" | { recentId: string }) {
    if (pending.current || studioBusy || (canChangeProject && !canChangeProject())) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const bridge = getProjectWorkspace();
      const folder = typeof action === "object"
        ? await bridge.restore?.(action.recentId)
        : action === "open" ? await bridge.open() : action === "sample" ? await bridge.create(sample.name, sample.source) : await bridge.create();
      if (folder) {
        window.dispatchEvent(new Event("banger:projects-changed"));
        start(folder);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the project.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const content = <>
    <section className="producer-start-card" aria-labelledby={`${id}-title`} aria-busy={busy}>
      {modal ? <h2 id={`${id}-title`}>Projects</h2> : <>
        <div className="producer-wordmark">banger<span>_</span></div>
        <h1 id={`${id}-title`}>Start making music</h1>
      </>}
      <p id={`${id}-description`}>{requiredStudio
        ? `Open a project or create a new one to use ${requiredStudio === "vocal" ? "Vocal Studio" : "Beat Studio"}.`
        : "Open a project, create a new one, or load the sample project."}</p>
      {recent.length > 0 && <section className="producer-start-recents" aria-labelledby={`${id}-recent-title`}>
        <h3 id={`${id}-recent-title`}>Recent projects</h3>
        <ul>{recent.map(project => <li key={project.id}>
          <Button variant="secondary" disabled={busy} onClick={() => void choose({ recentId: project.id })} aria-label={`Open project ${project.name}`}>
            {project.name}
          </Button>
        </li>)}</ul>
      </section>}
      <div className="producer-start-actions">
        <Button variant="primary" disabled={busy} onClick={() => void choose("open")}>Open Project</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void choose("create")}>Create New Project</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void choose("sample")}>Load Sample Project</Button>
        {onOpenLibrary && <Button variant="secondary" disabled={busy} onClick={onOpenLibrary}>Open Library</Button>}
        {modal && <Button variant="ghost" aria-label="Close project controls" disabled={busy} onClick={() => { dialog.current?.close(); onCancel?.(); }}>Close</Button>}
      </div>
      {children}
      {error && <p role="alert">{error}</p>}
    </section>
    {emptyFolder && <FirstSongDialog folder={emptyFolder} onCreated={start} />}
  </>;
  return modal
    ? <div className="producer producer-project-host"><Modal ref={dialog} id="project-controls" className="producer-project-dialog producer-project-required" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => {
      event.preventDefault();
      if (!busy && !emptyFolder) { dialog.current?.close(); onCancel?.(); }
    }}>{content}</Modal></div>
    : <main className="producer producer-start">{content}</main>;
}
