import { programDurationBeats, type MusicProgram } from '@banger/compiler';
import { barDuration, eventsForBar, eventsForSong, songDuration, type MusicEvent } from './events.js';
import { instruments } from './instruments.js';
import { createDrums } from './sounds.js';
import { MixerGraph, scheduleCurve, silentMeters, type MeterSnapshot } from './graph.js';
export interface RenderedBar { cleanupAt: number; dispose(): void }
interface GraphEntry { graph: MixerGraph; handles: number }
export class AudioRenderer {
  private readonly drums;
  private readonly active = new Set<RenderedBar>();
  private readonly graphs = new Map<MusicProgram, GraphEntry>();
  private disposed = false;
  constructor(private readonly context: BaseAudioContext, private readonly solo?: string) { this.drums = createDrums(context); }
  get meters(): MeterSnapshot {
    const result = silentMeters();
    for (const { graph } of this.graphs.values()) {
      const meter = graph.meters; result.master.peak = Math.max(result.master.peak, meter.master.peak); result.master.rms = Math.hypot(result.master.rms, meter.master.rms);
      Object.assign(result.tracks, meter.tracks); Object.assign(result.buses, meter.buses);
    }
    return result;
  }
  renderBar(program: MusicProgram, start: number, skipBefore = -Infinity, barIndex = 0): RenderedBar {
    const beat = barIndex * 4 % programDurationBeats(program);
    return this.render(program, eventsForBar(program, start, barIndex), start, beat, beat + 4, barDuration(program), skipBefore);
  }
  renderSong(program: MusicProgram, start = 0): RenderedBar { return this.render(program, eventsForSong(program, start), start, 0, programDurationBeats(program), songDuration(program), -Infinity); }
  private render(program: MusicProgram, events: MusicEvent[], start: number, fromBeat: number, toBeat: number, duration: number, skipBefore: number): RenderedBar {
    if (this.disposed) throw new Error('Audio renderer has been disposed');
    let entry = this.graphs.get(program);
    if (!entry) { entry = { graph: new MixerGraph(this.context, program, this.solo), handles: 0 }; this.graphs.set(program, entry); }
    entry.handles++;
    const graph = entry.graph, context = this.context, nodes = new Set<AudioNode>(), sources = new Set<AudioScheduledSourceNode>();
    const seconds = 60 / program.tempo, origin = start - fromBeat * seconds;
    graph.automate(origin, fromBeat, toBeat);
    let cancelled = false;
    const rendered: RenderedBar = {
      cleanupAt: Math.max(start + duration, ...events.map(event => event.time + event.duration)) + graph.tail,
      dispose: () => {
        if (cancelled) return; cancelled = true;
        for (const source of sources) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
        sources.clear(); for (const node of nodes) node.disconnect(); nodes.clear(); this.active.delete(rendered);
        if (--entry.handles === 0) { graph.dispose(); this.graphs.delete(program); }
      },
    };
    this.active.add(rendered);
    try {
      for (const event of events) {
        if (event.time < skipBefore || event.velocity === 0 || event.track.gain === 0 && !event.track.automation?.some(curve => curve.target === 'gain')) continue;
        const input = graph.tracks.get(event.track.name)!.input;
        const register = (source: AudioScheduledSourceNode, envelope?: GainNode) => {
          sources.add(source);
          source.onended = () => { source.disconnect(); envelope?.disconnect(); if (envelope) nodes.delete(envelope); sources.delete(source); };
          source.start(event.time);
        };
        const pitch = event.track.automation?.find(curve => curve.target === 'pitch');
        const automatePitch = (parameter: AudioParam, base: number, end: number) => {
          parameter.value = base;
          if (!pitch) return;
          const offset = origin + event.clipStartBeat * seconds, from = (event.time - offset) / seconds, to = Math.min(event.clipDurationBeats, (end - offset) / seconds);
          const shifted = { ...pitch, points: pitch.points.map(point => ({ ...point, value: point.value * 100 + base })) };
          scheduleCurve(parameter, shifted, offset, seconds, from, to);
        };
        if (event.track.source.kind === 'sound') {
          const sample = context.createBufferSource(); sample.buffer = this.drums[event.track.source.name];
          const envelope = context.createGain(); envelope.gain.value = event.velocity; nodes.add(envelope);
          automatePitch(sample.detune, 0, event.time + sample.buffer.duration); sample.connect(envelope).connect(input); register(sample, envelope);
        } else if (event.step.kind === 'note') {
          const instrument = instruments[event.track.source.name];
          const duration = event.sustained ? event.duration : Math.min(event.duration * .85, instrument.gate);
          for (const voice of instrument.voices) {
            const oscillator = context.createOscillator(); oscillator.type = voice.type;
            oscillator.frequency.value = Math.min(context.sampleRate / 2, 440 * 2 ** ((event.step.midi - 69) / 12) * voice.ratio);
            automatePitch(oscillator.detune, voice.detune, event.time + duration + instrument.release);
            const envelope = context.createGain(); nodes.add(envelope);
            const attack = Math.min(instrument.attack, duration / 4), peak = instrument.peak * voice.level * event.velocity;
            envelope.gain.setValueAtTime(0, event.time); envelope.gain.linearRampToValueAtTime(peak, event.time + attack);
            if (event.sustained) {
              envelope.gain.linearRampToValueAtTime(peak * instrument.sustain, event.time + Math.max(attack, Math.min(.08, duration / 2)));
              envelope.gain.setValueAtTime(peak * instrument.sustain, event.time + duration);
            } else envelope.gain.exponentialRampToValueAtTime(Math.min(.025, peak * .1), event.time + duration);
            envelope.gain.linearRampToValueAtTime(0, event.time + duration + instrument.release);
            oscillator.connect(envelope).connect(input); register(oscillator, envelope); oscillator.stop(event.time + duration + instrument.release);
          }
        }
      }
    } catch (error) { rendered.dispose(); throw error; }
    return rendered;
  }
  dispose(): void { if (this.disposed) return; for (const bar of this.active) bar.dispose(); this.disposed = true; }
}
