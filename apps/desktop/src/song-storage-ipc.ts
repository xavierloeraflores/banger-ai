import { createLibraryRecords } from './library-records.js';
import type { ArtworkContext } from '@banger/agent';
import { songStorage } from '@banger/harness';
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { createSongLibrary } from './song-library.js';
import { randomUUID } from 'node:crypto';
import { createSongStorage, type SongLocation, type LibrarySelection } from './song-storage.js';

export function installSongStorage(senderWindow: (event: IpcMainInvokeEvent) => BrowserWindow, generate?: (context: ArtworkContext) => Promise<string | undefined>, canGenerate?: () => Promise<boolean>) {
  const records = createLibraryRecords(app.getPath('userData'), generate, canGenerate);
  const storage = createSongStorage(app.getPath('userData'), records);
  const roots = new Map<number, string>();
  const bindings = new Map<string, { window: number; song: SongLocation }>();
  const watched = new Set<number>();
  const libraries = new Map<number, ReturnType<typeof createSongLibrary>>();
  function watch(window: BrowserWindow) {
    if (watched.has(window.id)) return;
    watched.add(window.id);
    window.once('closed', () => {
      roots.delete(window.id); watched.delete(window.id); libraries.delete(window.id);
      for (const [key, value] of bindings) if (value.window === window.id) bindings.delete(key);
    });
  }
  function resolve(window: BrowserWindow, token: string) {
    const binding = bindings.get(token);
    if (!binding || binding.window !== window.id) throw new Error('Prepare the song before saving audio.');
    return binding.song;
  }
  ipcMain.handle('banger:library-list', (event) => {
    const window = senderWindow(event); watch(window);
    let library = libraries.get(window.id);
    if (!library) { library = createSongLibrary(app.getPath('userData'), records); libraries.set(window.id, library); }
    return library.list(roots.get(window.id));
  });
  async function recordAction(action: () => Promise<void>) {
    try { await action(); return { ok: true }; }
    catch (error) { return { ok: false, error: error instanceof Error && !('code' in error) ? error.message : 'Could not update the record. Try again.' }; }
  }
  ipcMain.handle('banger:record-rename', (event, id: string, name: string) => { senderWindow(event); return recordAction(() => records.rename(id, name)); });
  ipcMain.handle('banger:record-regenerate', (event, id: string) => { senderWindow(event); return recordAction(() => records.regenerate(id)); });
  for (const method of ['renameSong', 'addToRecord', 'editRecordSongs', 'regenerateSongArtwork'] as const) {
    ipcMain.handle(`banger:library-${method}`, (event, ...args: unknown[]) => {
      const library = libraries.get(senderWindow(event).id);
      return recordAction(async () => {
        if (!library) throw new Error('Open the library first.');
        if (method === 'renameSong') await library.renameSong(args[0] as string, args[1] as string);
        if (method === 'addToRecord') await library.addToRecord(args[0] as string, args[1] as string, args[2] as string | undefined);
        if (method === 'editRecordSongs') await library.editRecordSongs(args[0] as string, args[1] as string[]);
        if (method === 'regenerateSongArtwork') await library.regenerateSongArtwork(args[0] as string);
      });
    });
  }
  ipcMain.handle('banger:library-read', (event, id: string) => {
    const library = libraries.get(senderWindow(event).id);
    if (!library) throw new Error('Open the library first.');
    return library.read(id);
  });
  ipcMain.handle('banger:storage-prepare', async (event, name: string, source?: string) => {
    const window = senderWindow(event); watch(window);
    const song = await storage.prepare(roots.get(window.id), name, source);
    const token = randomUUID(); bindings.set(token, { window: window.id, song }); return token;
  });
  ipcMain.handle('banger:storage-audio', async (event, token: string, bytes: Uint8Array) => {
    const song = resolve(senderWindow(event), token);
    if (!(bytes instanceof Uint8Array)) throw new Error('Invalid WAV.');
    return storage.saveAudio(song, 'instrumentals', bytes);
  });
  ipcMain.handle('banger:storage-add-library', async (event, name: string, source: string, bytes: Uint8Array, token?: string) => {
    const window = senderWindow(event);
    if (typeof source !== 'string' || !(bytes instanceof Uint8Array)) throw new Error('Invalid song.');
    const song = token ? resolve(window, token) : await storage.prepare(roots.get(window.id), name, source);
    return storage.addToLibrary(song, bytes, source, undefined, 'instrumental');
  });
  ipcMain.handle('banger:storage-draft-read', (event, token: string) => songStorage.readDraft(resolve(senderWindow(event), token)));
  ipcMain.handle('banger:storage-draft-save', (event, token: string, draft: unknown, expected: songStorage.LyricDraft | null) => songStorage.saveDraft(resolve(senderWindow(event), token), draft, expected));
  ipcMain.handle('banger:storage-draft-retire', (event, token: string, expected: songStorage.LyricDraft) => songStorage.retireDraft(resolve(senderWindow(event), token), expected));
  ipcMain.handle('banger:storage-history', (event, token: string) => storage.list(resolve(senderWindow(event), token)));
  ipcMain.handle('banger:storage-library', (event, token: string, scope: 'global' | 'project', selection: LibrarySelection) => storage.copyToLibrary(resolve(senderWindow(event), token), scope, selection));
  return {
    storage, resolve,
    setRoot(window: BrowserWindow, root: string) { watch(window); roots.set(window.id, root); libraries.delete(window.id); },
    async prepare(window: BrowserWindow, name: string) { return storage.prepare(roots.get(window.id), name); },
  };
}
export type SongStorageBridge = ReturnType<typeof installSongStorage>;
