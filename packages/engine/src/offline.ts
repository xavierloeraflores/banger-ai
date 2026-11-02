import { copyMusicProgram, type MusicProgram } from '@banger/compiler';
import { AudioRenderer } from './audio.js';
import { songDuration } from './events.js';
import { effectTail } from './graph.js';
import { prepareAudio } from './sidechain.js';
export interface RenderOptions { sampleRate?: number; tailSeconds?: number; stem?: string }
export interface RenderedAudio { buffer: AudioBuffer; wav: ArrayBuffer; duration: number; tailSeconds: number }
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels, bytes = buffer.length * channels * 2;
  if (bytes > 0xffffffff - 36) throw new RangeError('Audio exceeds the RIFF/WAVE size limit');
  const wav = new ArrayBuffer(44 + bytes), view = new DataView(wav);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, bytes, true);
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  for (let i = 0; i < buffer.length; i++) for (let channel = 0; channel < channels; channel++) {
    const sample = Math.max(-1, Math.min(1, data[channel][i])); view.setInt16(44 + (i * channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return wav;
}
function tailLength(program: MusicProgram): number {
  // Sum bus tails conservatively, including send chains. Same length for all stems.
  return Math.max(.7, ...program.tracks.filter(track => track.source.kind === 'sound').map(track => .65 * 2 ** (-Math.min(0, ...(track.automation ?? []).filter(curve => curve.target === 'pitch').flatMap(curve => curve.points.map(point => point.value))) / 12))) + Math.max(0, ...program.tracks.map(track => effectTail(track.effects, track.automation))) + (program.buses ?? []).reduce((sum, bus) => sum + effectTail(bus.effects, bus.automation), 0);
}
async function render(program: MusicProgram, options: RenderOptions, solo?: string): Promise<RenderedAudio> {
  const sampleRate = options.sampleRate ?? 44100, tailSeconds = options.tailSeconds ?? tailLength(program);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Sample rate must be an integer from 8000 to 192000');
  if (!Number.isFinite(tailSeconds) || tailSeconds < 0 || tailSeconds > 300) throw new RangeError('Tail must be between 0 and 300 seconds');
  const duration = songDuration(program) + tailSeconds;
  const length = Math.ceil(duration * sampleRate);
  if (length * 2 * 6 > 512 * 1024 * 1024) throw new RangeError('Render exceeds 512 MiB. Shorten the song or lower the sample rate.');
  const context = new OfflineAudioContext(2, length, sampleRate); await prepareAudio(context);
  const renderer = new AudioRenderer(context, solo);
  try { renderer.renderSong(program); const buffer = await context.startRendering(); return { buffer, wav: encodeWav(buffer), duration: buffer.duration, tailSeconds }; }
  finally { renderer.dispose(); }
}
export function renderWav(program: MusicProgram, options: RenderOptions = {}): Promise<RenderedAudio> { const song = copyMusicProgram(program); if (options.stem !== undefined && !song.tracks.some(track => track.name === options.stem)) return Promise.reject(new RangeError('Unknown stem track')); return render(song, options, options.stem); }
/** Post-fader track stems include their bus and send effects. All key tracks still
 * drive sidechains. Nonlinear bus processing means stems need not sum to the mix. */
export async function renderStems(program: MusicProgram, options: RenderOptions = {}): Promise<Record<string, RenderedAudio>> {
  const song = copyMusicProgram(program), stems: Record<string, RenderedAudio> = Object.create(null);
  const frames = Math.ceil((songDuration(song) + (options.tailSeconds ?? tailLength(song))) * (options.sampleRate ?? 44100));
  if (frames * 2 * 6 * song.tracks.length > 512 * 1024 * 1024) throw new RangeError('Stems exceed 512 MiB combined. Export individual stems or lower the sample rate.');
  for (const track of song.tracks) stems[track.name] = await render(song, options, track.name);
  return stems;
}
