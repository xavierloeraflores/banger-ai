"use client";

import { useEffect, useRef, useState } from "react";
import { createDefaultProgram, serializeMusic } from "@banger/compiler";
import { Button, Modal, Input, type ModalHandle } from "@banger/shadcn";
import { getProjectWorkspace } from "@/lib/browser-workspace";
import type { ProjectFolder } from "@/lib/project-workspace";

export function FirstSongDialog({ folder, onCreated }: { folder: ProjectFolder; onCreated(folder: ProjectFolder): void | Promise<void> }) {
  const dialog = useRef<ModalHandle>(null);
  const pending = useRef(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function create() {
    if (pending.current) return;
    const stem = name.trim().replace(/\.banger$/i, "");
    if (!stem || stem.startsWith(".") || /[\\/:*?"<>|\x00-\x1f]/.test(stem)) {
      setError("Enter a song name without slashes or special characters.");
      return;
    }
    pending.current = true;
    setBusy(true); setError("");
    try {
      const bridge = getProjectWorkspace();
      const file = await bridge.save(`${stem}.banger`, serializeMusic(createDefaultProgram()), null);
      await onCreated({ ...folder, paths: await bridge.list(), file });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the song. Try again.");
    } finally { pending.current = false; setBusy(false); }
  }

  return <Modal ref={dialog} className="producer-project-dialog first-song-dialog" aria-labelledby="first-song-title" aria-describedby="first-song-description" onCancel={event => event.preventDefault()}>
    <form onSubmit={event => { event.preventDefault(); void create(); }} aria-busy={busy}>
      <h2 id="first-song-title">Name your first song</h2>
      <p id="first-song-description">{folder.name} has no songs yet. Create one to open it in the studio.</p>
      <label htmlFor="first-song-name">Song name</label>
      <Input id="first-song-name" data-autofocus autoFocus value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} placeholder="My first song" aria-invalid={Boolean(error)} aria-describedby={error ? "first-song-error" : undefined} />
      {error && <p id="first-song-error" role="alert">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{busy ? "Creating song…" : "Create Song"}</Button>
    </form>
  </Modal>;
}
