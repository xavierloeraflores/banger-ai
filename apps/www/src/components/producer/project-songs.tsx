"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createDefaultProgram, serializeMusic } from "@banger/compiler";
import { Button, Input, Modal, type ModalHandle } from "@banger/shadcn";
import { getProjectWorkspace } from "@/lib/browser-workspace";
import type { ProjectFolder, WorkspaceFile } from "@/lib/project-workspace";

export function useProjectSongs({ folder, savedFile, busy, createDisabled, canReplace, onBusyChange, onLoad, onError }: {
  folder?: ProjectFolder;
  savedFile: WorkspaceFile | null;
  busy: boolean;
  createDisabled: boolean;
  canReplace(): boolean;
  onBusyChange(busy: boolean): void;
  onLoad(file: WorkspaceFile): void;
  onError(message: string): void;
}) {
  const [listing, setListing] = useState({ folder, paths: folder?.paths ?? [] });
  const pending = useRef(false);
  useEffect(() => {
    if (!folder) return;
    const bridge = getProjectWorkspace();
    let active = true;
    void bridge.list().then(paths => { if (active) setListing({ folder, paths }); }).catch(() => { /* Keep the folder's last known song list. */ });
    const unsubscribe = bridge.onEvent(event => {
      if (!active || !event.file || event.type !== "file-changed" || (event.projectId && event.projectId !== folder.id)) return;
      const path = event.file.path;
      if (!path.endsWith(".banger")) return;
      setListing(previous => ({ folder, paths: [...new Set([...(previous.folder === folder ? previous.paths : folder.paths), path])].sort() }));
    });
    return () => { active = false; unsubscribe(); };
  }, [folder]);
  const paths = folder ? [...new Set([...(listing.folder === folder ? listing.paths : folder.paths), ...(savedFile ? [savedFile.path] : [])])].sort() : [];
  async function load(path: string, create = false) {
    if (!folder || busy || (create && createDisabled) || pending.current || !canReplace()) return false;
    pending.current = true; onBusyChange(true);
    try {
      const bridge = getProjectWorkspace();
      await bridge.activate(folder.id);
      const file = create
        ? await bridge.save(path, serializeMusic(createDefaultProgram()), null)
        : await bridge.read(path, folder.id);
      setListing(previous => ({ folder, paths: [...new Set([...(previous.folder === folder ? previous.paths : folder.paths), file.path])].sort() }));
      onLoad(file);
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not open the song.";
      onError(message);
      if (create) throw new Error(message);
      return false;
    } finally { pending.current = false; onBusyChange(false); }
  }
  return { paths, select: (path: string) => load(path), create: (path: string) => load(path, true) };
}

export function AddSongDialog({ dialogRef, busy, onCreate }: {
  dialogRef: RefObject<ModalHandle | null>;
  busy: boolean;
  onCreate(path: string): Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return <Modal ref={dialogRef} className="producer-project-dialog create-song-dialog" aria-labelledby="create-song-title" onClose={() => { setName(""); setError(""); }} onCancel={event => { if (busy) event.preventDefault(); }}>
    <form aria-busy={busy} onSubmit={async event => {
      event.preventDefault(); setError("");
      const stem = name.trim().replace(/\.banger$/i, "");
      if (!stem || stem.startsWith(".") || /[\\/:*?"<>|\x00-\x1f]/.test(stem)) { setError("Enter a song name without slashes or special characters."); return; }
      try { if (await onCreate(`${stem}.banger`)) dialogRef.current?.close(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the song."); }
    }}>
      <h2 id="create-song-title">Add song</h2>
      <label>New song name<Input data-autofocus autoFocus aria-label="New song name" value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} placeholder="Untitled" /></label>
      {error && <p role="alert">{error}</p>}
      <Button type="button" variant="secondary" disabled={busy} onClick={() => dialogRef.current?.close()}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={busy || !name.trim()}>Create New Song</Button>
    </form>
  </Modal>;
}
