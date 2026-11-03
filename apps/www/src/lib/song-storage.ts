export type LibrarySelection = { audio: string; instrumental?: string; lyrics?: string };
declare global {
  interface Window {
    bangerStorage?: {
      prepare(name: string, source?: string): Promise<string>;
      audio(token: string, bytes: Uint8Array): Promise<string>;
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
