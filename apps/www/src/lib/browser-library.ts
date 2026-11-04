import { browserStorageKey } from './browser-account';
import { browserProjectIdentity } from './browser-workspace';
import { browserArtworkCredentials } from './ai-providers';
import { readChats } from './chat-sessions';
import { generateRecordArtwork, artworkContext, type ArtworkContext } from '@banger/agent';
import { librarySongType, type LibrarySongType } from '@banger/elevenlabs/protocol';

export type LibraryRecord = { id: string; name: string; prompt?: string };
type StoredRecord = LibraryRecord & { context: ArtworkContext; attempts: number; leaseUntil?: number; regenerating?: boolean; artwork?: string };
export type LibraryBundle = { id: string; name: string; projectId?: string | null; recordPosition?: number; artworkId?: string; recordId?: string; recordName?: string; artworkPending?: boolean; artworkError?: boolean; artwork?: string; songType?: LibrarySongType; wav: ArrayBuffer; files: Record<string, ArrayBuffer | string>; beat?: { name: string; source: string } };
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
      tx.objectStore('songs').add({ id: crypto.randomUUID(), recordId: record.id, projectId: browserProjectIdentity()?.id ?? null, name, wav, files, beat, songType });
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
      const record = byId.get(song.recordId ?? song.artworkId ?? '');
      return { ...song, projectId: 'projectId' in song ? song.projectId : song.recordId ?? null, recordName: record?.name, artwork: record?.artwork ?? song.artwork, artworkPending: Boolean(record?.regenerating && (record.attempts<3 || (record.leaseUntil ?? 0)>Date.now())), artworkError: Boolean(record?.regenerating && record.attempts>=3 && (record.leaseUntil ?? 0)<=Date.now()) };
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

function libraryName(name: string) {
  if (!name.trim() || name.trim().length > 160) throw new Error('Enter a name from 1 to 160 characters.');
  return name.trim();
}
async function editLibrary(change: (songs: LibraryBundle[], records: StoredRecord[], tx: IDBTransaction) => void) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['songs', 'records'], 'readwrite');
      const songs = tx.objectStore('songs').getAll(), records = tx.objectStore('records').getAll();
      let error: unknown;
      records.onsuccess = () => { try { change(songs.result, records.result, tx); } catch (cause) { error = cause; tx.abort(); } };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(error ?? tx.error); tx.onabort = () => reject(error ?? tx.error);
    });
  } finally { db.close(); }
}
function findSong(songs: LibraryBundle[], id: string) {
  const song = songs.find(item => item.id === id);
  if (!song) throw new Error('Song not found. Refresh the library.');
  return song;
}
export async function renameBrowserSong(id: string, name: string) {
  const next = libraryName(name);
  await editLibrary((songs, _records, tx) => tx.objectStore('songs').put({ ...findSong(songs, id), name: next }));
}
export async function addBrowserSongToRecord(id: string, recordId: string, name?: string) {
  await editLibrary((songs, records, tx) => {
    const song = findSong(songs, id);
    if (!records.some(record => record.id === recordId)) {
      if (!name) throw new Error('Record not found.');
      tx.objectStore('records').add({ id: recordId, name: libraryName(name), context: artworkContext({ name: libraryName(name), source: song.beat?.source }), attempts: 0 });
    }
    tx.objectStore('songs').put({ ...song, projectId: 'projectId' in song ? song.projectId : song.recordId ?? null, recordId, recordPosition: Date.now() });
  });
}
export async function editBrowserRecordSongs(recordId: string, ids: string[]) {
  await editLibrary((songs, records, tx) => {
    if (!records.some(record => record.id === recordId)) throw new Error('Record not found.');
    if (new Set(ids).size !== ids.length) throw new Error('Choose each song once.');
    ids.forEach(id => findSong(songs, id));
    for (const song of songs) {
      const index = ids.indexOf(song.id);
      if (index >= 0 || song.recordId === recordId) tx.objectStore('songs').put({ ...song, projectId: 'projectId' in song ? song.projectId : song.recordId ?? null, recordId: index >= 0 ? recordId : undefined, recordPosition: index >= 0 ? index : undefined });
    }
  });
}
export async function regenerateBrowserSongArtwork(id: string) {
  if (!browserArtworkCredentials()) throw new Error('Add a Meta or Vercel key in AI settings to regenerate artwork.');
  let artworkId = '';
  await editLibrary((songs, records, tx) => {
    const song = findSong(songs, id);
    artworkId = song.artworkId ?? crypto.randomUUID();
    const record = records.find(record => record.id === artworkId);
    if ((record?.leaseUntil ?? 0) > Date.now() || (record?.regenerating && record.attempts < 3)) throw new Error('Artwork is already being generated.');
    tx.objectStore('records').put({ ...record, id: artworkId, name: song.name, artwork: record?.artwork ?? song.artwork, context: record?.context ?? artworkContext({ name: song.name, source: song.beat?.source, lyrics: typeof song.files['lyrics.json'] === 'string' ? song.files['lyrics.json'] : undefined }), attempts: 0, regenerating: true });
    tx.objectStore('songs').put({ ...song, artworkId });
  });
  resumeArtwork(browserStorageKey('banger-library'), artworkId);
}
