"use client";

import { useRef, useState } from "react";
import { createDefaultProgram, serializeMusic } from "@banger/compiler";
import { Button } from "@banger/shadcn";
import type { BangerFile } from "@banger/agent/protocol";
import { getProjectWorkspace } from "@/lib/browser-workspace";
import type { ProjectFolder } from "@/lib/project-workspace";

export function ProjectStart({ sample, onStart }: { sample: BangerFile; onStart(file: BangerFile, saved: boolean, folder?: ProjectFolder): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function choose(action: "create" | "open" | "sample") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const bridge = getProjectWorkspace();
      const blank = { name: "Untitled.banger", source: serializeMusic(createDefaultProgram()) };
      const initial = action === "sample" ? sample : blank;
      const folder = action === "open" ? await bridge.open() : await bridge.create(initial.name, initial.source);
      if (!folder) return;
      onStart(folder.file ? { name: folder.file.path.split("/").pop()!, source: folder.file.source } : blank, Boolean(folder.file), folder);
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
  </main>;
}
