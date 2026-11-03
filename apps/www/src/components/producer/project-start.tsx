"use client";

import { useRef, useState } from "react";
import { createDefaultProgram, serializeMusic } from "@banger/compiler";
import { Button } from "@banger/shadcn";
import type { BangerFile } from "@banger/agent/protocol";
import { openProject, saveProject } from "@/lib/project-files";

export function ProjectStart({ sample, onStart }: { sample: BangerFile; onStart(file: BangerFile, saved: boolean): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function choose(create: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (create) {
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
      <p>Create a .banger project or open one you already have.</p>
      <div className="producer-start-actions">
        <Button variant="primary" disabled={busy} onClick={() => void choose(true)}>Create project</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void choose(false)}>Open project</Button>
      </div>
      <div className="producer-start-sample">
        <Button variant="ghost" disabled={busy} onClick={() => onStart(sample, false)}>Work without a project</Button>
        <p>Start with {sample.name}. You can edit, play, and save it later.</p>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  </main>;
}
