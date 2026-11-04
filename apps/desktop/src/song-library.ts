import { createLibraryRecords, validRecordId } from './library-records.js';
import { librarySongType, type LibrarySongType } from '@banger/elevenlabs/protocol';
import { lstat, readdir, writeFile, rename } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { songStorage } from '@banger/harness';

type Entry = { id: string; name: string; kind: 'audio' | 'beat'; scope: string; songType: LibrarySongType; projectId?: string; recordPosition?: number; recordId?: string; recordName?: string; artworkPending?: boolean; artworkError?: boolean; artwork?: string };
type File = { root: string; path: string; kind: Entry['kind'] };
type Edit = { name?: string; recordId?: string | null; recordPosition?: number; artworkId?: string };
const writes = new Map<string, Promise<unknown>>();
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
export function createSongLibrary(userData: string, records = createLibraryRecords(userData)) {
  let files = new Map<string, File>();
  let listed = new Map<string, Entry>();
  async function edits(): Promise<Record<string, Edit>> {
    return JSON.parse((await songStorage.readRegular(join(userData, 'library-edits.json')).catch(error => { if (absent(error)) return Buffer.from('{}'); throw error; })).toString());
  }
  function update(action: (values: Record<string, Edit>) => Promise<void> | void) {
    const task = (writes.get(userData) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const values = await edits(); await action(values);
      const file = join(await songStorage.directory(userData), 'library-edits.json'), temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(values), { flag: 'wx', mode: 0o600 }); await rename(temporary, file);
    });
    writes.set(userData, task);
    void task.finally(() => { if (writes.get(userData) === task) writes.delete(userData); }).catch(() => {});
    return task;
  }
  function entry(id: string) {
    const value = listed.get(id);
    if (!value) throw new Error('Refresh the library and select the song again.');
    return value;
  }
  function validateName(name: string) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 160) throw new Error('Enter a name from 1 to 160 characters.');
    return name.trim();
  }
  return {
    async list(project?: string): Promise<Entry[]> {
      const overrides = await edits();
      const projectIds = new Map<string, string>(), projectRoots = new Map<string, string>();
      const recents: { id: string; root: string }[] = await songStorage.readRegular(join(userData, 'recent-projects.json')).then(bytes => {
        const value: unknown = JSON.parse(bytes.toString());
        return Array.isArray(value) ? value.filter(item => typeof item?.id === 'string' && typeof item?.root === 'string') : [];
      }).catch(() => []);
      for (const recent of recents) {
        try {
          if (!(await lstat(recent.root)).isDirectory()) continue;
          projectRoots.set(recent.root, recent.id);
          const identity = JSON.parse((await safeRead(recent.root, join(recent.root, '.banger', 'record.json'))).toString());
          if (validRecordId(identity.id)) projectIds.set(identity.id, recent.id);
        } catch { /* A moved or missing project has no open action. */ }
      }
      const recordCache = new Map<string, ReturnType<typeof records.get>>();
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
          const metadata = await optionalJson('library') as { songType?: unknown; record?: { id?: unknown; name?: unknown } } | undefined;
          const songType = kind === 'beat' ? 'instrumental' : metadata?.songType === 'vocal' || metadata?.songType === 'instrumental'
            ? metadata.songType : librarySongType(await optionalJson('lyric') ?? await optionalJson('lyrics'));
          const originalRecordId = validRecordId(metadata?.record?.id) ? metadata.record.id : undefined;
          const edit = overrides[id];
          const recordId = edit?.recordId === null ? undefined : edit?.recordId ?? originalRecordId;
          const artworkId = recordId ?? edit?.artworkId;
          if (artworkId && !recordCache.has(artworkId)) recordCache.set(artworkId, records.get(artworkId).catch(() => undefined));
          const record = artworkId ? await recordCache.get(artworkId) : undefined;
          const recordName = record?.name ?? (typeof metadata?.record?.name === 'string' ? metadata.record.name.slice(0, 160) : name);
          if (artworkId) artwork = record?.artwork ?? artwork;
          next.set(id, { root, path, kind }); entries.push({ id, name: edit?.name ?? name, projectId: (originalRecordId ? projectIds.get(originalRecordId) : undefined) ?? projectRoots.get(root), recordPosition: edit?.recordPosition, kind, scope, artwork, songType, recordId, recordName: recordId ? recordName : undefined, artworkPending: Boolean(record?.regenerating && (record.attempts < 3 || record.generating)), artworkError: Boolean(record?.regenerating && record.attempts >= 3 && !record.generating) });
          if (entries.length > 1000) throw new Error('The library has more than 1,000 songs. Open a smaller project.');
        }
      }
      await scan(userData, join(userData, 'library'), 'Library');
      if (project) {
        const hidden = join(project, '.banger');
        try { if ((await lstat(hidden)).isDirectory() && !(await lstat(hidden)).isSymbolicLink()) await scan(project, join(hidden, 'library'), 'Project library'); }
        catch (error) { if (!absent(error)) throw error; }
      }
      files = next; listed = new Map(entries.map(item => [item.id, item]));
      return entries.sort((a, b) => a.name.localeCompare(b.name));
    },
    async renameSong(id: string, name: string) {
      entry(id); const next = validateName(name);
      await update(values => { values[id] = { ...values[id], name: next }; });
    },
    async addToRecord(id: string, recordId: string, name?: string) {
      entry(id);
      if (name !== undefined) await records.ensure({ id: recordId, name: validateName(name) }, { name: validateName(name) });
      else if (!await records.get(recordId)) throw new Error('Record not found.');
      await update(values => { values[id] = { ...values[id], recordId, recordPosition: Date.now() }; });
    },
    async editRecordSongs(recordId: string, ids: string[]) {
      if (!await records.get(recordId)) throw new Error('Record not found.');
      if (!Array.isArray(ids) || ids.length > 1000 || new Set(ids).size !== ids.length) throw new Error('Choose each song once.');
      ids.forEach(entry);
      await update(values => {
        for (const song of listed.values()) {
          const current = values[song.id]?.recordId === null ? undefined : values[song.id]?.recordId ?? song.recordId;
          if (current === recordId && !ids.includes(song.id)) values[song.id] = { ...values[song.id], recordId: null, recordPosition: undefined };
        }
        ids.forEach((id, index) => { values[id] = { ...values[id], recordId, recordPosition: index }; });
      });
    },
    async regenerateSongArtwork(id: string) {
      const song = entry(id);
      let artworkId = '';
      await update(async values => {
        artworkId = values[id]?.artworkId ?? randomUUID();
        await records.ensure({ id: artworkId, name: values[id]?.name ?? song.name }, { name: values[id]?.name ?? song.name }, { artwork: song.artwork, generate: false });
        values[id] = { ...values[id], artworkId };
      });
      await records.rename(artworkId, (await edits())[id]?.name ?? song.name);
      await records.regenerate(artworkId);
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
