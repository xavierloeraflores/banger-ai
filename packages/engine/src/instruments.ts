import type { InstrumentName } from '@banger/compiler';

export interface Voice { type: OscillatorType; ratio: number; detune: number; level: number }
export interface Instrument {
  attack: number; release: number; peak: number; sustain: number; gate: number; voices: readonly Voice[];
}
const voice = (type: OscillatorType, ratio = 1, level = 1, detune = 0): Voice => ({ type, ratio, level, detune });
/** Synthesized locally so every instrument also works offline. */
export const instruments: Record<InstrumentName, Instrument> = {
  'synth/bass': { attack: .008, release: .05, peak: .45, sustain: .7, gate: .6, voices: [voice('triangle')] },
  'synth/pluck': { attack: .008, release: .05, peak: .55, sustain: .7, gate: .35, voices: [voice('sine')] },
  'synth/lead': { attack: .015, release: .12, peak: .26, sustain: .65, gate: .8, voices: [voice('sawtooth')] },
  'synth/pad': { attack: .3, release: .5, peak: .3, sustain: .8, gate: 4, voices: [voice('triangle', 1, .5, -7), voice('triangle', 1, .5, 7)] },
  'synth/bell': { attack: .003, release: .3, peak: .45, sustain: .18, gate: 1.2, voices: [voice('sine', 1, .75), voice('sine', 2.76, .25)] },
  'synth/keys': { attack: .004, release: .22, peak: .4, sustain: .35, gate: 1.5, voices: [voice('triangle', 1, .7), voice('sine', 2, .2), voice('sine', 3, .1)] },
  'synth/organ': { attack: .012, release: .08, peak: .4, sustain: 1, gate: 4, voices: [voice('sine', 1, .6), voice('sine', 2, .25), voice('sine', 4, .15)] },
};
