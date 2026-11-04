import { z } from 'zod';
export const MUSIC_MODEL = 'music_v2_5' as const;
export const MAX_WAV_BYTES = 100 * 1024 * 1024;
// GenerationChunk.text: https://api.elevenlabs.io/openapi.json
// These limits cover the complete text, including section labels and directions.
export const MAX_CHUNK_TEXT_CHARACTERS = 6132;
export const MAX_CHUNK_TEXT_LINES = 30;
export const MAX_CHUNK_LINE_CHARACTERS = 200;
const characterCount = (text: string) => Array.from(text).length;
export const chunkTextSchema = z.string().superRefine((text, ctx) => {
  if (characterCount(text) > MAX_CHUNK_TEXT_CHARACTERS) ctx.addIssue({ code: 'custom', message: `Chunk text must have at most ${MAX_CHUNK_TEXT_CHARACTERS.toLocaleString('en-US')} characters, including section labels and directions.` });
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > MAX_CHUNK_TEXT_LINES) ctx.addIssue({ code: 'custom', message: `Chunk text must have at most ${MAX_CHUNK_TEXT_LINES} lines, including section labels and directions.` });
  const longLine = lines.findIndex(line => characterCount(line) > MAX_CHUNK_LINE_CHARACTERS);
  if (longLine !== -1) ctx.addIssue({ code: 'custom', message: `Chunk text line ${longLine + 1} exceeds ${MAX_CHUNK_LINE_CHARACTERS} characters, including any directions on that line.` });
  const section = text.match(/^\s*\[([^\]]*)\]/)?.[1];
  if (section !== undefined && (characterCount(section) < 1 || characterCount(section) > 100)) ctx.addIssue({ code: 'custom', message: 'Section names must have between 1 and 100 characters.' });
});
const lyricTextSchema = chunkTextSchema.refine(text => !/[[\]{}]/.test(text), 'Enter lyrics without section labels or production directions. Those remain part of the composition.');
export const vocalStyleSchema = z.string().trim().max(1000);
const styles = z.array(z.string().max(1000)).max(50);
const range = z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).passthrough().refine(value => value.endMs - value.startMs >= 50, 'Audio ranges must be at least 50 milliseconds.');
export const audioReferenceSchema = z.object({ songId: z.string().min(1).max(200), range }).passthrough();
export const generationChunkSchema = z.object({
  vocalStyle: vocalStyleSchema.optional(),
  text: chunkTextSchema, durationMs: z.number().int().min(3000).max(120000), positiveStyles: styles,
  negativeStyles: styles.optional(), contextAdherence: z.enum(['low','medium','high']).optional(),
  conditioningRef: audioReferenceSchema.nullish(), conditionStrength: z.enum(['low','medium','high','xhigh']).nullish(),
}).passthrough();
export const planSchema = z.object({ chunks: z.array(generationChunkSchema).min(1).max(30) }).passthrough().refine(plan => plan.chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0) <= 600000, 'Music must be ten minutes or shorter.');
export const providerPlanSchema = z.object({ chunks: z.array(z.union([generationChunkSchema, audioReferenceSchema])).min(1).max(30) }).passthrough();
export type CompositionPlan = z.infer<typeof planSchema>;
export type ProviderPlan = z.infer<typeof providerPlanSchema>;
export const associatedBeatSchema = z.object({ name: z.string().min(1).max(255), source: z.string().min(1).max(1024 * 1024) }).strict();
export type AssociatedBeat = z.infer<typeof associatedBeatSchema>;
/** Provider measurements describe the recorded audio, not subsequent lyric drafts.
 * Times are milliseconds; waveform samples are mono, 4 Hz, in [-1000, 1000]. */
export const audioMetadataSchema = z.object({
  wordsTimestamps: z.array(z.object({ word: z.string(), startMs: z.number().nonnegative(), endMs: z.number().nonnegative() })).nullish(),
  waveformVisual: z.array(z.number().int().min(-1000).max(1000)).nullish(),
});
export type AudioMetadata = z.infer<typeof audioMetadataSchema>;
export type MusicVersion = {
  studioPath?: string;
  beat?: AssociatedBeat;
  id: string; version: number; name: string; songId: string; originalSongId?: string; plan: CompositionPlan; providerPlan?: ProviderPlan;
  audioId: string; audioType: 'audio/wav' | 'audio/mpeg'; audioVersion: number; audioMetadata?: AudioMetadata;
  createdAt: string; parentVersion?: number; operation: 'analyze' | 'edit' | 'lyrics' | 'generate';
};
export type LibrarySongType = 'instrumental' | 'vocal';
/** Classify a saved recording, preferring measured words over editable lyrics. */
export function librarySongType(document: unknown): LibrarySongType {
  if (typeof document === 'string') {
    try { document = JSON.parse(document); } catch { return 'instrumental'; }
  }
  if (!document || typeof document !== 'object') return 'instrumental';
  const record = document as Record<string, unknown>;
  const metadata = audioMetadataSchema.safeParse(record.audioMetadata);
  if (metadata.success && Array.isArray(metadata.data.wordsTimestamps)) {
    return metadata.data.wordsTimestamps.some(word => word.word.trim() && word.endMs > word.startMs) ? 'vocal' : 'instrumental';
  }
  const plan = z.object({ chunks: z.array(z.object({ text: z.string() })) }).safeParse(record.plan);
  return plan.success && plan.data.chunks.some(chunk => chunk.text.replace(/\[[^\]]*\]|\{[^}]*\}/g, '').trim()) ? 'vocal' : 'instrumental';
}
export const lyricEditSchema = z.object({ index: z.number().int().min(0).max(29), lyrics: lyricTextSchema.optional(), vocalStyle: vocalStyleSchema.optional() }).strict().refine(edit => edit.lyrics !== undefined || edit.vocalStyle !== undefined, 'Supply lyrics or a vocal style.');
export const musicActionSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('edit'), baseVersion: z.number().int().positive(), sourceVersion: z.number().int().positive().optional(), edits: z.array(lyricEditSchema).min(1).max(30) }).strict(),
  z.object({ operation: z.literal('lyrics'), baseVersion: z.number().int().positive(), sourceVersion: z.number().int().positive().optional(), prompt: z.string().trim().min(1).max(2000), indices: z.array(z.number().int().min(0).max(29)).min(1).max(30) }).strict(),
  z.object({ operation: z.literal('generate'), baseVersion: z.number().int().positive(), sourceVersion: z.number().int().positive().optional(), indices: z.array(z.number().int().min(0).max(29)).min(1).max(30) }).strict(),
]);
export type MusicAction = z.infer<typeof musicActionSchema>;
export type MusicOperation = { id: string; musicId: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'needs_review' | 'conflict'; progress: number; stage: string; error?: string; resultVersion?: number };
export function chunkName(text: string, index: number) { return text.match(/^\s*\[([^\]]+)\]/)?.[1] ?? `Chunk ${index + 1}`; }
export function lyricsOf(text: string) { return text.replace(/^\s*\[[^\]]+\]\s*\n?/, '').replace(/\{[^}]*\}/g, '').trim(); }
function textWithLyrics(text: string, lyrics: string) {
  lyricTextSchema.parse(lyrics);
  const header = text.match(/^\s*\[[^\]]+\]/)?.[0] ?? '';
  const directions = [...text.matchAll(/\{[^}]*\}/g)].map(match => match[0]);
  return chunkTextSchema.parse([header, ...directions, lyrics].filter(Boolean).join('\n'));
}
/** Preview the same assembled-text validation used when saving manual or generated lyrics. */
export function lyricEditError(text: string, lyrics: string): string | undefined {
  try { textWithLyrics(text, lyrics); }
  catch (error) {
    if (error instanceof z.ZodError) return error.issues[0]!.message;
    throw error;
  }
}
export function applyLyrics(plan: CompositionPlan, edits: z.infer<typeof lyricEditSchema>[]): CompositionPlan {
  if (new Set(edits.map(edit => edit.index)).size !== edits.length) throw new Error('Choose each chunk once.');
  const result = structuredClone(plan);
  for (const edit of edits) {
    lyricEditSchema.parse(edit);
    const chunk = result.chunks[edit.index];
    if (!chunk) throw new Error('The selected chunk no longer exists.');
    if (edit.lyrics !== undefined && edit.lyrics !== lyricsOf(chunk.text)) chunk.text = textWithLyrics(chunk.text, edit.lyrics);
    if (edit.vocalStyle !== undefined) {
      const style = vocalStyleSchema.parse(edit.vocalStyle);
      if (style && chunk.positiveStyles.length >= 50 && !chunk.positiveStyles.includes(style)) throw new Error('This chunk already has 50 musical styles. There is no room for a vocal style.');
      if (style) chunk.vocalStyle = style; else delete chunk.vocalStyle;
    }
  }
  return planSchema.parse(result);
}
export function validateIndices(plan: CompositionPlan, indices: number[]) {
  if (!indices.length || new Set(indices).size !== indices.length || indices.some(index => !Number.isInteger(index) || !plan.chunks[index])) throw new Error('Choose existing chunks once each.');
}
/** Regeneration always uses the original upload at maximum conditioning strength. */
export function inpaintingPlan(version: MusicVersion, indices: number[]): ProviderPlan {
  validateIndices(version.plan, indices);
  let startMs = 0;
  return { ...structuredClone(version.plan), chunks: version.plan.chunks.map((chunk, index) => {
    const range = { startMs, endMs: startMs + chunk.durationMs }; startMs = range.endMs;
    if (!indices.includes(index)) return { songId: version.songId, range };
    return {
      ...providerChunk(chunk),
      conditioningRef: {
        songId: version.originalSongId ?? version.songId,
        // ElevenLabs permits at most 30 seconds of reference audio per chunk.
        range: { startMs: range.startMs, endMs: Math.min(range.endMs, range.startMs + 30000) },
      },
      conditionStrength: 'xhigh' as const,
    };
  }) };
}

export function validateMusicAction(version:MusicVersion, action:MusicAction) {
  if(version.version!==action.baseVersion)throw new Error('This composition changed. Reload it before editing.');
  if(action.operation==='edit')applyLyrics(version.plan,action.edits);
  else validateIndices(version.plan,action.indices);
}

/** Branch an immutable composition while retaining the current revision for publication fencing. */
export function musicActionBase(current:MusicVersion, source:MusicVersion, action:MusicAction):MusicVersion {
  if(current.version!==action.baseVersion)throw new Error('This composition changed. Reload it before editing.');
  if(source.id!==current.id || source.version!==(action.sourceVersion??current.version) || source.version>current.version)throw new Error('The selected music version is unavailable.');
  const base={...structuredClone(source),version:current.version};
  validateMusicAction(base,action);
  return base;
}
export type MusicHistory={versions:MusicVersion[];original:MusicVersion;nextBefore?:number};

/** Descriptions live outside musical styles; only provider requests combine them. */
export function providerChunk(chunk: CompositionPlan['chunks'][number]) {
  const { vocalStyle, ...result } = structuredClone(chunk);
  if (vocalStyle && !result.positiveStyles.includes(vocalStyle)) result.positiveStyles.push(vocalStyle);
  return result;
}
export function vocalStyleEdits(previous: CompositionPlan, next: CompositionPlan) {
  // Reanalysis can split or merge sections. Use the largest overlap in song time.
  let start = 0;
  const ranges = previous.chunks.map(chunk => {
    const range = { start, end: start + chunk.durationMs, style: chunk.vocalStyle ?? '' };
    start = range.end; return range;
  });
  start = 0;
  return next.chunks.map((chunk, index) => {
    const end = start + chunk.durationMs;
    const match = ranges.map(range => ({ ...range, overlap: Math.max(0, Math.min(end, range.end) - Math.max(start, range.start)) })).sort((a, b) => b.overlap - a.overlap)[0];
    start = end;
    const uniform = ranges.every(range => range.style === ranges[0]?.style);
    return { index, vocalStyle: uniform ? ranges[0]?.style ?? '' : match && match.overlap > 0 ? match.style : '' };
  });
}
