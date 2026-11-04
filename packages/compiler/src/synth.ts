import type { MusicTrack } from './model.js';

export type SynthWave = 'sine' | 'triangle' | 'sawtooth' | 'square';
export type SynthTarget = 'filter' | 'pitch' | 'amp';
export interface SynthConfig {
  /** Optional for projects saved before noise-only sweeps were introduced. */
  tone?: number; filterSweep?: number; filterDecay?: number;
  enabled: boolean; osc1: SynthWave; osc2: SynthWave; mix: number; drive: number; fm: number; fmRatio: number;
  detune: number; sub: number; noise: number; noiseType: 'white' | 'metal'; voices: number; unisonDetune: number; spread: number;
  filterType: 'lowpass' | 'bandpass' | 'highpass'; cutoff: number; resonance: number; filterEnv: number; velocityFilter: number;
  lfo1Wave: SynthWave; lfo1Rate: number; lfo1Depth: number; lfo1Target: SynthTarget;
  lfo2Wave: SynthWave; lfo2Rate: number; lfo2Depth: number; lfo2Target: SynthTarget;
  attack: number; decay: number; sustain: number; release: number; glide: number; pitchEnv: number; pitchDecay: number; volume: number;
}
export const SYNTH_RANGES = {
  tone: [0,1], filterSweep: [-1,1], filterDecay: [0,2],
  mix: [0,1], drive: [0,1], fm: [0,1], fmRatio: [.25,16], detune: [-100,100], sub: [0,1], noise: [0,1],
  voices: [1,4], unisonDetune: [0,100], spread: [0,1], cutoff: [20,20000], resonance: [0,20], filterEnv: [-1,1], velocityFilter: [0,1],
  lfo1Rate: [.01,30], lfo1Depth: [0,1], lfo2Rate: [.01,30], lfo2Depth: [0,1],
  attack: [.001,2], decay: [.001,2], sustain: [0,1], release: [.005,3], glide: [0,1], pitchEnv: [-48,48], pitchDecay: [.001,2], volume: [0,1],
} as const;
export type SynthParameter = keyof typeof SYNTH_RANGES;
export type SynthLocks = Partial<Record<SynthParameter, number>>;
export interface SynthPatch { name: string; config: SynthConfig }
export const INIT_SYNTH: Readonly<Required<SynthConfig>> = Object.freeze({
  tone: 1, filterSweep: 0, filterDecay: 0,
  enabled: true, osc1: 'sine', osc2: 'triangle', mix: .5, drive: 0, fm: 0, fmRatio: 2, detune: 7, sub: .25, noise: 0, noiseType: 'white',
  voices: 1, unisonDetune: 10, spread: .8, filterType: 'lowpass', cutoff: 1800, resonance: 1.5, filterEnv: .4, velocityFilter: 0,
  lfo1Wave: 'sine', lfo1Rate: .9, lfo1Depth: .3, lfo1Target: 'filter', lfo2Wave: 'sine', lfo2Rate: .3, lfo2Depth: 0, lfo2Target: 'amp',
  attack: .4, decay: .6, sustain: .65, release: .12, glide: .08, pitchEnv: 0, pitchDecay: .06, volume: .55,
});
const waves = ['sine','triangle','sawtooth','square'];
const enums: Record<string, readonly string[]> = { osc1:waves, osc2:waves, noiseType:['white','metal'], filterType:['lowpass','bandpass','highpass'], lfo1Wave:waves, lfo2Wave:waves, lfo1Target:['filter','pitch','amp'], lfo2Target:['filter','pitch','amp'] };
export function validateSynthLocks(value: unknown): asserts value is SynthLocks {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError('Invalid synth locks');
  for (const [key, number] of Object.entries(value)) {
    if (!Object.hasOwn(SYNTH_RANGES,key)) throw new RangeError(`Unknown synth lock '${key}'`);
    const [min,max] = SYNTH_RANGES[key as SynthParameter];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max || key === 'voices' && !Number.isInteger(number)) throw new RangeError(`Invalid synth ${key}`);
  }
}
export function validateSynth(value: unknown): asserts value is SynthConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError('Invalid synth');
  const config = value as SynthConfig;
  for (const key of Object.keys(value)) if (!Object.hasOwn(INIT_SYNTH,key)) throw new RangeError(`Unknown synth parameter '${key}'`);
  if (typeof config.enabled !== 'boolean') throw new RangeError('Synth enabled must be boolean');
  for (const [key, choices] of Object.entries(enums)) if (!choices.includes(config[key as keyof SynthConfig] as string)) throw new RangeError(`Invalid synth ${key}`);
  for (const key of Object.keys(SYNTH_RANGES) as SynthParameter[]) {
    if ((key === 'tone' || key === 'filterSweep' || key === 'filterDecay') && config[key] === undefined) continue;
    validateSynthLocks({[key]:config[key]});
  }
}
export function validatePatch(patch: SynthPatch): void {
  if (!patch || typeof patch.name !== 'string' || patch.name.length < 1 || patch.name.length > 64) throw new RangeError('Patch name must have 1 to 64 characters');
  validateSynth(patch.config);
}
const patch = (name: string, config: Partial<SynthConfig>): SynthPatch => ({name, config:{...INIT_SYNTH, attack:.005, decay:.15, sustain:.4, lfo1Depth:0, glide:0, ...config}});
/** Source recipes are separate from the visible factory browser until its UI update. */
export const INSTRUMENT_PATCHES = {
  'synth/808-bass': patch('808 Bass', {osc1:'sine',osc2:'sine',mix:0,detune:0,sub:.3,drive:.32,attack:.003,decay:.24,sustain:.78,release:.2,pitchEnv:19,pitchDecay:.045,glide:.12,cutoff:900,filterEnv:0,resonance:0,volume:.55}),
  'synth/marimba': patch('Marimba', {osc1:'sine',osc2:'sine',mix:0,detune:0,sub:0,fm:.1,fmRatio:4,attack:.002,decay:.24,sustain:0,release:.08,cutoff:2400,filterEnv:0,resonance:.1,volume:.7}),
  'synth/woodblock': patch('Woodblock', {osc1:'sine',osc2:'sine',mix:0,detune:0,sub:0,fm:.28,fmRatio:2.7,attack:.001,decay:.075,sustain:0,release:.035,cutoff:2800,filterEnv:0,resonance:.3,volume:.65}),
  'synth/downlifter': patch('Noise Downlifter', {tone:0,sub:0,noise:1,attack:.003,decay:1.5,sustain:0,release:.18,cutoff:10000,filterEnv:0,filterSweep:-1,resonance:.2,volume:.6}),
  'synth/impact': patch('Impact', {osc1:'sine',osc2:'sine',mix:0,detune:0,sub:.3,noise:.65,drive:.15,attack:.001,decay:.65,sustain:0,release:.3,pitchEnv:24,pitchDecay:.07,cutoff:3600,filterEnv:0,filterSweep:-.8,resonance:.2,volume:.5}),
  'synth/muted-guitar': patch('Muted Synth Guitar', {osc1:'triangle',osc2:'sine',mix:.2,detune:0,sub:0,noise:.015,fm:.06,fmRatio:2,drive:.08,attack:.002,decay:.12,sustain:0,release:.045,cutoff:1800,filterEnv:.25,filterDecay:.07,resonance:.2,volume:.6}),
} satisfies Record<string, SynthPatch>;
export type SynthInstrumentName = keyof typeof INSTRUMENT_PATCHES;

/** Shared by validation, audio rendering and stage role selection. */
export function trackSynth(track: Pick<MusicTrack, 'source' | 'synth' | 'modular'>): SynthConfig | null | undefined {
  if (track.modular === null) return null;
  return track.modular?.config ?? track.synth ?? (track.source.kind === 'instrument' && Object.hasOwn(INSTRUMENT_PATCHES, track.source.name)
    ? INSTRUMENT_PATCHES[track.source.name as SynthInstrumentName].config : undefined);
}

/** Factory recipes named in the supplied modular browser. */
export const FACTORY_PATCHES: readonly SynthPatch[] = [
  patch('Init Saw',{osc1:'sawtooth',osc2:'sawtooth',mix:0,sub:0,cutoff:10000}),
  patch('Acid',{osc1:'sawtooth',mix:0,cutoff:500,resonance:12,filterEnv:.8,drive:.25}),
  patch('FM Bell',{fm:.7,fmRatio:2.76,sub:0,decay:.8,sustain:0,release:1,cutoff:16000}),
  patch('S&H Bleeps',{osc1:'square',mix:0,lfo1Wave:'square',lfo1Rate:7,lfo1Depth:.4,lfo1Target:'pitch',cutoff:4000}),
  patch('Karplus-ish',{osc1:'triangle',mix:0,noise:.15,decay:.08,sustain:0,filterEnv:.6,cutoff:2500}),
  patch('Kick',{osc1:'sine',mix:0,sub:0,pitchEnv:36,pitchDecay:.03,decay:.18,sustain:0,cutoff:700}),
  patch('Deep Kick',{osc1:'sine',mix:0,sub:.7,pitchEnv:24,pitchDecay:.06,decay:.35,sustain:0,cutoff:400}),
  patch('Punch Kick',{osc1:'sine',mix:0,pitchEnv:48,pitchDecay:.02,decay:.15,sustain:0,drive:.4,cutoff:1400}),
  patch('Snare',{noise:.8,mix:0,sub:0,decay:.13,sustain:0,filterType:'highpass',cutoff:500}),
  patch('Clap',{noise:1,volume:.4,mix:0,sub:0,decay:.09,sustain:0,filterType:'bandpass',cutoff:1800,resonance:.6,lfo1Target:'amp',lfo1Rate:30,lfo1Depth:1}),
  patch('Rimshot',{osc1:'square',osc2:'square',fm:.8,fmRatio:2.4,sub:0,decay:.025,sustain:0,cutoff:2000}),
  patch('Closed Hi-hat',{noise:1,noiseType:'metal',volume:.3,sub:0,decay:.035,sustain:0,release:.02,filterType:'highpass',cutoff:6500}),
  patch('Open Hi-hat',{noise:1,noiseType:'metal',volume:.3,sub:0,decay:.3,sustain:.1,release:.35,filterType:'highpass',cutoff:6000}),
  patch('Shaker',{noise:1,sub:0,attack:.015,decay:.06,sustain:0,filterType:'highpass',cutoff:5000}),
  ...['Low Tom','Mid Tom','High Tom'].map((name,i)=>patch(name,{osc1:'sine',mix:0,sub:0,pitchEnv:12+i*5,pitchDecay:.05,decay:.2,sustain:0,cutoff:800+i*600})),
  patch('Crash Cymbal',{noise:1,noiseType:'metal',sub:0,decay:1.2,sustain:.1,release:1.5,filterType:'highpass',cutoff:3500}),
  patch('Ride Cymbal',{noise:.7,noiseType:'metal',fm:.8,fmRatio:3.7,sub:0,decay:.5,sustain:.1,release:.7,filterType:'highpass',cutoff:2500}),
  patch('Cowbell',{osc1:'square',osc2:'square',fm:.4,fmRatio:1.5,sub:0,decay:.12,sustain:0,filterType:'bandpass',cutoff:1200}),
  patch('Percussion',{noise:.25,pitchEnv:12,pitchDecay:.03,decay:.09,sustain:0,cutoff:3000}),
  patch('Sub Bass',{osc1:'sine',mix:0,sub:.8,cutoff:500}),
  patch('Analog Bass',{osc1:'sawtooth',osc2:'square',cutoff:1200,filterEnv:.3}),
  patch('Acid Bass',{osc1:'sawtooth',mix:0,cutoff:400,resonance:14,filterEnv:.7,drive:.3}),
  patch('FM Bass',{fm:.5,fmRatio:1,cutoff:2200}),
  patch('Reese Bass',{osc1:'sawtooth',osc2:'sawtooth',voices:3,unisonDetune:20,cutoff:1200}),
  patch('Pluck Bass',{osc1:'triangle',mix:0,decay:.12,sustain:0,cutoff:1600}),
  patch('Acoustic Piano',{osc1:'triangle',osc2:'sine',fm:.08,fmRatio:2,sub:0,decay:.7,sustain:.15,release:.2,cutoff:6000}),
  patch('Electric Piano',{osc1:'sine',osc2:'triangle',fm:.2,fmRatio:2,sub:0,decay:.6,sustain:.2,cutoff:5000}),
  patch('FM Electric Piano',{fm:.4,fmRatio:3,sub:0,decay:.8,sustain:.1,cutoff:7000}),
  patch('Synth Brass',{osc1:'sawtooth',osc2:'sawtooth',mix:.35,detune:5,sub:0,attack:.015,decay:.18,sustain:.55,release:.12,cutoff:1100,filterEnv:.55,filterDecay:.18,resonance:.7,volume:.45}),
  patch('Flute Lead',{osc1:'sine',osc2:'triangle',mix:.18,detune:0,sub:0,noise:.025,attack:.045,decay:.15,sustain:.8,release:.18,cutoff:3200,filterEnv:.08,resonance:.3,lfo1Target:'pitch',lfo1Rate:5,lfo1Depth:.012,volume:.65}),
  patch('Chiptune Lead',{osc1:'square',osc2:'square',mix:0,detune:0,sub:0,attack:.002,decay:.09,sustain:.25,release:.035,cutoff:14000,filterEnv:0,resonance:0,volume:.35}),
  patch('String Ensemble',{osc1:'sawtooth',osc2:'sawtooth',mix:.5,detune:7,sub:0,voices:3,unisonDetune:12,spread:.85,attack:.65,decay:.5,sustain:.8,release:.9,cutoff:2400,filterEnv:.12,resonance:.3,lfo1Target:'pitch',lfo1Rate:4.5,lfo1Depth:.004,volume:.45}),
  patch('Kalimba Pluck',{osc1:'sine',osc2:'sine',mix:0,detune:0,sub:0,fm:.12,fmRatio:3.5,attack:.002,decay:.32,sustain:0,release:.15,cutoff:6500,filterEnv:0,resonance:.2,volume:.65}),
  patch('Noise Riser',{tone:0,sub:0,noise:1,attack:1.6,decay:.1,sustain:1,release:.15,cutoff:300,filterEnv:0,filterSweep:1,resonance:.2,volume:.65}),
];
