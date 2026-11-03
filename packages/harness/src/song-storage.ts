import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type SongLocation = { root: string; name: string };
export type AudioKind = 'instrumentals' | 'vocals';
export function songName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Choose a song name.');
  const name = value.replace(/\.(banger|wav|mp3)$/i, '');
  if (!name || name.startsWith('.') || /[\\/<>:"|?*]/.test(name) || Array.from(name).some(char => char.charCodeAt(0) < 32) || /[. ]$/.test(name) || Buffer.byteLength(name) > 180) throw new Error('Use a song name without folders or special characters.');
  return name;
}
// Check every directory, including hidden storage, rather than following user-created links.
export async function directory(root: string, parts: string[] = []) {
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
export async function readRegular(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 100 * 1024 * 1024) throw new Error('Choose a regular song file under 100 MiB.');
    return await file.readFile();
  } finally { await file.close(); }
}
async function atomic(path: string, bytes: string | Uint8Array, beforeCommit?: () => Promise<void>) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
    await beforeCommit?.();
    await rename(temp, path);
  }
  finally { await rm(temp, { force: true }); }
}
export async function history(song: SongLocation, kind: AudioKind | 'lyrics') {
  songName(song.name);
  return directory(song.root, ['.banger', 'history', song.name, kind]);
}
export async function append(song: SongLocation, kind: AudioKind | 'lyrics', bytes: Uint8Array | string) {
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

// Desktop generation and agent edits share a queue and the same revision workflow.
const queues = new Map<string, Promise<unknown>>();
export function saveLyrics(song: SongLocation, document: unknown, beforeSave?: () => Promise<void>): Promise<string> {
  const key = join(song.root, song.name);
  const task = (queues.get(key) ?? Promise.resolve()).then(async () => {
    const json = JSON.stringify(document, null, 2) + '\n';
    if (Buffer.byteLength(json) > 5 * 1024 * 1024) throw new Error('Lyrics are too large.');
    await beforeSave?.();
    const revision = await append(song, 'lyrics', json);
    try {
      await atomic(join(song.root, `${song.name}.lyrics.json`), json, beforeSave);
    } catch (error) {
      await rm(join(song.root, '.banger', 'history', song.name, 'lyrics', revision));
      throw error;
    }
    return revision;
  });
  const settled = task.catch(() => undefined);
  queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return task;
}
