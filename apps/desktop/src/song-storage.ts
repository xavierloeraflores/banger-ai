import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateWav } from '@banger/elevenlabs';
import { validateSource } from './project-files.js';

export type SongLocation = { root: string; name: string };
export type AudioKind = 'instrumentals' | 'vocals';
export type LibrarySelection = { audio: string; instrumental?: string; lyrics?: string };
export function songName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Choose a song name.');
  const name = value.replace(/\.(banger|wav|mp3)$/i, '');
  if (!name || name.startsWith('.') || /[\\/<>:"|?*]/.test(name) || Array.from(name).some(char => char.charCodeAt(0) < 32) || /[. ]$/.test(name) || Buffer.byteLength(name) > 180) throw new Error('Use a song name without folders or special characters.');
  return name;
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
// Check every directory, including hidden storage, rather than following user-created links.
async function directory(root: string, parts: string[] = []) {
  if (!(await lstat(root)).isDirectory()) throw new Error('Reopen the project folder.');
  let path = await realpath(root);
  for (const part of parts) {
    path = join(path, part);
    await mkdir(path).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Storage folders cannot be symbolic links.');
  }
  return path;
}
async function readRegular(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 100 * 1024 * 1024) throw new Error('Choose a regular song file under 100 MiB.');
    return await file.readFile();
  } finally { await file.close(); }
}
async function atomic(path: string, bytes: string | Uint8Array) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
export function createSongStorage(userData: string) {
  const queues = new Map<string, Promise<unknown>>();
  function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const task = (queues.get(key) ?? Promise.resolve()).then(work);
    const settled = task.catch(() => undefined); queues.set(key, settled);
    void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
    return task;
  }
  async function history(song: SongLocation, kind: AudioKind | 'lyrics') {
    songName(song.name);
    return directory(song.root, ['.banger', 'history', song.name, kind]);
  }
  async function append(song: SongLocation, kind: AudioKind | 'lyrics', bytes: Uint8Array | string) {
    const folder = await history(song, kind);
    const prefix = kind === 'lyrics' ? 'lyrics' : `${song.name}.${kind === 'vocals' ? 'vocals' : 'instrumental'}`;
    const extension = kind === 'lyrics' ? 'json' : 'wav';
    const entries = await readdir(folder);
    let version = 1 + Math.max(0, ...entries.map(name => name.startsWith(`${prefix}-v`) && name.endsWith(`.${extension}`) ? Number(name.slice(prefix.length + 2, -extension.length - 1)) || 0 : 0));
    const temporary = join(folder, `.pending-${randomUUID()}`);
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      for (;;) {
        const name = `${prefix}-v${String(version++).padStart(3, '0')}.${extension}`;
        try { await link(temporary, join(folder, name)); return name; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
    } finally { await rm(temporary, { force: true }); }
  }
  return {
    async prepare(root: string | undefined, name: string, source?: string): Promise<SongLocation> {
      name = songName(name);
      if (!root) { await directory(userData, ['projects']); root = await directory(userData, ['projects', name]); }
      root = await directory(root);
      if (source !== undefined) {
        validateSource(source);
        await writeFile(join(root, `${name}.banger`), source, { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      }
      return { root, name };
    },
    saveLyrics(song: SongLocation, document: unknown) {
      return locked(join(song.root, song.name), async () => {
        const json = JSON.stringify(document, null, 2) + '\n';
        if (Buffer.byteLength(json) > 5 * 1024 * 1024) throw new Error('Lyrics are too large.');
        const revision = await append(song, 'lyrics', json);
        await atomic(join(song.root, `${song.name}.lyrics.json`), json);
        return revision;
      });
    },
    async saveAudio(song: SongLocation, kind: AudioKind, bytes: Uint8Array) {
      if (kind !== 'instrumentals' && kind !== 'vocals') throw new Error('Choose instrumental or vocal history.');
      validateWav(bytes, false);
      return append(song, kind, bytes);
    },
    async list(song: SongLocation) {
      const result = { instrumentals: [] as string[], vocals: [] as string[], lyrics: [] as string[] };
      for (const kind of ['instrumentals', 'vocals', 'lyrics'] as const) result[kind] = (await readdir(await history(song, kind))).filter(name => /-v\d+\.(wav|json)$/.test(name)).sort();
      return result;
    },
    async copyToLibrary(song: SongLocation, scope: 'global' | 'project', selection: LibrarySelection) {
      songName(song.name);
      if (scope !== 'global' && scope !== 'project') throw new Error('Choose a library destination.');
      async function selected(value: string, kind?: AudioKind | 'lyrics') {
        if (typeof value !== 'string') throw new Error('Choose a saved revision.');
        const parts = value.split('/');
        const folder = kind ?? parts.shift();
        if (!['instrumentals', 'vocals', 'lyrics'].includes(folder!) || parts.length !== 1 || !/^[^/\\]+-v\d+\.(wav|json)$/.test(parts[0]!) || parts[0]!.startsWith('.')) throw new Error('Choose a saved history revision.');
        return readRegular(join(await history(song, folder as AudioKind | 'lyrics'), parts[0]!));
      }
      const audio = await selected(selection.audio); validateWav(audio, false);
      const source = await readRegular(join(await directory(song.root), `${song.name}.banger`)).catch(error => { if (missing(error)) return undefined; throw error; });
      const lyrics = selection.lyrics ? await selected(selection.lyrics, 'lyrics') : await readRegular(join(song.root, `${song.name}.lyrics.json`)).catch(error => { if (missing(error)) return undefined; throw error; });
      const parsed = lyrics ? JSON.parse(lyrics.toString()) : undefined;
      const hasLyrics = Boolean(parsed?.plan?.chunks?.some((chunk: { text: string }) => chunk.text.replace(/\[[^\]]*\]|\{[^}]*\}/g, '').trim()));
      if (hasLyrics && !selection.instrumental) throw new Error('Choose an instrumental revision for this song with lyrics.');
      const instrumental = selection.instrumental ? await selected(selection.instrumental, 'instrumentals') : undefined;
      if (instrumental) validateWav(instrumental, false);
      const library = scope === 'global' ? await directory(userData, ['library']) : await directory(song.root, ['.banger', 'library']);
      return locked(join(library, song.name), async () => {
        const target = join(library, song.name);
        // Existing entries are never silently replaced by a later selection.
        await mkdir(target);
        try {
          await writeFile(join(target, `${song.name}.wav`), audio, { flag: 'wx' });
          if (instrumental) await writeFile(join(target, `${song.name}.instrumental.wav`), instrumental, { flag: 'wx' });
          if (source) await writeFile(join(target, `${song.name}.banger`), source, { flag: 'wx' });
          if (lyrics) await writeFile(join(target, `${song.name}.lyrics.json`), lyrics, { flag: 'wx' });
          return { name: song.name, scope };
        } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
      });
    },
  };
}
