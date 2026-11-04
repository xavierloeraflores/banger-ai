import { programDurationBeats, type MusicProgram } from '@banger/compiler';
import { trackRole, type PerformanceRole, type TrackMotion } from './score.js';

export interface StagePosition { x: number; y: number; z: number }
/** Keep track order intact: score and instruments address performers by track index. */
export function concertLayout(roles: PerformanceRole[], compact = false): StagePosition[] {
  const positions: StagePosition[] = roles.map(() => ({ x: 0, y: 0, z: 0 }));
  const columns = compact ? 2 : 5;
  const drums = roles.flatMap((role, i) => role === 'drums' ? [i] : []);
  const front = roles.flatMap((role, i) => role !== 'drums' && role !== 'keys' ? [i] : []);
  const keys = roles.flatMap((role, i) => role === 'keys' ? [i] : []);
  const row = (indices: number[], rear: boolean) => indices.forEach((index, i) => {
    const r = Math.floor(i / columns), count = Math.min(columns, indices.length - r * columns);
    positions[index] = { x: (i % columns - (count - 1) / 2) * 3.35, y: rear ? 1.1 + r * .65 : 0, z: rear ? -3.1 - r * 3.6 : 2 + r * 3.6 };
  });
  row(drums, true); row(front, false);
  const wing = Math.max(3.5, (Math.min(columns, Math.max(drums.length, front.length)) - 1) * 1.675 + 3.35);
  keys.forEach((index, i) => { positions[index] = { x: (i % 2 ? 1 : -1) * wing, y: .45, z: -.3 - Math.floor(i / 2) * 3.6 }; });
  return positions;
}

export function isChorus(program: MusicProgram, absoluteBeat: number): boolean {
  if (program.chainEnabled === false || !program.timeline?.length) return /chorus|hook|drop/i.test(program.activePattern ?? '');
  let beat = absoluteBeat % programDurationBeats(program);
  for (const entry of program.timeline) {
    const section = program.sections?.find(item => item.name === entry.section);
    if (!section) continue;
    const length = section.bars * 4 * (entry.repeats ?? 1);
    if (beat < length) return /chorus|hook|drop/i.test(section.name);
    beat -= length;
  }
  return false;
}

/** Audio-clock envelopes, never independent timers or synthetic beats. */
export function concertSignals(program: MusicProgram, motions: TrackMotion[], still = false) {
  let kick = 0, snare = 0, chord = 0;
  if (!still) program.tracks.forEach((track, i) => {
    const motion = motions[i];
    if (!motion?.playing) return;
    const energy = Math.min(1, motion.energy);
    if (track.source.name === 'drums/kick') kick = Math.max(kick, energy * Math.exp(-motion.age * 3));
    if (/drums\/(snare|clap)/.test(track.source.name)) snare = Math.max(snare, energy * Math.exp(-motion.age * 5));
    if (trackRole(track) !== 'drums' && motion.active && motion.sustained) chord = Math.max(chord, energy);
  });
  return { kick, snare, chord, chorus: !still && motions.some(motion => motion.playing) && isChorus(program, motions[0]?.beat ?? 0) };
}
