"use client";

import { useRef, useState } from "react";
import { FirstSongDialog } from "./first-song-dialog";
import { Button } from "@banger/shadcn";
import type { BangerFile } from "@banger/agent/protocol";
import { getProjectWorkspace } from "@/lib/browser-workspace";
import type { ProjectFolder } from "@/lib/project-workspace";

export function ProjectStart({ sample, onStart }: { sample: BangerFile; onStart(file: BangerFile, saved: boolean, folder?: ProjectFolder, openProjectControls?: boolean): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const [emptyFolder, setEmptyFolder] = useState<ProjectFolder | null>(null);

  function start(folder: ProjectFolder, openProjectControls = true) {
    if (!folder.file) { setEmptyFolder(folder); return; }
    onStart({ name: folder.file.path.split("/").pop()!, source: folder.file.source }, true, folder, openProjectControls);
  }

  async function choose(action: "create" | "open" | "sample") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const bridge = getProjectWorkspace();
      const folder = action === "open" ? await bridge.open() : action === "sample" ? await bridge.create(sample.name, sample.source) : await bridge.create();
      if (folder) start(folder);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the project.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <main className="producer producer-start">
    <section className="producer-start-card" aria-labelledby="project-start-title" aria-busy={busy}>
      <div className="producer-wordmark">banger<span>_</span></div>
      <h1 id="project-start-title">Start making music</h1>
      <p>Open a project folder or choose where to store a new project.</p>
      <div className="producer-start-actions">
        <Button variant="primary" disabled={busy} onClick={() => void choose("open")}>Open Project</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void choose("create")}>Create New Project</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void choose("sample")}>Load Sample Project</Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
    {emptyFolder && <FirstSongDialog folder={emptyFolder} onCreated={folder => start(folder, false)} />}
  </main>;
}
