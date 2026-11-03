import { programDurationBeats, type MusicProgram, type MusicTrack } from '@banger/compiler';
import { eventsForSong, type MusicEvent, type PlaybackState } from '@banger/engine';

export type PerformanceRole = 'drums' | 'bass' | 'keys' | 'dance';
export interface PerformanceSnapshot { program: MusicProgram; state: PlaybackState; fill: boolean }
export interface TrackMotion {
  beat: number;
  playing: boolean;
  active: boolean;
  energy: number;
  /** Seconds since the latest audible onset, Infinity during silence. */
  age: number;
  duration: number;
  sustained?: boolean;
  midi: number;
  index: number;
}
export function trackRole(track: MusicTrack): PerformanceRole {
  if (track.source.kind === 'sound') return 'drums';
  if (track.source.name === 'synth/bass' || track.source.name === 'synth/pluck') return 'bass';
  if (['synth/keys', 'synth/organ', 'synth/bell'].includes(track.source.name)) return 'keys';
  return 'dance';
}

/** Shares the engine's arrangement, groove, probability and fill decisions. */
export class PerformanceScore {
  private program?: MusicProgram;
  private cycle = -1;
  private fill = false;
  private events = new Map<string, MusicEvent[]>();
  private previous = new Map<string, MusicEvent[]>();

  sample(snapshot: PerformanceSnapshot): TrackMotion[] {
    const { program, state, fill } = snapshot;
    const length = programDurationBeats(program);
    const absoluteBeat = (Math.max(1, state.bar) - 1 + state.phase) * 4;
    const cycle = Math.floor(absoluteBeat / length);
    const beat = absoluteBeat % length;
    if (program !== this.program || cycle !== this.cycle || fill !== this.fill) {
      const group = (events: MusicEvent[]) => {
        const result = new Map<string, MusicEvent[]>();
        for (const event of events) {
          const list = result.get(event.track.name) ?? [];
          list.push(event); result.set(event.track.name, list);
        }
        return result;
      };
      this.events = group(eventsForSong(program, 0, { cycle, fill }));
      this.previous = cycle > 0 ? group(eventsForSong(program, 0, { cycle: cycle - 1, fill })) : new Map();
      this.program = program; this.cycle = cycle; this.fill = fill;
    }
    const solo = program.tracks.some(track => track.solo);
    const seconds = 60 / (state.tempo ?? program.tempo);
    return program.tracks.map(track => {
      const audible = state.playing && state.bar > 0 && !track.muted && (!solo || !!track.solo) && track.gain > 0 && (program.masterGain ?? 1) > 0;
      const events = this.events.get(track.name) ?? [];
      const latest = events.findLast(event => event.beat <= beat);
      const event = latest ?? this.previous.get(track.name)?.at(-1);
      const age = audible && event ? (beat - event.beat + (latest ? 0 : length)) * seconds : Infinity;
      const duration = event?.duration ?? 0;
      // A later short note must not hide an earlier chord tone that is still held.
      const held = audible ? events.findLast(item => item.sustained && item.beat <= beat && (beat - item.beat) * seconds < item.duration) : undefined;
      const active = !!held || age < (event?.sustained ? duration : .18);
      const tail = event?.sustained ? Math.max(0, age - duration) : age;
      const energy = audible && event ? Math.max(event.velocity * Math.exp(-tail * 10), held?.velocity ?? 0) * track.gain : 0;
      return { beat: absoluteBeat, playing: audible, active, sustained: !!held || !!event?.sustained && active, energy: energy < .005 ? 0 : energy, age, duration,
        midi: event?.step.kind === 'note' ? event.step.midi : 60, index: event?.index ?? 0 };
    });
  }
}
