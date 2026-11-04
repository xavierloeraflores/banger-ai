import { programDurationBeats, sampleAutomation, type MusicProgram } from '@banger/compiler';
import type { VocalPerformance } from './vocal.js';
import { eventsForSong, synthForEvent, type MusicEvent, type PlaybackState } from '@banger/engine';
import { trackRole, type PerformanceRole } from './roles.js';
export { trackRole, type PerformanceRole } from './roles.js';

export interface PerformanceSnapshot { program: MusicProgram; state: PlaybackState; fill: boolean; vocals?: VocalPerformance }
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
  role?: PerformanceRole;
  /** One gesture per onset, even when the onset contains a chord. */
  gestureIndex?: number;
}

interface VisualEvent {
  event: MusicEvent;
  role: PerformanceRole;
  duration: number;
  sustained: boolean;
  gestureIndex: number;
}

/** Shares the engine's arrangement, groove, probability and fill decisions. */
export class PerformanceScore {
  private program?: MusicProgram;
  private cycle = -1;
  private fill = false;
  private events = new Map<string, VisualEvent[]>();
  private previous = new Map<string, VisualEvent[]>();

  sample(snapshot: PerformanceSnapshot): TrackMotion[] {
    const { program, state, fill } = snapshot;
    const length = programDurationBeats(program);
    const absoluteBeat = (Math.max(1, state.bar) - 1 + state.phase) * 4;
    const cycle = Math.floor(absoluteBeat / length);
    const beat = absoluteBeat % length;
    if (program !== this.program || cycle !== this.cycle || fill !== this.fill) {
      const group = (events: MusicEvent[]) => {
        const result = new Map<string, VisualEvent[]>();
        // Resolve patches and chord groups once per schedule, not every frame.
        events.sort((a, b) => a.beat - b.beat || b.duration - a.duration || (a.step.kind === 'note' ? a.step.midi : 0) - (b.step.kind === 'note' ? b.step.midi : 0));
        for (const event of events) {
          const config = synthForEvent(event);
          if (event.velocity <= 0 || config !== undefined && (!config?.enabled || config.volume <= 0 || (config.tone ?? 1) === 0 && config.sub === 0 && config.noise === 0)) continue;
          const list = result.get(event.track.name) ?? [], last = list.at(-1);
          const role = trackRole(event.track, event.step);
          list.push({ event, role, duration: event.duration * (config && !event.sustained ? .85 : 1),
            sustained: event.sustained || ['flute', 'strings', 'riser', 'bass808', 'downlifter'].includes(role),
            gestureIndex: last ? last.gestureIndex + Number(last.event.beat !== event.beat) : 0 });
          result.set(event.track.name, list);
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
      const events = this.events.get(track.name) ?? [];
      const latest = events.findLast(item => item.event.beat <= beat);
      const previous = this.previous.get(track.name)?.at(-1);
      // Select one held voice deterministically. A short later voice cannot cut
      // off the bow/breath/sweep of a note still sounding underneath it.
      const held = events.findLast(item => item.sustained && item.event.beat <= beat && (beat - item.event.beat) * seconds < item.duration);
      let voice = held ?? latest ?? previous;
      if (voice && voice !== previous) {
        const onset = voice.event.beat;
        voice = events.find(item => item.event.beat === onset && (!held || item.sustained && (beat - item.event.beat) * seconds < item.duration)) ?? voice;
      }
      const event = voice?.event;
      const curve = track.automation?.find(curve => curve.target === 'gain');
      const gain = curve && event ? sampleAutomation(curve, Math.max(0, beat - event.clipStartBeat)) : track.gain;
      const baseSynth = synthForEvent({ track, step: { kind: 'note', midi: 60 } });
      const enabled = baseSynth === undefined || !!baseSynth?.enabled;
      const audible = state.playing && state.bar > 0 && enabled && !track.muted && (!solo || !!track.solo) && gain > 0 && (program.masterGain ?? 1) > 0;
      const age = audible && event ? (beat - event.beat + (!held && !latest ? length : 0)) * seconds : Infinity;
      const duration = voice?.duration ?? 0;
      const sustained = voice?.sustained ?? false;
      const active = audible && age < (sustained ? duration : Math.min(.18, duration));
      const tail = sustained ? Math.max(0, age - duration) : age;
      const energy = audible && event ? event.velocity * Math.exp(-tail * 10) * gain : 0;
      return { beat: absoluteBeat, playing: audible, active, sustained: sustained && active, energy: energy < .005 ? 0 : energy, age, duration,
        role: voice?.role ?? trackRole(track), gestureIndex: voice?.gestureIndex ?? 0,
        midi: event?.step.kind === 'note' ? event.step.midi : 60, index: event?.index ?? 0 };
    });
  }
}
