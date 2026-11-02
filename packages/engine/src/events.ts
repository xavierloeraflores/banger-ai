import { validateMusicProgram, resolveArrangement, resolvePattern, programDurationBeats, patternDurationBeats, applyGroove, type MusicProgram, type MusicTrack, type Step } from '@banger/compiler';
export interface MusicEvent { track: MusicTrack; step: NonNullable<Step>; time: number; duration: number; velocity: number; sustained: boolean; beat: number; clipStartBeat: number; clipDurationBeats: number; pattern?: string; section?: string; pass: number; index: number; phraseBeats: number }
export const barDuration = (program: MusicProgram): number => 240 / program.tempo;
export const songDuration = (program: MusicProgram): number => programDurationBeats(program) * 60 / program.tempo;
export interface EventOptions { fill?: boolean; cycle?: number; includeConditional?: boolean }
/** Stable decisions make playback, full renders and stems agree for the same pass. */
export function eventOccurs(event: MusicEvent, cycle = 0, fill = false): boolean {
  const pass = event.pass + cycle, condition = event.step.condition ?? 'always';
  if (condition === 'fill' && !fill || condition === 'not-fill' && fill || condition === 'first' && pass !== 0 || condition === 'every-2' && (pass + 1) % 2 !== 0 || condition === 'every-4' && (pass + 1) % 4 !== 0) return false;
  let hash = (event.track.groove?.seed ?? 0) ^ Math.imul(event.index + 1, 2654435761) ^ Math.imul(pass + 1, 2246822519);
  for (const char of event.track.name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash ^= hash >>> 16; hash = Math.imul(hash, 2246822507); hash ^= hash >>> 13;
  return (hash >>> 0) / 4294967296 < (event.step.probability ?? 1);
}
export function eventsForSong(program: MusicProgram, start = 0, options: EventOptions = {}): MusicEvent[] {
  validateMusicProgram(program);
  if (!Number.isFinite(start) || start < 0) throw new RangeError('Song start must be finite and nonnegative');
  const events: MusicEvent[] = [], seconds = 60 / program.tempo;
  for (const clip of resolveArrangement(program)) {
    const track = program.tracks.find(track => track.name === clip.track)!;
    const pattern = resolvePattern(track, clip.pattern), length = patternDurationBeats(pattern);
    const add = (step: NonNullable<Step>, beat: number, duration: number, velocity: number, sustained: boolean, index: number) => {
      if (beat >= clip.durationBeats) return;
      const local = Math.max(0, Math.min(clip.durationBeats - 1e-7, applyGroove(beat, track.groove ?? {}, index)));
      events.push({ track, step, time: start + (clip.startBeat + local) * seconds,
        duration: Math.min(duration, clip.durationBeats - local) * seconds, velocity, sustained,
        beat: clip.startBeat + local, clipStartBeat: clip.startBeat, clipDurationBeats: clip.durationBeats,
        pattern: clip.pattern, section: clip.section, pass: Math.floor(clip.startBeat / length), index, phraseBeats: length });
    };
    if (pattern.pianoRoll) pattern.pianoRoll.forEach((note, i) => add({ kind: 'note', midi: note.midi }, note.start, note.duration, note.velocity, true, i));
    else pattern.steps.forEach((step, i) => { if (step) add(step, i * length / pattern.steps.length, length / pattern.steps.length, step.velocity ?? 1, false, i); });
  }
  return events.filter(event => options.includeConditional || eventOccurs(event, options.cycle ?? 0, options.fill ?? false)).sort((a, b) => a.time - b.time);
}
export function eventsForBar(program: MusicProgram, start = 0, barIndex = 0): MusicEvent[] {
  if (!Number.isInteger(barIndex) || barIndex < 0) throw new RangeError('Bar index must be a nonnegative integer');
  const beat = (barIndex * 4) % programDurationBeats(program), seconds = 60 / program.tempo;
  return eventsForSong(program, start, { includeConditional: true }).filter(event => event.beat >= beat && event.beat < beat + 4 && eventOccurs(event, Math.floor(barIndex * 4 / programDurationBeats(program)) * Math.ceil(programDurationBeats(program) / event.phraseBeats)))
    .map(event => ({ ...event, time: event.time - beat * seconds }));
}
