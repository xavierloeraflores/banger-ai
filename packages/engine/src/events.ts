import { validateMusicProgram, type MusicProgram, type MusicTrack, type Step } from '@banger/compiler';
export interface MusicEvent { track: MusicTrack; step: NonNullable<Step>; time: number; duration: number; velocity: number; sustained: boolean }
export const barDuration = (program: MusicProgram): number => 240 / program.tempo;
export function eventsForBar(program: MusicProgram, start = 0): MusicEvent[] {
  validateMusicProgram(program);
  if (!Number.isFinite(start) || start < 0) throw new RangeError('Bar start must be finite and nonnegative');
  const events: MusicEvent[] = [];
  for (const track of program.tracks) {
    if (track.pianoRoll !== undefined) {
      const beat = 60 / program.tempo;
      for (const note of track.pianoRoll) events.push({ track, step: { kind: 'note', midi: note.midi },
        time: start + note.start * beat, duration: note.duration * beat, velocity: note.velocity, sustained: true });
      continue;
    }
    const duration = barDuration(program) / track.steps.length;
    track.steps.forEach((step, index) => {
      if (step !== null) events.push({ track, step, time: start + index * duration, duration, velocity: 1, sustained: false });
    });
  }
  return events.sort((a, b) => a.time - b.time);
}
