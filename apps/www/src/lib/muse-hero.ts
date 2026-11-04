import { programDurationBeats, type MusicProgram } from '@banger/compiler';
import { eventsForSong } from '@banger/engine';

export const HERO_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'];
export const HERO_COLORS = ['#70ff8b', '#ff67b7', '#ffda62', '#62ddff', '#cf83ff'];
export const HIT_WINDOW = .18;
export type Judgment = 'Perfect' | 'Great' | 'Good' | 'Miss';
export interface HeroNote { id: number; lane: number; time: number; end: number }
export interface HeroChart { notes: HeroNote[]; duration: number }
export interface HeroStats { score: number; combo: number; best: number; perfect: number; great: number; good: number; miss: number; held: number }

/** Use the same arrangement, groove and conditional events as the audio engine. */
export function createHeroChart(program: MusicProgram, trackName = '', laneCount: 2 | 3 | 4 | 5 = 4): HeroChart {
  const beats = programDurationBeats(program);
  const cycles = Math.max(1, Math.ceil(16 / beats));
  const seconds = 60 / program.tempo;
  const duration = beats * seconds * cycles;
  const solo = program.tracks.some(track => track.solo);
  const events = Array.from({ length: cycles }, (_, cycle) => eventsForSong(program, 0, { cycle })
    .filter(event => (!trackName || event.track.name === trackName) && !event.track.muted && (!solo || event.track.solo) && event.track.gain > 0 && (program.masterGain ?? 1) > 0)
    .map(event => ({ event, time: event.time + cycle * beats * seconds }))).flat();
  const pitches = [...new Set(events.flatMap(({ event }) => event.step.kind === 'note' ? [event.step.midi] : []))].sort((a, b) => a - b);
  const notes: HeroNote[] = [];
  const lastByLane = new Map<number, HeroNote>();
  for (const { event, time } of events) {
    const lane = event.step.kind === 'note'
      ? Math.min(laneCount - 1, Math.floor(pitches.indexOf(event.step.midi) * laneCount / Math.max(1, pitches.length)))
      : program.tracks.indexOf(event.track) % laneCount;
    const end = event.sustained && event.duration >= .35 ? Math.min(duration, time + event.duration) : time;
    const previous = lastByLane.get(lane);
    // Layered instruments can share a fret. Merge close onsets and trim overlapping holds.
    if (previous && time - previous.time < .075) { previous.end = Math.max(previous.end, end); continue; }
    if (previous) previous.end = Math.min(previous.end, time);
    const note = { id: notes.length, lane, time, end };
    notes.push(note); lastByLane.set(lane, note);
  }
  return { notes, duration };
}

export class HeroRun {
  readonly stats: HeroStats = { score: 0, combo: 0, best: 0, perfect: 0, great: 0, good: 0, miss: 0, held: 0 };
  readonly judged = new Set<number>();
  readonly holds = new Map<number, HeroNote>();
  readonly flashes = new Map<number, number>();
  judgment: Judgment | 'Hold lost' | '' = '';
  judgmentAt = -Infinity;
  private cursor = 0;
  constructor(readonly chart: HeroChart) {}
  get multiplier() { return Math.min(4, 1 + Math.floor(this.stats.combo / 10)); }
  get accuracy() {
    const total = this.stats.perfect + this.stats.great + this.stats.good + this.stats.miss;
    return total ? (this.stats.perfect + this.stats.great * .75 + this.stats.good * .4) / total * 100 : 100;
  }
  private announce(judgment: typeof this.judgment, time: number) { this.judgment = judgment; this.judgmentAt = time; }
  hit(lane: number, time: number) {
    const note = this.chart.notes.find(note => note.lane === lane && !this.judged.has(note.id) && Math.abs(note.time - time) <= HIT_WINDOW);
    // Countdown presses warm up the frets; opening notes still use the normal hit window.
    if (!note) { if (time >= 0) { this.stats.combo = 0; this.announce('Miss', time); } return false; }
    const delta = Math.abs(note.time - time);
    const judgment = delta <= .055 ? 'Perfect' : delta <= .11 ? 'Great' : 'Good';
    this.judged.add(note.id);
    this.stats[judgment === 'Perfect' ? 'perfect' : judgment === 'Great' ? 'great' : 'good']++;
    this.stats.combo++; this.stats.best = Math.max(this.stats.best, this.stats.combo);
    this.stats.score += (judgment === 'Perfect' ? 100 : judgment === 'Great' ? 75 : 40) * this.multiplier;
    if (note.end > note.time + .1) this.holds.set(lane, note);
    this.flashes.set(lane, time); this.announce(judgment, time);
    return true;
  }
  release(lane: number, time: number) {
    const hold = this.holds.get(lane);
    if (hold && time < hold.end - .1) { this.stats.combo = 0; this.announce('Hold lost', time); this.holds.delete(lane); }
  }
  advance(time: number, autoplay: boolean) {
    if (autoplay) {
      for (let index = this.cursor; index < this.chart.notes.length; index++) {
        const note = this.chart.notes[index]!;
        if (note.time > time) break;
        if (!this.judged.has(note.id)) this.hit(note.lane, note.time);
      }
    }
    while (this.cursor < this.chart.notes.length && this.chart.notes[this.cursor]!.time < time - HIT_WINDOW) {
      const note = this.chart.notes[this.cursor++]!;
      if (!this.judged.has(note.id)) {
        this.judged.add(note.id); this.stats.miss++; this.stats.combo = 0; this.announce('Miss', time);
      }
    }
    for (const [lane, note] of this.holds) if (time >= note.end - .03) {
      this.stats.score += Math.round((note.end - note.time) * 25) * this.multiplier;
      this.stats.held++; this.holds.delete(lane);
    }
  }
}
