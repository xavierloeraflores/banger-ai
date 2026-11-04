import { browserStorageKey } from './browser-account';
import { browserProjectIdentity } from './browser-workspace';
import { browserArtworkCredentials } from './ai-providers';
import { readChats } from './chat-sessions';
import { generateRecordArtwork, artworkContext, type ArtworkContext } from '@banger/agent';
import { librarySongType, type LibrarySongType } from '@banger/elevenlabs/protocol';

export type LibraryRecord = { id: string; name: string; prompt?: string };
type StoredRecord = LibraryRecord & { context: ArtworkContext; attempts: number; leaseUntil?: number; regenerating?: boolean; artwork?: string };
export type LibraryBundle = { id: string; name: string; recordId?: string; recordName?: string; artworkPending?: boolean; artworkError?: boolean; artwork?: string; songType?: LibrarySongType; wav: ArrayBuffer; files: Record<string, ArrayBuffer | string>; beat?: { name: string; source: string } };
export function captureLibraryRecord(name: string): LibraryRecord {
  const project = browserProjectIdentity();
  const chat = project ? readChats().find(chat => chat.snapshot.folder?.id === project.id) : undefined;
  return { id: project?.id ?? crypto.randomUUID(), name: (project?.name ?? name).slice(0,160), prompt: chat?.history?.turns[0]?.prompt ?? chat?.history?.prompt };
}
function database(key = browserStorageKey('banger-library')): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(key, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('songs')) request.result.createObjectStore('songs', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('records')) request.result.createObjectStore('records', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const pending = new Set<string>();
function resumeArtwork(key: string, id: string) {
  const taskKey = `${key}:${id}`;
  if (pending.has(taskKey)) return;
  const credentials = browserArtworkCredentials();
  if (!credentials) return;
  pending.add(taskKey);
  void (async () => {
    const db = await database(key);
    try {
      const record = await new Promise<StoredRecord | undefined>((resolve,reject) => {
        const tx = db.transaction('records','readwrite'), store = tx.objectStore('records');
        const request = store.get(id); let claimed: StoredRecord | undefined;
        request.onsuccess = () => {
          const value = request.result as StoredRecord | undefined;
          if(value && (!value.artwork || value.regenerating) && value.attempts < 3 && (value.leaseUntil ?? 0) < Date.now()) {
            claimed = { ...value, attempts: value.attempts + 1, leaseUntil: Date.now() + 300000 }; store.put(claimed);
          }
        };
        tx.oncomplete = () => resolve(claimed); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
      if (!record) return;
      let artwork: string | undefined;
      try { artwork = await generateRecordArtwork({ ...record.context, name: record.name }, credentials); } catch { /* Keep songs available without a cover. */ }
      await new Promise<void>((resolve,reject) => {
        const tx = db.transaction('records','readwrite');
        const store = tx.objectStore('records'), request = store.get(id);
        request.onsuccess = () => {
          const current = request.result as StoredRecord | undefined;
          if (current?.leaseUntil === record.leaseUntil) store.put({ ...current, ...(artwork ? { artwork, regenerating: false } : {}), leaseUntil: 0 });
        };
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  })().catch(() => {}).finally(() => pending.delete(taskKey));
}
export async function saveLibraryBundle(name: string, wav: ArrayBuffer, files: LibraryBundle['files'], beat?: LibraryBundle['beat'], songType: LibrarySongType = librarySongType(files['lyrics.json']), record = captureLibraryRecord(name)) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(record.id)) throw new Error('Invalid record ID.');
  const key = browserStorageKey('banger-library'), db = await database(key);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['songs','records'], 'readwrite');
      tx.objectStore('songs').add({ id: crypto.randomUUID(), recordId: record.id, name, wav, files, beat, songType });
      const records = tx.objectStore('records'), existing = records.get(record.id);
      existing.onsuccess = () => { if(!existing.result) records.add({ id: record.id, name: record.name.slice(0,160), attempts: 0, context: artworkContext({ name: record.name, prompt: record.prompt, source: beat?.source, lyrics: typeof files['lyrics.json'] === 'string' ? files['lyrics.json'] : undefined }) }); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Library save failed.'));
    });
  } finally { db.close(); }
  resumeArtwork(key, record.id);
}
export async function browserLibrarySongs(): Promise<LibraryBundle[]> {
  const key = browserStorageKey('banger-library'), db = await database(key);
  try {
    const [songs, records] = await Promise.all([
      new Promise<LibraryBundle[]>((resolve,reject) => { const r=db.transaction('songs').objectStore('songs').getAll(); r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); }),
      new Promise<StoredRecord[]>((resolve,reject) => { const r=db.transaction('records').objectStore('records').getAll(); r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); }),
    ]);
    const byId = new Map(records.map(record=>[record.id,record]));
    for(const record of records)if((!record.artwork || record.regenerating) && record.attempts<3)resumeArtwork(key,record.id);
    return songs.map(song => {
      const record = byId.get(song.recordId ?? '');
      return { ...song, recordName: record?.name, artwork: record?.artwork ?? song.artwork, artworkPending: Boolean(record?.regenerating && (record.attempts<3 || (record.leaseUntil ?? 0)>Date.now())), artworkError: Boolean(record?.regenerating && record.attempts>=3 && (record.leaseUntil ?? 0)<=Date.now()) };
    });
  } finally { db.close(); }
}

async function updateRecord(key: string, id: string, update: (value: StoredRecord) => StoredRecord) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('Invalid record ID.');
  const db = await database(key);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite'), store = tx.objectStore('records'), request = store.get(id);
      let error: unknown;
      request.onsuccess = () => {
        try {
          if (!request.result) throw new Error('Record not found.');
          store.put(update(request.result));
        } catch (cause) { error = cause; tx.abort(); }
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(error ?? tx.error); tx.onabort = () => reject(error ?? tx.error);
    });
  } finally { db.close(); }
}
export async function renameBrowserRecord(id: string, name: string) {
  if (!name.trim() || name.trim().length>160) throw new Error('Enter a record name from 1 to 160 characters.');
  await updateRecord(browserStorageKey('banger-library'), id, value => ({ ...value, name: name.trim() }));
}
export async function regenerateBrowserArtwork(id: string) {
  if (!browserArtworkCredentials()) throw new Error('Add a Meta or Vercel key in AI settings to regenerate artwork.');
  const key = browserStorageKey('banger-library');
  await updateRecord(key, id, value => {
    if ((value.leaseUntil ?? 0)>Date.now() || (value.regenerating && value.attempts<3)) throw new Error('Artwork is already being generated.');
    return { ...value, attempts: 0, regenerating: true };
  });
  resumeArtwork(key, id);
}
