import type { BangerFile } from '@banger/agent/protocol';
import type { MusicOperation, MusicVersion } from '@banger/elevenlabs/protocol';
import type { MusicBackend } from './elevenlabs';

export type FullSendRequest = { file: BangerFile; vocals: boolean };
export type FullSend = (input: FullSendRequest, signal: AbortSignal, progress: (text: string) => void) => Promise<string>;

export function assertLyricsPreserved(original: string, edits: { index: number; lyrics: string }[]) {
  const words = (text: string) => text.replace(/\[[^\]]*\]|\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
  const fitted = [...edits].sort((a, b) => a.index - b.index).map(edit => edit.lyrics).join('\n');
  if (words(original) !== words(fitted)) throw new Error('Fitting changed the saved lyrics. Full Send stopped before vocal generation; review the lyrics in Vocal Studio.');
}

/** Only an acknowledged operation may feed the next paid request. */
export async function waitForMusic(backend: MusicBackend, operation: MusicOperation, signal: AbortSignal, progress: (text: string) => void, timeoutMs = 600_000): Promise<MusicVersion> {
  const deadline = Date.now() + timeoutMs;
  let latest = operation;
  for (;;) {
    signal.throwIfAborted();
    progress(latest.stage);
    if (latest.status === 'completed') {
      const version = await backend.get(latest.musicId);
      signal.throwIfAborted();
      if (version.version !== latest.resultVersion) throw new Error('The composition changed during Full Send. Review it before continuing.');
      return version;
    }
    if (['failed', 'needs_review', 'conflict'].includes(latest.status)) throw new Error(latest.error || `Full Send stopped: ${latest.status}.`);
    if (Date.now() >= deadline) throw new Error('The music request is still pending. Check Vocal Studio before retrying Full Send.');
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 300);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    latest = (await backend.operations()).find(item => item.id === operation.id) ?? latest;
  }
}
