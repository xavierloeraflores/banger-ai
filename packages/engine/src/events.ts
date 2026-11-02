import { validateMusicProgram, resolveArrangement, resolvePattern, programDurationBeats, patternDurationBeats, applyGroove, type MusicProgram, type MusicTrack, type Step } from '@banger/compiler';
export interface MusicEvent { track: MusicTrack; step: NonNullable<Step>; time: number; duration: number; velocity: number; sustained: boolean; beat: number; clipStartBeat: number; clipDurationBeats: number; pattern?: string; section?: string }
export const barDuration = (program: MusicProgram): number => 240 / program.tempo;
export const songDuration = (program: MusicProgram): number => programDurationBeats(program) * 60 / program.tempo;
export function eventsForSong(program: MusicProgram, start = 0): MusicEvent[] {
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
        pattern: clip.pattern, section: clip.section });
    };
    if (pattern.pianoRoll) pattern.pianoRoll.forEach((note, i) => add({ kind: 'note', midi: note.midi }, note.start, note.duration, note.velocity, true, i));
    else pattern.steps.forEach((step, i) => { if (step) add(step, i * length / pattern.steps.length, length / pattern.steps.length, 1, false, i); });
  }
  return events.sort((a, b) => a.time - b.time);
}
export function eventsForBar(program: MusicProgram, start = 0, barIndex = 0): MusicEvent[] {
  if (!Number.isInteger(barIndex) || barIndex < 0) throw new RangeError('Bar index must be a nonnegative integer');
  const beat = (barIndex * 4) % programDurationBeats(program), seconds = 60 / program.tempo;
  return eventsForSong(program, start).filter(event => event.beat >= beat && event.beat < beat + 4)
    .map(event => ({ ...event, time: event.time - beat * seconds }));
}
