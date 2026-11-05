import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
// The package-root client overrides music with a multipart-parsing wrapper,
// even though its types advertise the raw stream. Use the generated client.
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js/Client.js';
import { readMusicResponse } from './music-response.js';
import { MUSIC_MODEL, MAX_WAV_BYTES, audioMetadataSchema, type AudioMetadata, planSchema, providerPlanSchema, providerChunk, applyLyrics, lyricsOf, validateIndices, inpaintingPlan, type CompositionPlan, type MusicVersion, type ProviderPlan } from './protocol.js';
export * from './protocol.js';
export class MusicProviderError extends Error {
  constructor(message: string, public uncertain = false, public statusCode?: number) { super(message); }
}
export function publicMusicError(error: unknown): string {
  if (error instanceof MusicProviderError) return error.message;
  return 'ElevenLabs could not complete this request. Your saved song is unchanged.';
}
export interface MusicProvider {
  analyze(audio: Uint8Array, name: string): Promise<{ songId: string; plan: CompositionPlan; audioMetadata?: AudioMetadata }>;
  lyrics(plan: CompositionPlan, prompt: string, indices: number[]): Promise<CompositionPlan>;
  generate(version: MusicVersion, indices: number[]): Promise<{ songId: string; plan: CompositionPlan; providerPlan: ProviderPlan; audio: Uint8Array; audioMetadata?: AudioMetadata }>;
}
/** Reads PCM/IEEE-float WAVs, including metadata chunks, without interpreting user-supplied paths. */
export function validateWav(bytes: Uint8Array, forMusic = true) {
  if (bytes.byteLength < 44 || bytes.byteLength > MAX_WAV_BYTES) throw new Error('Choose a WAV between 44 bytes and 100 MiB.');
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.toString('ascii',0,4) !== 'RIFF' || buffer.toString('ascii',8,12) !== 'WAVE' || buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error('Choose a complete RIFF/WAVE file.');
  let format = false, durationMs = 0, bytesPerSecond = 0, blockAlign=0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const kind = buffer.toString('ascii',offset,offset+4), size = buffer.readUInt32LE(offset+4), start = offset+8;
    if (start + size > buffer.length) throw new Error('The WAV contains a truncated chunk.');
    if (kind === 'fmt ') {
      if (format || size < 16) throw new Error('Invalid WAV format chunk.');
      let encoding=buffer.readUInt16LE(start);
      if (encoding===65534) {
        if(size<40 || buffer.readUInt16LE(start+16)<22 || buffer.subarray(start+28,start+40).toString('hex')!=='00001000800000aa00389b71')throw new Error('Unsupported extensible WAV format.');
        encoding=buffer.readUInt32LE(start+24);
      }
      if(![1,3].includes(encoding))throw new Error('Use an uncompressed PCM or float WAV.');
      const channels=buffer.readUInt16LE(start+2),rate=buffer.readUInt32LE(start+4),bits=buffer.readUInt16LE(start+14),alignment=buffer.readUInt16LE(start+12);
      if (channels<1 || channels>8 || rate<8000 || rate>192000) throw new Error('Unsupported WAV channel count or sample rate.');
      if(!(encoding===3?[32,64]:[8,16,24,32]).includes(bits)||alignment!==channels*bits/8||buffer.readUInt32LE(start+8)!==rate*alignment)throw new Error('The WAV sample layout is inconsistent.');
      bytesPerSecond=rate*alignment;blockAlign=alignment;format=true;
    }
    if (kind === 'data') {
      if(!format || size%blockAlign!==0)throw new Error('The WAV contains incomplete audio frames.');
      durationMs += size / bytesPerSecond * 1000;
    }
    offset=start+size+(size%2);
  }
  if (!format || durationMs<=0) throw new Error('Choose a WAV with nonempty audio data.');
  if (forMusic && (durationMs<3000 || durationMs>600000)) throw new Error('Choose a WAV lasting between 3 seconds and 10 minutes.');
  return { durationMs: Math.round(durationMs) };
}
export class ElevenMusic implements MusicProvider {
  private client: ElevenLabsClient;
  constructor(key: string, options: Omit<ConstructorParameters<typeof ElevenLabsClient>[0], 'apiKey'> = {}) {
    if (!key) throw new MusicProviderError('Set ELEVENLABS_API_KEY in the backend environment.');
    this.client = new ElevenLabsClient({ ...options, apiKey: key });
  }
  private async call<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof MusicProviderError) throw error;
      const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : undefined;
      const body = error && typeof error === 'object' && 'body' in error ? error.body : undefined;
      const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : undefined;
      const data = detail && typeof detail === 'object' && 'data' in detail ? detail.data : undefined;
      if (status === 400 && data && typeof data === 'object' && 'reason' in data && data.reason === 'copyrighted_material_detected') {
        throw new MusicProviderError('ElevenLabs rejected this composition as copyrighted material. Revise the lyrics or musical styles, then generate again. Your uploaded beat and fitted lyrics are saved.', false, status);
      }
      if (status === 401 || status === 403) throw new MusicProviderError('ElevenLabs denied access. Check the API key and Music permissions.', false, status);
      if (status === 402) throw new MusicProviderError('ElevenLabs needs more credits for this operation.');
      if (status === 422) throw new MusicProviderError('ElevenLabs rejected the audio or composition plan. Check its length and chunk settings.');
      if (status === 429) throw new MusicProviderError('ElevenLabs is rate limiting this account. Try again later.');
      if (status && status >= 400 && status < 500 && status !== 408) throw new MusicProviderError(`ElevenLabs rejected the request (HTTP ${status}). Check the audio, composition settings, and Music access for this account.`);
      throw new MusicProviderError('The ElevenLabs response was interrupted. Check provider history before starting another paid request.', true);
    }
  }
  async analyze(audio: Uint8Array, name: string) {
    validateWav(audio);
    const result = await this.call(() => this.client.music.upload({ file: new File([new Uint8Array(audio)], name, { type: 'audio/wav' }), extractCompositionPlan: MUSIC_MODEL, withTimestamps: true, withWaveformVisual: true }, { maxRetries: 0, timeoutInSeconds: 230 }));
    if (!result.songId) throw new MusicProviderError('ElevenLabs did not return a stored song ID.', true);
    return { songId: result.songId, plan: planSchema.parse(result.compositionPlan), audioMetadata: audioMetadataSchema.parse(result) };
  }
  async lyrics(plan: CompositionPlan, prompt: string, indices: number[]) {
    planSchema.parse(plan);
    validateIndices(plan, indices);
    const generated = await this.call(() => this.client.music.compositionPlan.create({
      modelId: MUSIC_MODEL, sourceCompositionPlan: { ...structuredClone(plan), chunks: plan.chunks.map(providerChunk) } as ElevenLabs.CompositionPlan,
      prompt: `Write original lyrics for chunks ${indices.map(index=>index+1).join(', ')}. ${prompt}\nKeep chunk count, order, durations, styles and section names unchanged. Return all chunks in their original order.`,
    }, { maxRetries: 0, timeoutInSeconds: 120 }));
    const proposed=planSchema.parse(generated);
    if (proposed.chunks.length !== plan.chunks.length) throw new MusicProviderError('The lyric response changed the chunk count. No changes were saved.');
    // Treat the generated plan as a lyric proposal only. Ignore all provider changes to musical properties.
    return applyLyrics(plan, indices.map(index=>({index,lyrics:lyricsOf(proposed.chunks[index]!.text).replace(/\{[^}]*\}/g,'').trim()})));
  }
  async generate(version: MusicVersion, indices: number[]) {
    const requestPlan=providerPlanSchema.parse(inpaintingPlan(version,indices));
    const result=await this.call(async () => {
      // The convenience wrapper erases HTTP status codes, incorrectly turning
      // rejected requests into uncertain paid operations. Use the raw client.
      const {data,rawResponse}=await this.client.music.composeDetailed({ modelId:MUSIC_MODEL,compositionPlan:requestPlan as ElevenLabs.CompositionPlan,storeForInpainting:true,withTimestamps:true,withWaveformVisual:true,outputFormat:'mp3_44100_128' }, {maxRetries:0,timeoutInSeconds:230}).withRawResponse();
      try {
        return {...await readMusicResponse(data,rawResponse.headers.get('content-type')),songId:rawResponse.headers.get('song-id')};
      } catch {
        throw new MusicProviderError('ElevenLabs accepted the generation, but its audio response could not be read completely. Check provider history before starting another paid request.',true);
      }
    });
    if (!result.songId || !result.audio.length || result.audio.length>MAX_WAV_BYTES) throw new MusicProviderError('ElevenLabs did not return a complete stored song.', true);
    const providerPlan=providerPlanSchema.parse(result.json.compositionPlan);
    if (providerPlan.chunks.length !== version.plan.chunks.length) throw new MusicProviderError('ElevenLabs returned a different chunk structure. The original song is preserved.', true);
    const plan=planSchema.parse({ ...providerPlan, chunks: providerPlan.chunks.map((chunk,index)=>'text' in chunk ? { ...chunk, positiveStyles: structuredClone(version.plan.chunks[index]!.positiveStyles), vocalStyle: version.plan.chunks[index]!.vocalStyle } : structuredClone(version.plan.chunks[index]!)) });
    return {songId:result.songId,plan,providerPlan,audio:new Uint8Array(result.audio),audioMetadata:audioMetadataSchema.parse(result.json)};
  }
}

export async function performMusicAction(provider: MusicProvider | (()=>MusicProvider|Promise<MusicProvider>), base: MusicVersion, input: import('./protocol.js').MusicAction, operationId: string): Promise<{ version: MusicVersion; audio?: Uint8Array }> {
  if (input.baseVersion !== base.version) throw new Error('This song changed. Reload before editing it.');
  const next: MusicVersion = { ...structuredClone(base), version: base.version+1, parentVersion:input.sourceVersion??base.version, createdAt:new Date().toISOString(), operation:input.operation };
  if (input.operation === 'edit') { next.plan=applyLyrics(base.plan,input.edits); return {version:next}; }
  const client=typeof provider==='function'?await provider():provider;
  if (input.operation === 'lyrics') { next.plan=await client.lyrics(base.plan,input.prompt,input.indices); return {version:next}; }
  const generated=await client.generate(base,input.indices);
  next.plan=generated.plan;next.providerPlan=generated.providerPlan;next.songId=generated.songId;
  // A new recording replaces measurements, even if the provider omitted them.
  next.audioMetadata=generated.audioMetadata;
  next.audioId=operationId;next.audioType='audio/mpeg';next.audioVersion=next.version;
  return {version:next,audio:generated.audio};
}
