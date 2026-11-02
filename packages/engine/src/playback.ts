import { copyMusicProgram, type MusicProgram } from '@banger/compiler';
import { AudioRenderer, type RenderedBar } from './audio.js';
import { AudioClock } from './clock.js';
import { barDuration } from './events.js';
export interface PlaybackState { playing: boolean; bar: number; step: number; phase: number; tempo: number | null; hasPendingUpdate: boolean }
interface ScheduledBar { program: MusicProgram; start: number; end: number; index: number; audio: RenderedBar }
export class BangerPlayer {
  private context?: AudioContext;
  private renderer?: AudioRenderer;
  private clock?: AudioClock;
  private bars: ScheduledBar[] = [];
  private pending?: MusicProgram;
  private running = false;
  private disposed = false;
  private generation = 0;
  private closing?: Promise<void>;

  get state(): PlaybackState {
    const now = this.context?.currentTime ?? 0;
    const current = this.bars.findLast(bar => bar.start <= now && bar.end > now);
    const latest = this.bars.at(-1);
    const program = current?.program ?? latest?.program;
    const elapsedBars = latest && now >= latest.end ? Math.floor((now - latest.start) / barDuration(latest.program)) : 0;
    const start = current?.start ?? (latest ? latest.start + elapsedBars * barDuration(latest.program) : now);
    const phase = program ? Math.max(0, Math.min(1 - Number.EPSILON, (now - start) / barDuration(program))) : 0;
    return {
      playing: this.running,
      bar: current?.index ?? (latest ? latest.index + elapsedBars : 0),
      step: Math.floor(phase * 16),
      phase,
      tempo: program?.tempo ?? null,
      hasPendingUpdate: Boolean(this.pending) || this.bars.some(bar => bar.start > now && current && bar.program !== current.program),
    };
  }
  async start(program: MusicProgram): Promise<void> {
    if (this.disposed) throw new Error('This player has been disposed');
    const song = copyMusicProgram(program);
    this.stop();
    const generation = this.generation;
    if (!this.context) {
      if (typeof globalThis.AudioContext !== 'function') throw new Error('Web Audio is not available in this browser');
      this.context = new AudioContext();
    }
    await this.context.resume();
    if (generation !== this.generation || this.disposed) return;
    if (this.context.state !== 'running') throw new Error('Audio could not start. Press Play to retry.');
    this.renderer ??= new AudioRenderer(this.context);
    this.bars.push(this.schedule(song, this.context.currentTime + .05, 1));
    this.running = true;
    this.clock = new AudioClock(this.context, () => this.tick());
    this.clock.start();
  }
  update(program: MusicProgram): void {
    if (this.disposed) throw new Error('This player has been disposed');
    if (!this.running) throw new Error('Start playback before updating it');
    const song = copyMusicProgram(program);
    this.tick();
    const future = this.bars.findIndex(bar => bar.start > this.context!.currentTime);
    if (future >= 0) {
      const next = this.bars[future];
      for (const bar of this.bars.splice(future)) bar.audio.dispose();
      this.bars.push(this.schedule(song, next.start, next.index));
      this.pending = undefined;
    } else this.pending = song;
  }
  stop(): void {
    this.generation++;
    this.clock?.stop(); this.clock = undefined;
    for (const bar of this.bars) bar.audio.dispose();
    this.bars = []; this.pending = undefined; this.running = false;
  }
  async dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.disposed = true; this.stop(); this.renderer?.dispose();
    this.closing = this.context && this.context.state !== 'closed' ? this.context.close() : Promise.resolve();
    return this.closing;
  }
  private schedule(program: MusicProgram, start: number, index: number): ScheduledBar {
    return { program, start, end: start + barDuration(program), index,
      audio: this.renderer!.renderBar(program, start, this.context!.currentTime) };
  }
  private tick(): void {
    if (!this.running || this.context?.state !== 'running') return;
    const now = this.context.currentTime, latest = this.bars.at(-1)!;
    this.bars = this.bars.filter(bar => {
      if (bar !== latest && bar.audio.cleanupAt <= now) { bar.audio.dispose(); return false; }
      return true;
    });
    if (latest.end > now + AudioClock.lookahead) return;
    const program = this.pending ?? latest.program, duration = barDuration(program);
    const skipped = Math.max(0, Math.floor((now - latest.end) / duration));
    this.bars.push(this.schedule(program, latest.end + skipped * duration, latest.index + 1 + skipped));
    this.pending = undefined;
  }
}
