import { resolveArrangement, sampleAutomation, type MusicProgram, type MusicEffect, type AutomationCurve, type ResolvedClip } from '@banger/compiler';
import { hasSidechainWorklet } from './sidechain.js';
import { createImpulse } from './sounds.js';
export interface MeterLevel { peak: number; rms: number }
export interface MeterSnapshot { master: MeterLevel; tracks: Record<string, MeterLevel>; buses: Record<string, MeterLevel> }
interface Strip { input: GainNode; output: AudioNode; meter?: AnalyserNode; parameters: Map<string, AudioParam[]> }
export const silentMeters = (): MeterSnapshot => ({ master: { peak: 0, rms: 0 }, tracks: {}, buses: {} });
export function scheduleCurve(param: AudioParam, curve: AutomationCurve, offset: number, seconds: number, from: number, to: number, scale = 1): void {
  if (to < from) return;
  param.setValueAtTime(sampleAutomation(curve, from) * scale, offset + from * seconds);
  for (const point of curve.points) {
    if (point.beat <= from || point.beat > to) continue;
    if (curve.interpolation === 'step') param.setValueAtTime(point.value * scale, offset + point.beat * seconds);
    else param.linearRampToValueAtTime(point.value * scale, offset + point.beat * seconds);
  }
  if (curve.interpolation !== 'step') param.linearRampToValueAtTime(sampleAutomation(curve, to) * scale, offset + to * seconds);
}
export function effectTail(effects: MusicEffect[] = [], automation: AutomationCurve[] = []): number {
  const maximum = (target: string, initial: number) => Math.max(initial, ...automation.filter(curve => curve.target === target).flatMap(curve => curve.points.map(point => point.value)));
  effects = effects.map(effect => effect.kind === 'delay' ? { ...effect, mix: maximum('delay.mix', effect.mix), time: maximum('delay.time', effect.time), feedback: maximum('delay.feedback', effect.feedback) } : effect.kind === 'reverb' ? { ...effect, mix: maximum('reverb.mix', effect.mix) } : effect);
  return effects.reduce((tail, effect) => tail + (effect.kind === 'reverb' && effect.mix > 0 ? 1.2 : effect.kind === 'delay' && effect.mix > 0 ? (effect.time * (effect.feedback === 0 ? 1 : Math.ceil(Math.log(.0001) / Math.log(effect.feedback)))) : 0), 0);
}
export class MixerGraph {
  readonly tracks = new Map<string, Strip>();
  readonly buses = new Map<string, Strip>();
  readonly master: GainNode;
  readonly tail: number;
  private readonly masterMeter?: AnalyserNode;
  private readonly nodes: AudioNode[] = [];
  private readonly meterSamples = new WeakMap<AnalyserNode, Float32Array<ArrayBuffer>>();
  private readonly controls: ConstantSourceNode[] = [];
  private readonly keys: { input: AudioNode; source: string; port?: number }[] = [];
  private readonly impulse: AudioBuffer;
  private readonly clips: ResolvedClip[];
  private readonly clipsByBar = new Map<number, ResolvedClip[]>();
  constructor(private readonly context: BaseAudioContext, readonly program: MusicProgram, solo?: string) {
    if (!hasSidechainWorklet(context) && [...program.tracks, ...program.buses ?? []].some(strip => strip.effects?.some(effect => effect.kind === 'compressor' && effect.sidechain))) throw new Error('Sidechain requires AudioWorklet. Call await prepareAudio(context) before constructing AudioRenderer on a secure origin.');
    this.clips = resolveArrangement(program);
    for (const clip of this.clips) for (let bar = Math.floor(clip.startBeat / 4); bar < Math.ceil((clip.startBeat + clip.durationBeats) / 4); bar++) {
      const clips = this.clipsByBar.get(bar) ?? []; clips.push(clip); this.clipsByBar.set(bar, clips);
    }
    this.impulse = createImpulse(context);
    this.master = this.keep(context.createGain()); this.master.gain.value = .6;
    // A fixed linear master keeps stem gain predictable; compression is explicit in the mixer.
    this.masterMeter = this.meter(this.master);
    this.master.connect(context.destination);
    for (const bus of program.buses ?? []) this.buses.set(bus.name, this.strip(bus.gain, bus.pan, bus.effects));
    for (const track of program.tracks) this.tracks.set(track.name, this.strip(track.gain, track.pan, track.effects));
    const destination = (name?: string): AudioNode => name ? this.buses.get(name)!.input : this.master;
    for (const track of program.tracks) {
      const strip = this.tracks.get(track.name)!;
      const audible = this.keep(context.createGain()); audible.gain.value = solo === undefined || solo === track.name ? 1 : 0;
      strip.output.connect(audible).connect(destination(track.output));
      for (const send of track.sends ?? []) { const gain = this.keep(context.createGain()); gain.gain.value = send.gain; audible.connect(gain).connect(destination(send.bus)); }
    }
    for (const bus of program.buses ?? []) {
      const strip = this.buses.get(bus.name)!;
      strip.output.connect(this.master);
      for (const send of bus.sends ?? []) { const gain = this.keep(context.createGain()); gain.gain.value = send.gain; strip.output.connect(gain).connect(destination(send.bus)); }
    }
    for (const key of this.keys) this.tracks.get(key.source)!.input.connect(key.input, 0, key.port ?? 0);
    const busTail = (name: string): number => { const bus = program.buses!.find(bus => bus.name === name)!; return effectTail(bus.effects, bus.automation) + Math.max(0, ...(bus.sends ?? []).map(send => busTail(send.bus))); };
    this.tail = Math.max(.7, ...program.tracks.filter(track => track.source.kind === 'sound').map(track => .65 * 2 ** (-Math.min(0, ...(track.automation ?? []).filter(curve => curve.target === 'pitch').flatMap(curve => curve.points.map(point => point.value))) / 12))) + Math.max(0, ...program.tracks.map(track => effectTail(track.effects, track.automation) + Math.max(track.output ? busTail(track.output) : 0, ...(track.sends ?? []).map(send => busTail(send.bus)))));
  }
  private keep<T extends AudioNode>(node: T): T { this.nodes.push(node); return node; }
  private meter(output: AudioNode): AnalyserNode | undefined {
    if (!this.context.createAnalyser) return undefined;
    const meter = this.keep(this.context.createAnalyser()); meter.fftSize = 1024; output.connect(meter); return meter;
  }
  private strip(gain: number, pan = 0, effects: MusicEffect[] = []): Strip {
    const context = this.context, input = this.keep(context.createGain()); input.gain.value = gain; input.channelCount = 2; input.channelCountMode = 'explicit';
    const parameters = new Map<string, AudioParam[]>();
    const bind = (name: string, parameter: AudioParam) => parameters.set(name, [...parameters.get(name) ?? [], parameter]);
    bind('gain', input.gain);
    let output: AudioNode = input;
    for (const effect of effects) {
      if (effect.kind === 'filter') {
        const filter = this.keep(context.createBiquadFilter()); filter.type = 'lowpass'; filter.frequency.value = Math.min(effect.cutoff, context.sampleRate / 2); filter.Q.value = effect.resonance;
        bind('filter.cutoff', filter.frequency); bind('filter.resonance', filter.Q); output.connect(filter); output = filter;
      } else if (effect.kind === 'eq') {
        for (const [band, type, frequency] of [['low', 'lowshelf', 200], ['mid', 'peaking', 1000], ['high', 'highshelf', 4000]] as const) {
          const filter = this.keep(context.createBiquadFilter()); filter.type = type; filter.frequency.value = frequency; filter.Q.value = .7; filter.gain.value = effect[band];
          bind(`eq.${band}`, filter.gain); output.connect(filter); output = filter;
        }
      } else if (effect.kind === 'compressor') {
        if (effect.sidechain && hasSidechainWorklet(context)) {
          const compressor = this.keep(new AudioWorkletNode(context, 'banger-sidechain', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2] }));
          for (const name of ['threshold', 'ratio', 'attack', 'release', 'knee'] as const) {
            const parameter = compressor.parameters.get(name)!; parameter.value = effect[name]; bind(`compressor.${name}`, parameter);
          }
          output.connect(compressor); output = compressor; this.keys.push({ input: compressor, source: effect.sidechain, port: 1 });
        } else if (effect.sidechain) {
          throw new Error('Sidechain requires AudioWorklet. Call await prepareAudio(context) before constructing AudioRenderer on a secure origin.');
        } else {
          const compressor = this.keep(context.createDynamicsCompressor());
          compressor.threshold.value = effect.threshold; compressor.ratio.value = effect.ratio; compressor.attack.value = effect.attack; compressor.release.value = effect.release; compressor.knee.value = effect.knee;
          bind('compressor.threshold', compressor.threshold); bind('compressor.ratio', compressor.ratio); output.connect(compressor); output = compressor;
        }
      } else {
        // Keep zero-mix effects when automated, so automation can turn them on.
        const automated = [...this.program.tracks, ...this.program.buses ?? []].some(strip => strip.automation?.some(curve => curve.target.startsWith(`${effect.kind}.`)));
        if (effect.mix === 0 && !automated) continue;
        const dry = this.keep(context.createGain()), wet = this.keep(context.createGain()), sum = this.keep(context.createGain());
        // Equal complementary gains driven by one shared control signal.
        const mix = this.keep(context.createConstantSource()), invert = this.keep(context.createGain()); this.controls.push(mix);
        mix.offset.value = effect.mix; bind(`${effect.kind}.mix`, mix.offset); invert.gain.value = -1;
        dry.gain.value = 1; wet.gain.value = 0; mix.connect(wet.gain); mix.connect(invert).connect(dry.gain); mix.start(0);
        output.connect(dry).connect(sum);
        if (effect.kind === 'reverb') { const convolver = this.keep(context.createConvolver()); convolver.buffer = this.impulse; output.connect(convolver).connect(wet); }
        else if (effect.kind === 'delay') {
          const delay = this.keep(context.createDelay(2)), feedback = this.keep(context.createGain()); delay.delayTime.value = effect.time; feedback.gain.value = effect.feedback;
          bind('delay.time', delay.delayTime); bind('delay.feedback', feedback.gain); output.connect(delay).connect(wet); delay.connect(feedback).connect(delay);
        } else {
          const drive = this.keep(context.createGain()), shaper = this.keep(context.createWaveShaper());
          drive.gain.value = 1 + effect.amount * 30;
          // amount is mapped to drive using a DC control, preserving sample-accurate curves.
          const amount = this.keep(context.createConstantSource()), scale = this.keep(context.createGain()); this.controls.push(amount);
          amount.offset.value = effect.amount; scale.gain.value = 30; drive.gain.value = 1; amount.connect(scale).connect(drive.gain); amount.start(0); bind('distortion.amount', amount.offset);
          const curve = new Float32Array(4097); for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i * 2 / (curve.length - 1) - 1) * 2) / Math.tanh(2);
          shaper.curve = curve; shaper.oversample = '2x'; output.connect(drive).connect(shaper).connect(wet);
        }
        wet.connect(sum); output = sum;
      }
    }
    const panner = this.keep(context.createStereoPanner()); panner.pan.value = pan; bind('pan', panner.pan); output.connect(panner); output = panner;
    return { input, output, parameters, meter: this.meter(output) };
  }
  automate(start: number, fromBeat: number, toBeat: number): void {
    const seconds = 60 / this.program.tempo;
    for (const clip of toBeat - fromBeat <= 4 ? this.clipsByBar.get(Math.floor(fromBeat / 4)) ?? [] : this.clips) {
      if (clip.startBeat >= toBeat || clip.startBeat + clip.durationBeats <= fromBeat) continue;
      const track = this.program.tracks.find(track => track.name === clip.track)!;
      for (const curve of track.automation ?? []) for (const parameter of this.tracks.get(track.name)!.parameters.get(curve.target) ?? [])
        scheduleCurve(parameter, curve, start + clip.startBeat * seconds, seconds, Math.max(0, fromBeat - clip.startBeat), Math.min(clip.durationBeats, toBeat - clip.startBeat));
    }
    for (const bus of this.program.buses ?? []) for (const curve of bus.automation ?? []) for (const parameter of this.buses.get(bus.name)!.parameters.get(curve.target) ?? []) scheduleCurve(parameter, curve, start, seconds, fromBeat, toBeat);
  }
  get meters(): MeterSnapshot {
    const read = (meter?: AnalyserNode): MeterLevel => {
      if (!meter) return { peak: 0, rms: 0 };
      let samples = this.meterSamples.get(meter); if (!samples) { samples = new Float32Array(meter.fftSize); this.meterSamples.set(meter, samples); } meter.getFloatTimeDomainData(samples); let peak = 0, square = 0;
      for (const sample of samples) { peak = Math.max(peak, Math.abs(sample)); square += sample * sample; }
      return { peak, rms: Math.sqrt(square / samples.length) };
    };
    return { master: read(this.masterMeter), tracks: Object.fromEntries([...this.tracks].map(([name, strip]) => [name, read(strip.meter)])), buses: Object.fromEntries([...this.buses].map(([name, strip]) => [name, read(strip.meter)])) };
  }
  dispose(): void { for (const control of this.controls) control.stop(); for (const node of this.nodes) node.disconnect(); }
}
