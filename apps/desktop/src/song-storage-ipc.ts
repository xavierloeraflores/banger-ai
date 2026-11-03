import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { createSongStorage, type SongLocation, type LibrarySelection } from './song-storage.js';

export function installSongStorage(senderWindow: (event: IpcMainInvokeEvent) => BrowserWindow) {
  const storage = createSongStorage(app.getPath('userData'));
  const roots = new Map<number, string>();
  const bindings = new Map<string, { window: number; song: SongLocation }>();
  const watched = new Set<number>();
  function watch(window: BrowserWindow) {
    if (watched.has(window.id)) return;
    watched.add(window.id);
    window.once('closed', () => {
      roots.delete(window.id); watched.delete(window.id);
      for (const [key, value] of bindings) if (value.window === window.id) bindings.delete(key);
    });
  }
  function resolve(window: BrowserWindow, token: string) {
    const binding = bindings.get(token);
    if (!binding || binding.window !== window.id) throw new Error('Prepare the song before saving audio.');
    return binding.song;
  }
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
  ipcMain.handle('banger:storage-history', (event, token: string) => storage.list(resolve(senderWindow(event), token)));
  ipcMain.handle('banger:storage-library', (event, token: string, scope: 'global' | 'project', selection: LibrarySelection) => storage.copyToLibrary(resolve(senderWindow(event), token), scope, selection));
  return {
    storage, resolve,
    setRoot(window: BrowserWindow, root: string) { watch(window); roots.set(window.id, root); },
    async prepare(window: BrowserWindow, name: string) { return storage.prepare(roots.get(window.id), name); },
  };
}
export type SongStorageBridge = ReturnType<typeof installSongStorage>;
