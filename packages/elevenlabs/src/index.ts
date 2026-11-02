import { ElevenLabsClient, type ElevenLabs } from '@elevenlabs/elevenlabs-js';
import { Music } from '@elevenlabs/elevenlabs-js/wrapper/music.js';
import { MUSIC_MODEL, MAX_WAV_BYTES, planSchema, providerPlanSchema, applyLyrics, lyricsOf, validateIndices, inpaintingPlan, type CompositionPlan, type MusicVersion, type ProviderPlan } from './protocol.js';
export * from './protocol.js';
export class MusicProviderError extends Error {
  constructor(message: string, public uncertain = false) { super(message); }
}
export function publicMusicError(error: unknown): string {
  if (error instanceof MusicProviderError) return error.message;
  return 'ElevenLabs could not complete this request. Your saved song is unchanged.';
}
export interface MusicProvider {
  analyze(audio: Uint8Array, name: string): Promise<{ songId: string; plan: CompositionPlan }>;
  lyrics(plan: CompositionPlan, prompt: string, indices: number[]): Promise<CompositionPlan>;
  generate(version: MusicVersion, indices: number[]): Promise<{ songId: string; plan: CompositionPlan; providerPlan: ProviderPlan; audio: Uint8Array }>;
}
/** Reads PCM/IEEE-float WAVs, including metadata chunks, without interpreting user-supplied paths. */
export function validateWav(bytes: Uint8Array) {
  if (bytes.byteLength < 44 || bytes.byteLength > MAX_WAV_BYTES) throw new Error('Choose a WAV between 44 bytes and 100 MiB.');
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.toString('ascii',0,4) !== 'RIFF' || buffer.toString('ascii',8,12) !== 'WAVE' || buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error('Choose a complete RIFF/WAVE file.');
  let format = false, durationMs = 0, bytesPerSecond = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const kind = buffer.toString('ascii',offset,offset+4), size = buffer.readUInt32LE(offset+4), start = offset+8;
    if (start + size > buffer.length) throw new Error('The WAV contains a truncated chunk.');
    if (kind === 'fmt ') {
      if (size < 16 || ![1,3,65534].includes(buffer.readUInt16LE(start))) throw new Error('Use an uncompressed PCM or float WAV.');
      const channels=buffer.readUInt16LE(start+2), rate=buffer.readUInt32LE(start+4);
      if (channels<1 || channels>8 || rate<8000 || rate>192000) throw new Error('Unsupported WAV channel count or sample rate.');
      bytesPerSecond=buffer.readUInt32LE(start+8);format=true;
    }
    if (kind === 'data' && format && bytesPerSecond) durationMs += size / bytesPerSecond * 1000;
    offset=start+size+(size%2);
  }
  if (!format || durationMs<3000 || durationMs>600000) throw new Error('Choose a WAV lasting between 3 seconds and 10 minutes.');
  return { durationMs: Math.round(durationMs) };
}
export class ElevenMusic implements MusicProvider {
  private client: ElevenLabsClient;
  private music: Music;
  constructor(key: string, options: Omit<ConstructorParameters<typeof ElevenLabsClient>[0], 'apiKey'> = {}) {
    if (!key) throw new MusicProviderError('Set ELEVENLABS_API_KEY in the backend environment.');
    this.client = new ElevenLabsClient({ ...options, apiKey: key });
    this.music = new Music({ ...options, apiKey: key });
  }
  private async call<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : undefined;
      if (status === 401 || status === 403) throw new MusicProviderError('ElevenLabs denied access. Check the API key and Music permissions.');
      if (status === 402) throw new MusicProviderError('ElevenLabs needs more credits for this operation.');
      if (status === 422) throw new MusicProviderError('ElevenLabs rejected the audio or composition plan. Check its length and chunk settings.');
      if (status === 429) throw new MusicProviderError('ElevenLabs is rate limiting this account. Try again later.');
      throw new MusicProviderError('The ElevenLabs response was interrupted. Check provider history before starting another paid request.', true);
    }
  }
  async analyze(audio: Uint8Array, name: string) {
    validateWav(audio);
    const result = await this.call(() => this.client.music.upload({ file: new File([new Uint8Array(audio)], name, { type: 'audio/wav' }), extractCompositionPlan: MUSIC_MODEL }, { maxRetries: 0, timeoutInSeconds: 230 }));
    if (!result.songId) throw new MusicProviderError('ElevenLabs did not return a stored song ID.', true);
    return { songId: result.songId, plan: planSchema.parse(result.compositionPlan) };
  }
  async lyrics(plan: CompositionPlan, prompt: string, indices: number[]) {
    validateIndices(plan, indices);
    const generated = await this.call(() => this.client.music.compositionPlan.create({
      modelId: MUSIC_MODEL, sourceCompositionPlan: structuredClone(plan) as ElevenLabs.CompositionPlan,
      prompt: `Write original lyrics for chunks ${indices.map(index=>index+1).join(', ')}. ${prompt}\nKeep chunk count, order, durations, styles and section names unchanged. Return all chunks in their original order.`,
    }, { maxRetries: 0, timeoutInSeconds: 120 }));
    const proposed=planSchema.parse(generated);
    if (proposed.chunks.length !== plan.chunks.length) throw new MusicProviderError('The lyric response changed the chunk count. No changes were saved.');
    // Treat the generated plan as a lyric proposal only. Ignore all provider changes to musical properties.
    return applyLyrics(plan, indices.map(index=>({index,lyrics:lyricsOf(proposed.chunks[index]!.text).replace(/\{[^}]*\}/g,'').trim()})));
  }
  async generate(version: MusicVersion, indices: number[]) {
    const requestPlan=inpaintingPlan(version,indices);
    const result=await this.call(() => this.music.composeDetailed({ modelId:MUSIC_MODEL,compositionPlan:requestPlan as ElevenLabs.CompositionPlan,storeForInpainting:true,outputFormat:'mp3_44100_128' }, {maxRetries:0,timeoutInSeconds:230}));
    if (!result.songId || !result.audio.length || result.audio.length>MAX_WAV_BYTES) throw new MusicProviderError('ElevenLabs did not return a complete stored song.', true);
    const providerPlan=providerPlanSchema.parse(result.json.compositionPlan);
    if (providerPlan.chunks.length !== version.plan.chunks.length) throw new MusicProviderError('ElevenLabs returned a different chunk structure. The original song is preserved.', true);
    const plan=planSchema.parse({ ...providerPlan, chunks: providerPlan.chunks.map((chunk,index)=>'text' in chunk ? chunk : structuredClone(version.plan.chunks[index]!)) });
    return {songId:result.songId,plan,providerPlan,audio:new Uint8Array(result.audio)};
  }
}

export async function performMusicAction(provider: MusicProvider, base: MusicVersion, input: import('./protocol.js').MusicAction, operationId: string): Promise<{ version: MusicVersion; audio?: Uint8Array }> {
  if (input.baseVersion !== base.version) throw new Error('This song changed. Reload before editing it.');
  const next: MusicVersion = { ...structuredClone(base), version: base.version+1, createdAt:new Date().toISOString(), operation:input.operation };
  if (input.operation === 'edit') { next.plan=applyLyrics(base.plan,input.edits); return {version:next}; }
  if (input.operation === 'lyrics') { next.plan=await provider.lyrics(base.plan,input.prompt,input.indices); return {version:next}; }
  const generated=await provider.generate(base,input.indices);
  next.plan=generated.plan;next.providerPlan=generated.providerPlan;next.songId=generated.songId;
  next.audioId=operationId;next.audioType='audio/mpeg';next.audioVersion=next.version;
  return {version:next,audio:generated.audio};
}
