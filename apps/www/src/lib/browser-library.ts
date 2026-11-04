export type LibraryBundle = { id: string; name: string; wav: ArrayBuffer; files: Record<string, ArrayBuffer | string>; beat?: { name: string; source: string } };
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('banger-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('songs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveLibraryBundle(name: string, wav: ArrayBuffer, files: LibraryBundle['files'], beat?: LibraryBundle['beat']) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('songs', 'readwrite');
      tx.objectStore('songs').add({ id: crypto.randomUUID(), name, wav, files, beat });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Library save failed.'));
    });
  } finally { db.close(); }
}
export async function browserLibrarySongs(): Promise<LibraryBundle[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('songs').objectStore('songs').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
