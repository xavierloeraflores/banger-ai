import type { MusicProgram, MusicTrack } from '@banger/compiler';
import { barDuration, eventsForBar } from './events.js';
import { instruments } from './instruments.js';
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
    let tail = .7;
    for (const track of program.tracks) {
      const input = context.createGain();
      input.gain.value = track.gain;
      inputs.set(track, input); nodes.push(input);
      let output: AudioNode = input;
      let trackTail = .7;
      for (const effect of track.effects ?? []) {
        if (effect.kind === 'filter') {
          const filter = context.createBiquadFilter();
          filter.type = 'lowpass'; filter.frequency.value = Math.min(effect.cutoff, context.sampleRate / 2);
          filter.Q.value = effect.resonance;
          output.connect(filter); output = filter; nodes.push(filter);
        } else if (effect.mix > 0) {
          const dry = context.createGain(), wet = context.createGain(), sum = context.createGain();
          dry.gain.value = 1 - effect.mix; wet.gain.value = effect.mix;
          output.connect(dry).connect(sum);
          if (effect.kind === 'reverb') {
            const convolver = context.createConvolver(); convolver.buffer = this.impulse;
            output.connect(convolver).connect(wet).connect(sum);
            nodes.push(convolver); trackTail += 1.2;
          } else {
            const delay = context.createDelay(2), feedback = context.createGain();
            delay.delayTime.value = effect.time; feedback.gain.value = effect.feedback;
            output.connect(delay).connect(wet).connect(sum);
            delay.connect(feedback).connect(delay);
            // Fade long feedback tails to silence before reclaiming the graph.
            const delayTail = Math.min(8, effect.time * (effect.feedback === 0 ? 1 : Math.ceil(Math.log(.001) / Math.log(effect.feedback))));
            const end = start + barDuration(program) + trackTail + delayTail;
            wet.gain.setValueAtTime(effect.mix, Math.max(start, end - .05));
            wet.gain.linearRampToValueAtTime(0, end);
            feedback.gain.setValueAtTime(0, end);
            trackTail += delayTail; nodes.push(delay, feedback);
          }
          output = sum; nodes.push(dry, wet, sum);
        }
      }
      if (track.pan !== undefined) {
        const panner = context.createStereoPanner(); panner.pan.value = track.pan;
        output.connect(panner); output = panner; nodes.push(panner);
      }
      output.connect(this.master);
      tail = Math.max(tail, trackTail);
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
        if (event.time < skipBefore || event.track.gain === 0 || event.velocity === 0) continue;
        const input = inputs.get(event.track)!;
        const register = (source: AudioScheduledSourceNode, envelope?: GainNode) => {
          sources.add(source);
          source.onended = () => { source.disconnect(); envelope?.disconnect(); sources.delete(source); };
          source.start(event.time);
        };
        if (event.track.source.kind === 'sound') {
          const sample = context.createBufferSource();
          sample.buffer = this.drums[event.track.source.name];
          sample.connect(input); register(sample);
        } else if (event.step.kind === 'note') {
          const instrument = instruments[event.track.source.name];
          const duration = event.sustained ? event.duration : Math.min(event.duration * .85, instrument.gate);
          for (const voice of instrument.voices) {
            const oscillator = context.createOscillator();
            oscillator.type = voice.type;
            oscillator.frequency.value = Math.min(context.sampleRate / 2, 440 * 2 ** ((event.step.midi - 69) / 12) * voice.ratio);
            oscillator.detune.value = voice.detune;
            const envelope = context.createGain(); nodes.push(envelope);
            const attack = Math.min(instrument.attack, duration / 4);
            const peak = instrument.peak * voice.level * event.velocity;
            envelope.gain.setValueAtTime(0, event.time);
            envelope.gain.linearRampToValueAtTime(peak, event.time + attack);
            if (event.sustained) {
              envelope.gain.linearRampToValueAtTime(peak * instrument.sustain, event.time + Math.max(attack, Math.min(.08, duration / 2)));
              envelope.gain.setValueAtTime(peak * instrument.sustain, event.time + duration);
            } else envelope.gain.exponentialRampToValueAtTime(Math.min(.025, peak * .1), event.time + duration);
            envelope.gain.linearRampToValueAtTime(0, event.time + duration + instrument.release);
            oscillator.connect(envelope).connect(input);
            register(oscillator, envelope); oscillator.stop(event.time + duration + instrument.release);
          }
        }
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
