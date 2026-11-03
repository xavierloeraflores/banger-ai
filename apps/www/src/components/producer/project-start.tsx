"use client";

import { useEffect, useRef, useState } from "react";
import { createDefaultProgram, serializeMusic } from "@banger/compiler";
import { Button } from "@banger/shadcn";
import type { BangerFile } from "@banger/agent/protocol";
import { openProject, saveProject } from "@/lib/project-files";
import type { ProjectFolder } from "@/lib/project-workspace";

export function ProjectStart({ sample, onStart }: { sample: BangerFile; onStart(file: BangerFile, saved: boolean, folder?: ProjectFolder): void }) {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => { queueMicrotask(() => setDesktop(Boolean(window.bangerWorkspace))); }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function choose(action: "create" | "file" | "folder") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (action === "folder") {
        const bridge = window.bangerWorkspace;
        if (!bridge) return;
        const folder = await bridge.open();
        if (!folder) return;
        const file = folder.paths[0] ? await bridge.read(folder.paths[0]) : null;
        onStart(file ? { name: file.path.split("/").pop()!, source: file.source } : sample, Boolean(file), { ...folder, file });
      } else if (action === "create") {
        const source = serializeMusic(createDefaultProgram());
        const saved = await saveProject(source, "Untitled.banger");
        if (saved) onStart({ ...saved, source }, true);
      } else {
        const file = await openProject();
        if (file) onStart(file, true);
      }
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
      <p>Create a .banger project or open {desktop ? "a file or project folder" : "one you already have"}.</p>
      <div className="producer-start-actions">
        <Button variant="primary" disabled={busy} onClick={() => void choose("create")}>Create new banger</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void choose("file")}>Open existing banger</Button>
        {desktop && <Button variant="secondary" disabled={busy} onClick={() => void choose("folder")}>Open project folder</Button>}
        <Button variant="secondary" disabled={busy} onClick={() => onStart(sample, false)}>Load sample banger</Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  </main>;
}
