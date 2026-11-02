import { validateMusicProgram, type MusicProgram, type MusicTrack, type Step } from '@banger/compiler';
export interface MusicEvent { track: MusicTrack; step: NonNullable<Step>; time: number; duration: number }
export const barDuration = (program: MusicProgram): number => 240 / program.tempo;
export function eventsForBar(program: MusicProgram, start = 0): MusicEvent[] {
  validateMusicProgram(program);
  if (!Number.isFinite(start) || start < 0) throw new RangeError('Bar start must be finite and nonnegative');
  const events: MusicEvent[] = [];
  for (const track of program.tracks) {
    const duration = barDuration(program) / track.steps.length;
    track.steps.forEach((step, index) => {
      if (step !== null) events.push({ track, step, time: start + index * duration, duration });
    });
  }
  return events.sort((a, b) => a.time - b.time);
}
