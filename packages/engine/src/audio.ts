import { scheduleSynth, synthForEvent, synthRelease } from './synth.js';
import { programDurationBeats, type MusicProgram } from '@banger/compiler';
import { barDuration, eventsForSong, eventOccurs, songDuration, type MusicEvent } from './events.js';
import { instruments } from './instruments.js';
import { createDrums } from './sounds.js';
import { MixerGraph, scheduleCurve, silentMeters, type MeterSnapshot } from './graph.js';
export interface RenderedBar { cleanupAt: number; dispose(): void; cancelFrom(time: number): void }
type SynthEvent = MusicEvent & { previousMidi?: number };
interface GraphEntry { graph: MixerGraph; handles: number }
export class AudioRenderer {
  private readonly drums;
  private readonly active = new Set<RenderedBar>();
  private readonly graphs = new Map<MusicProgram, GraphEntry>();
  private disposed = false;
  private readonly schedules = new WeakMap<MusicProgram, { beats: number; events: SynthEvent[]; bars: SynthEvent[][] }>();
  private schedule(program: MusicProgram) {
    let schedule = this.schedules.get(program);
    if (!schedule) {
      const prior = new Map<string, { beat: number; midi: number; before?: number }>();
      const events: SynthEvent[] = eventsForSong(program, 0, { includeConditional: true }).map(event => {
        const previous = prior.get(event.track.name), midi = event.step.kind === 'note' ? event.step.midi : 36;
        const previousMidi = previous?.beat === event.beat ? previous.before : previous?.midi;
        prior.set(event.track.name, { beat: event.beat, midi, before: previousMidi });
        return { ...event, previousMidi };
      }), beats = programDurationBeats(program), bars = Array.from({ length: beats / 4 }, () => [] as SynthEvent[]);
      for (const event of events) bars[Math.floor(event.beat / 4)].push(event);
      schedule = { beats, events, bars }; this.schedules.set(program, schedule);
    }
    return schedule;
  }
  constructor(private readonly context: BaseAudioContext, private readonly solo?: string) { this.drums = createDrums(context); }
  get meters(): MeterSnapshot {
    const result = silentMeters();
    for (const { graph } of this.graphs.values()) {
      const meter = graph.meters; result.master.peak = Math.max(result.master.peak, meter.master.peak); result.master.rms = Math.hypot(result.master.rms, meter.master.rms);
      Object.assign(result.tracks, meter.tracks); Object.assign(result.buses, meter.buses);
    }
    return result;
  }
  renderBar(program: MusicProgram, start: number, skipBefore = -Infinity, barIndex = 0, fill = false): RenderedBar {
    if (!Number.isFinite(start) || start < 0 || !Number.isInteger(barIndex) || barIndex < 0) throw new RangeError('Invalid bar start or index');
    const schedule = this.schedule(program), beat = barIndex * 4 % schedule.beats;
    const events = schedule.bars[beat / 4].filter(event => eventOccurs(event, Math.floor(barIndex * 4 / schedule.beats) * event.passesPerSong, fill)).map(event => ({ ...event, time: start + (event.beat - beat) * 60 / program.tempo }));
    return this.render(program, events, start, beat, beat + 4, barDuration(program), skipBefore, true);
  }
  renderSong(program: MusicProgram, start = 0): RenderedBar { if (!Number.isFinite(start) || start < 0) throw new RangeError('Invalid song start'); const schedule = this.schedule(program); return this.render(program, schedule.events.filter(event => eventOccurs(event)).map(event => ({ ...event, time: start + event.time })), start, 0, schedule.beats, songDuration(program), -Infinity); }
  private render(program: MusicProgram, events: SynthEvent[], start: number, fromBeat: number, toBeat: number, duration: number, skipBefore: number, click = false): RenderedBar {
    if (this.disposed) throw new Error('Audio renderer has been disposed');
    let entry = this.graphs.get(program);
    if (!entry) { entry = { graph: new MixerGraph(this.context, program, this.solo), handles: 0 }; this.graphs.set(program, entry); }
    entry.handles++;
    const graph = entry.graph, context = this.context, nodes = new Set<AudioNode>(), sources = new Set<AudioScheduledSourceNode>(), sourceTimes = new Map<AudioScheduledSourceNode, number>();
    const seconds = 60 / program.tempo, origin = start - fromBeat * seconds;
    graph.automate(origin, fromBeat, toBeat);
    let cancelled = false;
    const rendered: RenderedBar = {
      cleanupAt: Math.max(start + duration, ...events.map(event => event.time + event.duration + synthRelease(event))) + graph.tail,
      cancelFrom: time => { for (const source of sources) if ((sourceTimes.get(source) ?? -Infinity) >= time) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); sources.delete(source); sourceTimes.delete(source); } },
      dispose: () => {
        if (cancelled) return; cancelled = true;
        for (const source of sources) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
        sources.clear(); for (const node of nodes) node.disconnect(); nodes.clear(); this.active.delete(rendered);
        if (--entry.handles === 0) { graph.dispose(); this.graphs.delete(program); }
      },
    };
    this.active.add(rendered);
    try {
      if (click && program.metronome && !this.solo) for (let beat = Math.ceil(fromBeat); beat < toBeat; beat++) {
        const time = origin + beat * seconds; if (time < skipBefore) continue;
        const oscillator = context.createOscillator(), envelope = context.createGain();
        oscillator.frequency.value = beat % 4 === 0 ? 1320 : 880;
        envelope.gain.setValueAtTime(.15, time); envelope.gain.exponentialRampToValueAtTime(.0001, time + .04);
        oscillator.connect(envelope).connect(graph.master); nodes.add(envelope); sources.add(oscillator); sourceTimes.set(oscillator, time);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); sources.delete(oscillator); sourceTimes.delete(oscillator); nodes.delete(envelope); };
        oscillator.start(time); oscillator.stop(time + .045);
      }
      for (const event of events) {
        if (event.time < skipBefore || event.velocity === 0 || event.track.gain === 0 && !event.track.automation?.some(curve => curve.target === 'gain')) continue;
        const input = graph.tracks.get(event.track.name)!.input;
        const register = (source: AudioScheduledSourceNode, envelope?: GainNode) => {
          sources.add(source); sourceTimes.set(source, event.time);
          source.onended = () => { source.disconnect(); envelope?.disconnect(); if (envelope) nodes.delete(envelope); sources.delete(source); sourceTimes.delete(source); };
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
        const synth = synthForEvent(event);
        if (synth !== undefined) {
          if (!synth?.enabled) continue;
          const note = scheduleSynth(context,input,event,synth,event.previousMidi);
          for (const oscillator of note.pitchOscillators) automatePitch(oscillator.detune, oscillator.detune.value, note.end);
          for (const node of note.nodes) nodes.add(node);
          let remaining = note.sources.length;
          for (const source of note.sources) {
            register(source);
            const ended = source.onended;
            source.onended = event => { ended?.call(source,event); if (--remaining === 0) for (const node of note.nodes) { node.disconnect(); nodes.delete(node); } };
            source.stop(note.end);
          }
        } else if (event.track.source.kind === 'sound') {
          const sample = context.createBufferSource(); sample.buffer = this.drums[event.track.source.name];
          const envelope = context.createGain(); envelope.gain.value = event.velocity; nodes.add(envelope);
          const minimumPitch = Math.min(0, ...pitch?.points.map(point => point.value) ?? []);
          automatePitch(sample.detune, 0, event.time + sample.buffer.duration * 2 ** (-minimumPitch / 12)); sample.connect(envelope).connect(input); register(sample, envelope);
        } else if (event.step.kind === 'note') {
          const instrument = instruments[event.track.source.name];
          if (!instrument) throw new RangeError(`No voice for ${event.track.source.name}`);
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
  setMasterGain(value: number): void { for (const { graph } of this.graphs.values()) graph.master.gain.setTargetAtTime(.6 * value, this.context.currentTime, .01); }
  dispose(): void { if (this.disposed) return; for (const bar of this.active) bar.dispose(); this.disposed = true; }
}
