import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { writeFile, rename, lstat } from 'node:fs/promises';
import { songStorage } from '@banger/harness';
import { artworkContext, validateArtwork, type ArtworkContext } from '@banger/agent';
const { directory, readRegular } = songStorage;
export type RecordIdentity = { id: string; name: string; prompt?: string };
export const validRecordId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id);
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
// A project keeps its identity when renamed or moved. Exclusive creation handles concurrent exports.
const projectQueues = new Map<string, Promise<unknown>>();
export function projectRecord(root: string, prompt?: string): Promise<RecordIdentity> {
  const task = (projectQueues.get(root) ?? Promise.resolve()).catch(() => {}).then(() => readProjectRecord(root, prompt));
  projectQueues.set(root, task);
  void task.finally(() => { if (projectQueues.get(root) === task) projectQueues.delete(root); }).catch(() => {});
  return task;
}
async function readProjectRecord(root: string, prompt?: string): Promise<RecordIdentity> {
  const folder = await directory(root, ['.banger']);
  const path = join(folder, 'record.json');
  const initial = { id: randomUUID(), name: basename(root).slice(0, 160), ...(prompt ? { prompt: prompt.slice(0, 16000) } : {}) };
  await writeFile(path, JSON.stringify(initial), { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  if ((await lstat(path)).size > 100000) throw new Error('Invalid record metadata.');
  const value = JSON.parse((await readRegular(path)).toString());
  if (!validRecordId(value.id) || typeof value.name !== 'string' || value.name.length > 160) throw new Error('Invalid record metadata.');
  // Capture the first agent prompt even if the project was exported before using an agent.
  if (prompt && !value.prompt) {
    const promptPath = join(folder, 'record-prompt.txt');
    await writeFile(promptPath, prompt.slice(0, 16000), { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
  const saved = await readRegular(join(folder, 'record-prompt.txt')).catch(error => { if (absent(error)) return undefined; throw error; });
  return { id: value.id, name: value.name, prompt: typeof value.prompt === 'string' ? value.prompt.slice(0, 16000) : saved?.toString().slice(0, 16000) };
}
type SavedRecord = { id: string; name: string; context: ArtworkContext; artwork?: string; attempts: number };
export function createLibraryRecords(userData: string, generate?: (context: ArtworkContext) => Promise<string | undefined>) {
  const pending = new Map<string, Promise<void>>();
  async function path(id: string) {
    if (!validRecordId(id)) throw new Error('Invalid record ID.');
    return join(await directory(userData, ['records']), `${id}.json`);
  }
  async function read(id: string): Promise<SavedRecord | undefined> {
    const file = await path(id);
    try {
      if ((await lstat(file)).size > 8 * 1024 * 1024) throw new Error('Record metadata is too large.');
      const value = JSON.parse((await readRegular(file)).toString());
      if (value.id !== id || typeof value.name !== 'string' || value.name.length > 160 || !Number.isInteger(value.attempts) || value.attempts < 0) throw new Error('Invalid record metadata.');
      if (value.artwork) validateArtwork(value.artwork);
      return value;
    } catch (error) { if (absent(error)) return undefined; throw error; }
  }
  async function save(value: SavedRecord) {
    const file = await path(value.id), temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await rename(temporary, file);
  }
  function resume(id: string) {
    if (!generate || pending.has(id)) return;
    const task = (async () => {
      const value = await read(id);
      if (!value || value.artwork || value.attempts >= 3) return;
      // Persist attempts before calling the provider so restart loops are bounded.
      await save({ ...value, attempts: value.attempts + 1 });
      try {
        const artwork = await generate(value.context);
        await save({ ...value, attempts: artwork ? value.attempts + 1 : value.attempts, ...(artwork ? { artwork: validateArtwork(artwork) } : {}) });
      } catch { /* Song remains playable; a later refresh retries up to the cap. */ }
    })().catch(() => {}).finally(() => { pending.delete(id); });
    pending.set(id, task);
  }
  return {
    async ensure(record: RecordIdentity, context: ArtworkContext) {
      const file = await path(record.id);
      await writeFile(file, JSON.stringify({ id: record.id, name: record.name, context: artworkContext({ ...context, prompt: record.prompt ?? context.prompt }), attempts: 0 }), { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      resume(record.id);
    },
    async get(id: string) { const value = await read(id); resume(id); return value; },
    async settled() { await Promise.all(pending.values()); },
  };
}
