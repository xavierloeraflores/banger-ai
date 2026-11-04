import { audioMetadataSchema, planSchema } from '@banger/elevenlabs/protocol';

export type TimedWord = { word: string; startMs: number; endMs: number };
export type LyricLine = { words: TimedWord[]; startMs: number; endMs: number };
export type SingAlongData = { lines: LyricLine[]; waveform: number[]; lyrics: string };
const normalized = (word: string) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Recorded word timings remain authoritative even when the composition has a newer lyric draft. */
export function readSingAlong(document: unknown): SingAlongData {
  const empty: SingAlongData = { lines: [], waveform: [], lyrics: '' };
  if (typeof document === 'string') {
    try { document = JSON.parse(document); } catch { return empty; }
  }
  if (!document || typeof document !== 'object') return empty;
  const record = document as Record<string, unknown>;
  const metadata = audioMetadataSchema.safeParse(record.audioMetadata);
  const plan = planSchema.safeParse(record.plan);
  const textLines = plan.success ? plan.data.chunks.flatMap(chunk => chunk.text.replace(/\[[^\]]*\]|\{[^}]*\}/g, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)) : [];
  const words = (metadata.success ? metadata.data.wordsTimestamps ?? [] : [])
    .filter(word => word.word.trim() && word.endMs > word.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const lines: LyricLine[] = [];
  const addLine = (items: TimedWord[]) => {
    if (items.length) lines.push({ words: items, startMs: items[0]!.startMs, endMs: Math.max(...items.map(word => word.endMs)) });
  };
  const tokens = textLines.flatMap(line => line.split(/\s+/));
  // Preserve written line breaks only if the text matches the recorded performance.
  if (words.length && tokens.length === words.length && tokens.every((word, i) => normalized(word) === normalized(words[i]!.word))) {
    let offset = 0;
    for (const line of textLines) {
      const length = line.split(/\s+/).length;
      addLine(words.slice(offset, offset + length)); offset += length;
    }
  } else {
    let line: TimedWord[] = [];
    for (const word of words) {
      const last = line.at(-1);
      if (last && (word.startMs - last.endMs >= 900 || line.length >= 8 || /[.!?]$/.test(last.word))) { addLine(line); line = []; }
      line.push(word);
    }
    addLine(line);
  }
  return { lines, waveform: metadata.success ? metadata.data.waveformVisual ?? [] : [], lyrics: textLines.join('\n') };
}

export function currentLyricLine(lines: LyricLine[], positionMs: number) {
  return lines.findIndex(line => positionMs >= line.startMs && positionMs < line.endMs);
}
