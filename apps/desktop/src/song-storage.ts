import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { songStorage as storage } from '@banger/harness';
import { validateWav } from '@banger/elevenlabs';
import { validateSource } from './project-files.js';

export type SongLocation = { root: string; name: string };
export type AudioKind = 'instrumentals' | 'vocals';
export type LibrarySelection = { audio: string; instrumental?: string; lyrics?: string };
export const songName = storage.songName;
const { directory, readRegular, history, append } = storage;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export function createSongStorage(userData: string) {
  const queues = new Map<string, Promise<unknown>>();
  function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const task = (queues.get(key) ?? Promise.resolve()).then(work);
    const settled = task.catch(() => undefined); queues.set(key, settled);
    void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
    return task;
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
    saveLyrics(song: SongLocation, document: unknown): Promise<string> { return storage.saveLyrics(song, document); },
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
      let source: Uint8Array | undefined = await readRegular(join(await directory(song.root), `${song.name}.banger`)).catch(error => { if (missing(error)) return undefined; throw error; });
      const lyrics = selection.lyrics ? await selected(selection.lyrics, 'lyrics') : await readRegular(join(song.root, `${song.name}.lyrics.json`)).catch(error => { if (missing(error)) return undefined; throw error; });
      const parsed = lyrics ? JSON.parse(lyrics.toString()) : undefined;
      if (parsed?.beat?.source !== undefined) source = Buffer.from(validateSource(parsed.beat.source));
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
