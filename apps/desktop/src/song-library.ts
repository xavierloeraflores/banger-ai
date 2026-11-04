import { librarySongType, type LibrarySongType } from '@banger/elevenlabs/protocol';
import { lstat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { songStorage } from '@banger/harness';

type Entry = { id: string; name: string; kind: 'audio' | 'beat'; scope: string; songType: LibrarySongType; artwork?: string };
type File = { root: string; path: string; kind: Entry['kind'] };
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
async function safeRead(root: string, path: string) {
  const parts = relative(root, path).split(sep);
  if (parts.some(part => part === '..' || !part)) throw new Error('Invalid library file.');
  let folder = root;
  for (const part of ['', ...parts.slice(0, -1)]) {
    folder = join(folder, part);
    const stat = await lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Library folders cannot be symbolic links.');
  }
  return songStorage.readRegular(path);
}
export function createSongLibrary(userData: string) {
  let files = new Map<string, File>();
  return {
    async list(project?: string): Promise<Entry[]> {
      const entries: Entry[] = [], next = new Map<string, File>();
      async function scan(root: string, folder: string, scope: string, depth = 0) {
        if (depth > 12) throw new Error('The library has too many nested folders.');
        let children;
        try {
          const stat = await lstat(folder);
          if (!stat.isDirectory() || stat.isSymbolicLink()) return;
          children = await readdir(folder, { withFileTypes: true });
        } catch (error) { if (absent(error)) return; throw error; }
        const names = new Set(children.filter(file => file.isFile()).map(file => file.name));
        for (const child of children) {
          if (child.name.startsWith('.') || ['node_modules', 'dist'].includes(child.name)) continue;
          const path = join(folder, child.name);
          if (child.isDirectory()) { await scan(root, path, scope, depth + 1); continue; }
          if (!child.isFile() || !/\.(banger|wav|mp3)$/i.test(child.name) || /\.instrumental\.wav$/i.test(child.name)) continue;
          const name = child.name.replace(/\.(banger|wav|mp3)$/i, '');
          const kind = child.name.endsWith('.banger') ? 'beat' : 'audio';
          if (kind === 'beat' && (names.has(`${name}.wav`) || names.has(`${name}.mp3`))) continue;
          const id = createHash('sha256').update(path).digest('hex');
          if (next.has(id)) continue;
          let artwork: string | undefined;
          for (const cover of [`${name}.png`, `${name}.jpg`, `${name}.jpeg`, `${name}.webp`, 'cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp']) {
            if (!names.has(cover)) continue;
            const coverPath = join(folder, cover);
            if ((await lstat(coverPath)).size > 5 * 1024 * 1024) continue;
            const bytes = await safeRead(root, coverPath);
            const type = cover.endsWith('.png') ? 'png' : cover.endsWith('.webp') ? 'webp' : 'jpeg';
            artwork = `data:image/${type};base64,${bytes.toString('base64')}`; break;
          }
          async function optionalJson(suffix: string): Promise<unknown> {
            const sidecar = join(folder, `${name}.${suffix}.json`);
            if (!names.has(`${name}.${suffix}.json`) || (await lstat(sidecar)).size > 5 * 1024 * 1024) return undefined;
            const bytes = await safeRead(root, sidecar);
            try { return JSON.parse(bytes.toString('utf8')); } catch { return undefined; }
          }
          const metadata = await optionalJson('library') as { songType?: unknown } | undefined;
          const songType = kind === 'beat' ? 'instrumental' : metadata?.songType === 'vocal' || metadata?.songType === 'instrumental'
            ? metadata.songType : librarySongType(await optionalJson('lyric') ?? await optionalJson('lyrics'));
          next.set(id, { root, path, kind }); entries.push({ id, name, kind, scope, artwork, songType });
          if (entries.length > 1000) throw new Error('The library has more than 1,000 songs. Open a smaller project.');
        }
      }
      await scan(userData, join(userData, 'library'), 'Library');
      if (project) {
        const hidden = join(project, '.banger');
        try { if ((await lstat(hidden)).isDirectory() && !(await lstat(hidden)).isSymbolicLink()) await scan(project, join(hidden, 'library'), 'Project library'); }
        catch (error) { if (!absent(error)) throw error; }
      }
      files = next;
      return entries.sort((a, b) => a.name.localeCompare(b.name));
    },
    async read(id: string) {
      const file = files.get(id);
      if (!file) throw new Error('Refresh the library and select the song again.');
      const bytes = await safeRead(file.root, file.path);
      if (file.kind === 'beat') return { source: bytes.toString('utf8') };
      const beatPath = file.path.replace(/\.(wav|mp3)$/i, '.banger');
      const source = await safeRead(file.root, beatPath).catch(error => { if (absent(error)) return undefined; throw error; });
      const lyricsPath = file.path.replace(/\.(wav|mp3)$/i, '.lyric.json');
      const lyricsBytes = await safeRead(file.root, lyricsPath).catch(error => { if (absent(error)) return safeRead(file.root, lyricsPath.replace(/\.lyric\.json$/, '.lyrics.json')).catch(error => { if (absent(error)) return undefined; throw error; }); throw error; });
      // A missing or damaged optional sidecar must not prevent audio playback.
      let lyrics: unknown;
      if (lyricsBytes && lyricsBytes.length <= 5 * 1024 * 1024) {
        try { lyrics = JSON.parse(lyricsBytes.toString('utf8')); } catch { /* Display the missing-timings state. */ }
      }
      return { bytes, lyrics, contentType: file.path.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav', beat: source ? { name: beatPath.split(sep).pop()!, source: source.toString('utf8') } : undefined };
    },
  };
}
