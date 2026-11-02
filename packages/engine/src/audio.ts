import type { MusicProgram, MusicTrack } from '@banger/compiler';
import { barDuration, eventsForBar } from './events.js';
import { createDrums, createImpulse } from './sounds.js';
export interface RenderedBar { cleanupAt: number; dispose(): void }
export class AudioRenderer {
  private readonly drums;
  private readonly impulse;
  private readonly master: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly active = new Set<RenderedBar>();
  private disposed = false;
  constructor(private readonly context: BaseAudioContext) {
    this.drums = createDrums(context);
    this.impulse = createImpulse(context);
    this.master = context.createGain();
    this.master.gain.value = .6;
    this.compressor = context.createDynamicsCompressor();
    this.master.connect(this.compressor).connect(context.destination);
  }
  renderBar(program: MusicProgram, start: number, skipBefore = -Infinity): RenderedBar {
    if (this.disposed) throw new Error('Audio renderer has been disposed');
    const events = eventsForBar(program, start);
    const context = this.context, nodes: AudioNode[] = [], sources = new Set<AudioScheduledSourceNode>();
    const inputs = new Map<MusicTrack, GainNode>();
    let tail = .5;
    for (const track of program.tracks) {
      const input = context.createGain();
      input.gain.value = track.gain;
      inputs.set(track, input); nodes.push(input);
      const effect = track.effects?.[0];
      if (effect && effect.mix > 0) {
        const convolver = context.createConvolver(), dry = context.createGain(), wet = context.createGain();
        convolver.buffer = this.impulse;
        dry.gain.value = 1 - effect.mix; wet.gain.value = effect.mix;
        input.connect(dry).connect(this.master);
        input.connect(convolver).connect(wet).connect(this.master);
        nodes.push(convolver, dry, wet);
        tail = 1.7;
      } else input.connect(this.master);
    }
    let cancelled = false;
    const rendered: RenderedBar = {
      cleanupAt: start + barDuration(program) + tail,
      dispose: () => {
        if (cancelled) return;
        cancelled = true;
        for (const source of sources) { source.onended = null; source.stop(); source.disconnect(); }
        sources.clear();
        for (const node of nodes) node.disconnect();
        this.active.delete(rendered);
      },
    };
    this.active.add(rendered);
    try {
      for (const event of events) {
        if (event.time < skipBefore || event.track.gain === 0) continue;
        const input = inputs.get(event.track)!;
        let source: AudioScheduledSourceNode;
        let envelope: GainNode | undefined;
        if (event.track.source.kind === 'sound') {
          const sample = context.createBufferSource();
          sample.buffer = this.drums[event.track.source.name];
          sample.connect(input); source = sample;
        } else if (event.step.kind === 'note') {
          const oscillator = context.createOscillator();
          const bass = event.track.source.name === 'synth/bass';
          oscillator.type = bass ? 'triangle' : 'sine';
          oscillator.frequency.value = 440 * 2 ** ((event.step.midi - 69) / 12);
          envelope = context.createGain(); nodes.push(envelope);
          const duration = Math.min(event.duration * .85, bass ? .6 : .35);
          const attack = Math.min(.008, duration / 4);
          envelope.gain.setValueAtTime(0, event.time);
          envelope.gain.linearRampToValueAtTime(bass ? .45 : .55, event.time + attack);
          envelope.gain.exponentialRampToValueAtTime(.025, event.time + duration);
          envelope.gain.linearRampToValueAtTime(0, event.time + duration + .05);
          oscillator.connect(envelope).connect(input); source = oscillator;
          source.start(event.time); source.stop(event.time + duration + .05);
        } else continue;
        sources.add(source);
        source.onended = () => { source.disconnect(); envelope?.disconnect(); sources.delete(source); };
        if (event.track.source.kind === 'sound') source.start(event.time);
      }
    } catch (error) { rendered.dispose(); throw error; }
    return rendered;
  }
  dispose(): void {
    if (this.disposed) return;
    for (const bar of this.active) bar.dispose();
    this.master.disconnect(); this.compressor.disconnect(); this.disposed = true;
  }
}
