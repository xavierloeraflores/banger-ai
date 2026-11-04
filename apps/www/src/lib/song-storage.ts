import { browserStorageKey } from "./browser-account";
export type LyricDraft = { schemaVersion: 1; lyrics: string; vocalStyle?: string };
export type LibrarySelection = { audio: string; instrumental?: string; lyrics?: string };
declare global {
  interface Window {
    bangerStorage?: {
      addToLibrary(name: string, source: string, bytes: Uint8Array): Promise<{ name: string }>;
      prepare(name: string, source?: string): Promise<string>;
      audio(token: string, bytes: Uint8Array): Promise<string>;
      readDraft(token: string): Promise<LyricDraft | null>;
      saveDraft(token: string, draft: LyricDraft, expected: LyricDraft | null): Promise<void>;
      retireDraft(token: string, expected: LyricDraft): Promise<void>;
      history(token: string): Promise<{ instrumentals: string[]; vocals: string[]; lyrics: string[] }>;
      copyToLibrary(token: string, scope: 'global' | 'project', selection: LibrarySelection): Promise<{ name: string; scope: string }>;
    };
  }
}
/** Capture the native project before rendering or starting a provider request. */
export async function prepareSong(name: string, source?: string) {
  return window.bangerStorage?.prepare(name, source);
}
export async function archiveWav(token: string | undefined, wav: ArrayBuffer) {
  if (token) await window.bangerStorage!.audio(token, new Uint8Array(wav));
}

export function draftStorage(key: string, token?: string) {
  if (token && window.bangerStorage) {
    const bridge = window.bangerStorage;
    return { read: () => bridge.readDraft(token), save: (draft: LyricDraft, expected: LyricDraft | null) => bridge.saveDraft(token, draft, expected), retire: (draft: LyricDraft) => bridge.retireDraft(token, draft) };
  }
  const path = browserStorageKey(`banger:lyric-draft:${key}`);
  const read = async (): Promise<LyricDraft | null> => JSON.parse(localStorage.getItem(path) ?? 'null');
  return { read, async save(draft: LyricDraft, expected: LyricDraft | null) {
    if (localStorage.getItem(`${path}:retired`)) throw new Error('This draft has been retired. Edit the chunk lyrics instead.');
    if (JSON.stringify(await read()) !== JSON.stringify(expected)) throw new Error('The draft changed. Try again.');
    localStorage.setItem(path, JSON.stringify(draft));
  }, async retire(draft: LyricDraft) {
    if (JSON.stringify(await read()) !== JSON.stringify(draft)) throw new Error('The draft changed. Try again.');
    localStorage.setItem(`${path}:retired`, 'true'); localStorage.removeItem(path);
  } };
}
