import { browserStorageKey } from './browser-account';
import { browserProjectIdentity } from './browser-workspace';
import { browserArtworkCredentials } from './ai-providers';
import { readChats } from './chat-sessions';
import { generateRecordArtwork, artworkContext, type ArtworkContext } from '@banger/agent';
import { librarySongType, type LibrarySongType } from '@banger/elevenlabs/protocol';

export type LibraryRecord = { id: string; name: string; prompt?: string };
type StoredRecord = LibraryRecord & { context: ArtworkContext; attempts: number; leaseUntil?: number; artwork?: string };
export type LibraryBundle = { id: string; name: string; recordId?: string; recordName?: string; artwork?: string; songType?: LibrarySongType; wav: ArrayBuffer; files: Record<string, ArrayBuffer | string>; beat?: { name: string; source: string } };
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
          if(value && !value.artwork && value.attempts < 3 && (value.leaseUntil ?? 0) < Date.now()) {
            claimed = { ...value, attempts: value.attempts + 1, leaseUntil: Date.now() + 300000 }; store.put(claimed);
          }
        };
        tx.oncomplete = () => resolve(claimed); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
      if (!record) return;
      let artwork: string | undefined;
      try { artwork = await generateRecordArtwork(record.context, credentials); } catch { /* Keep songs available without a cover. */ }
      await new Promise<void>((resolve,reject) => {
        const tx = db.transaction('records','readwrite');
        tx.objectStore('records').put({ ...record, artwork, leaseUntil: 0 });
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
    for(const record of records)if(!record.artwork && record.attempts<3)resumeArtwork(key,record.id);
    return songs.map(song=>({ ...song, recordId: song.recordId ?? song.id, recordName: byId.get(song.recordId ?? '')?.name ?? song.name, artwork: byId.get(song.recordId ?? '')?.artwork }));
  } finally { db.close(); }
}
