import { z } from 'zod';
export const MUSIC_MODEL = 'music_v2_5' as const;
export const MAX_WAV_BYTES = 100 * 1024 * 1024;
const styles = z.array(z.string().max(1000)).max(50);
const range = z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).passthrough().refine(value => value.endMs - value.startMs >= 50, 'Audio ranges must be at least 50 milliseconds.');
export const audioReferenceSchema = z.object({ songId: z.string().min(1).max(200), range }).passthrough();
export const generationChunkSchema = z.object({
  text: z.string().max(6400), durationMs: z.number().int().min(3000).max(120000), positiveStyles: styles,
  negativeStyles: styles.optional(), contextAdherence: z.enum(['low','medium','high']).optional(),
  conditioningRef: audioReferenceSchema.nullish(), conditionStrength: z.enum(['low','medium','high','xhigh']).nullish(),
}).passthrough();
export const planSchema = z.object({ chunks: z.array(generationChunkSchema).min(1).max(30) }).passthrough().refine(plan => plan.chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0) <= 600000, 'Music must be ten minutes or shorter.');
export const providerPlanSchema = z.object({ chunks: z.array(z.union([generationChunkSchema, audioReferenceSchema])).min(1).max(30) }).passthrough();
export type CompositionPlan = z.infer<typeof planSchema>;
export type ProviderPlan = z.infer<typeof providerPlanSchema>;
export type MusicVersion = {
  id: string; version: number; name: string; songId: string; plan: CompositionPlan; providerPlan?: ProviderPlan;
  audioId: string; audioType: 'audio/wav' | 'audio/mpeg'; audioVersion: number;
  createdAt: string; operation: 'analyze' | 'edit' | 'lyrics' | 'generate';
};
export const lyricEditSchema = z.object({ index: z.number().int().min(0).max(29), lyrics: z.string().max(6200) }).strict();
export const musicActionSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('edit'), baseVersion: z.number().int().positive(), edits: z.array(lyricEditSchema).min(1).max(30) }).strict(),
  z.object({ operation: z.literal('lyrics'), baseVersion: z.number().int().positive(), prompt: z.string().trim().min(1).max(2000), indices: z.array(z.number().int().min(0).max(29)).min(1).max(30) }).strict(),
  z.object({ operation: z.literal('generate'), baseVersion: z.number().int().positive(), indices: z.array(z.number().int().min(0).max(29)).min(1).max(30) }).strict(),
]);
export type MusicAction = z.infer<typeof musicActionSchema>;
export type MusicOperation = { id: string; musicId: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'needs_review' | 'conflict'; progress: number; stage: string; error?: string; resultVersion?: number };
export function chunkName(text: string, index: number) { return text.match(/^\s*\[([^\]]+)\]/)?.[1] ?? `Chunk ${index + 1}`; }
export function lyricsOf(text: string) { return text.replace(/^\s*\[[^\]]+\]\s*\n?/, '').replace(/\{[^}]*\}/g, '').trim(); }
export function applyLyrics(plan: CompositionPlan, edits: z.infer<typeof lyricEditSchema>[]): CompositionPlan {
  if (new Set(edits.map(edit => edit.index)).size !== edits.length) throw new Error('Choose each chunk once.');
  const result = structuredClone(plan);
  for (const edit of edits) {
    lyricEditSchema.parse(edit);
    const chunk = result.chunks[edit.index];
    if (!chunk) throw new Error('The selected chunk no longer exists.');
    if (/[[\]{}]/.test(edit.lyrics)) throw new Error('Enter lyrics without section labels or production directions. Those remain part of the composition.');
    const lines = edit.lyrics.split('\n');
    if (lines.length > 29 || lines.some(line => line.length > 200)) throw new Error('Use at most 29 lyric lines of 200 characters per chunk.');
    const header = chunk.text.match(/^\s*\[[^\]]+\]/)?.[0] ?? '';
    const directions = [...chunk.text.matchAll(/\{[^}]*\}/g)].map(match => match[0]);
    chunk.text = [header, ...directions, edit.lyrics].filter(Boolean).join('\n');
  }
  return planSchema.parse(result);
}
export function validateIndices(plan: CompositionPlan, indices: number[]) {
  if (!indices.length || new Set(indices).size !== indices.length || indices.some(index => !Number.isInteger(index) || !plan.chunks[index])) throw new Error('Choose existing chunks once each.');
}
/** Only selected chunks regenerate; all other samples come from the currently rendered song. */
export function inpaintingPlan(version: MusicVersion, indices: number[]): ProviderPlan {
  validateIndices(version.plan, indices);
  let startMs = 0;
  return { ...structuredClone(version.plan), chunks: version.plan.chunks.map((chunk, index) => {
    const range = { startMs, endMs: startMs + chunk.durationMs }; startMs = range.endMs;
    return indices.includes(index) ? structuredClone(chunk) : { songId: version.songId, range };
  }) };
}

export function validateMusicAction(version:MusicVersion, action:MusicAction) {
  if(version.version!==action.baseVersion)throw new Error('This composition changed. Reload it before editing.');
  if(action.operation==='edit')applyLyrics(version.plan,action.edits);
  else validateIndices(version.plan,action.indices);
}
