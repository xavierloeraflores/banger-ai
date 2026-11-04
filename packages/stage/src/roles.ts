import { FACTORY_PATCHES, INSTRUMENT_PATCHES, type MusicTrack, type Step, type SynthConfig } from '@banger/compiler';
import { synthForEvent } from '@banger/engine';

export type ExtendedRole = 'bass808' | 'marimba' | 'woodblock' | 'downlifter' | 'impact' | 'mutedGuitar';
export const extendedRoles: readonly PerformanceRole[] = ['bass808', 'marimba', 'woodblock', 'downlifter', 'impact', 'mutedGuitar'];
export type PerformanceRole = ExtendedRole | 'drums' | 'bass' | 'keys' | 'dance' | 'brass' | 'flute' | 'chiptune' | 'strings' | 'kalimba' | 'riser';
export type PlayedRole = 'brass' | 'flute' | 'chiptune' | 'strings' | 'kalimba' | 'riser';
export const playedRoles: readonly PerformanceRole[] = ['brass', 'flute', 'chiptune', 'strings', 'kalimba', 'riser'];
export const roleLabels: Record<PerformanceRole, string> = {
  bass808: '808 Bass', marimba: 'Marimba', woodblock: 'Woodblock', downlifter: 'Noise Downlifter', impact: 'Impact', mutedGuitar: 'Muted Synth Guitar',
  drums: 'Drums', bass: 'Bass', keys: 'Keys', dance: 'Lead / pad', brass: 'Synth Brass', flute: 'Flute Lead',
  chiptune: 'Chiptune Lead', strings: 'String Ensemble', kalimba: 'Kalimba Pluck', riser: 'Noise Riser',
};
const factoryRoles: Record<string, PerformanceRole> = {
  '808 Bass': 'bass808', 'Marimba': 'marimba', 'Woodblock': 'woodblock', 'Noise Downlifter': 'downlifter', 'Impact': 'impact', 'Muted Synth Guitar': 'mutedGuitar',
  'Synth Brass': 'brass', 'Flute Lead': 'flute', 'Chiptune Lead': 'chiptune', 'String Ensemble': 'strings', 'Kalimba Pluck': 'kalimba', 'Noise Riser': 'riser',
};
// Tone identity survives level/filter edits. A stored modular name can be stale,
// so compare the recipe itself, never the track or patch's display name.
const identity = ['osc1', 'osc2', 'mix', 'fm', 'fmRatio', 'tone', 'sub', 'noise', 'noiseType', 'voices', 'attack', 'decay', 'sustain', 'filterSweep'] as const;
const recipes = [...FACTORY_PATCHES, ...Object.values(INSTRUMENT_PATCHES)];
function synthRole(config: SynthConfig): PerformanceRole {
  const factory = recipes.find(patch => identity.every(key => patch.config[key] === config[key]));
  if (factory) {
    if (factoryRoles[factory.name]) return factoryRoles[factory.name]!;
    if (/bass|karplus/i.test(factory.name)) return 'bass';
    if (/piano|bell|bleeps/i.test(factory.name)) return 'keys';
    if (/kick|snare|clap|rimshot|hat|shaker|tom|cymbal|percussion/i.test(factory.name)) return 'drums';
  }
  // Conservative sound families also recognize edited recipes and synth-only
  // files. These do not depend on the preset browser or serialized preset names.
  if (config.noise >= .65 && (config.tone ?? 1) === 0 && (config.filterSweep ?? 0) > 0) return 'riser';
  if (config.noise >= .65 && (config.tone ?? 1) === 0 && (config.filterSweep ?? 0) < 0 && config.attack < .1) return 'downlifter';
  if (config.noise >= .4 && (config.tone ?? 1) > 0 && config.pitchEnv >= 12 && config.sustain < .1 && config.attack < .03) return 'impact';
  if (config.osc1 === 'sine' && config.mix === 0 && config.sub >= .15 && config.drive >= .1 && config.pitchEnv > 0 && config.sustain >= .5) return 'bass808';
  if (config.osc1 === 'triangle' && config.osc2 === 'sine' && config.sub === 0 && config.noise < .05 && config.sustain === 0 && config.decay <= .2 && config.drive > 0) return 'mutedGuitar';
  if (config.osc1 === 'sine' && config.mix === 0 && config.sub === 0 && config.sustain === 0 && config.attack < .01) {
    if (config.fmRatio >= 3.8 && config.fmRatio <= 4.2 && config.fm > 0 && config.fm < .2) return 'marimba';
    if (config.fmRatio >= 2.5 && config.fmRatio <= 2.9 && config.fm >= .2 && config.decay <= .12) return 'woodblock';
  }
  if (config.noise >= .65 && config.attack >= .35 && config.sustain >= .5) return 'riser';
  if (config.osc1 === 'sawtooth' && config.osc2 === 'sawtooth' && config.noise < .1 && config.sub < .1) {
    if (config.voices >= 2 && config.attack >= .2 && config.sustain >= .5) return 'strings';
    if (config.voices === 1 && config.attack < .12 && config.sustain >= .35 && config.mix >= .15) return 'brass';
  }
  if (config.osc1 === 'sine' && config.osc2 === 'triangle' && config.mix < .35 && config.sub < .1 && config.fm < .05 && config.noise < .1 && config.sustain >= .65 && config.attack < .2) return 'flute';
  if (config.osc1 === 'square' && (config.osc2 === 'square' || config.mix === 0) && config.sub < .1 && config.fm < .05 && config.noise < .1 && config.attack < .03 && config.release < .1) return 'chiptune';
  if (config.osc1 === 'sine' && (config.osc2 === 'sine' || config.mix === 0) && config.sub < .1 && config.noise < .1 && config.fm > .03 && config.fm < .3 && config.fmRatio >= 3 && config.sustain < .1 && config.attack < .03) return 'kalimba';
  return 'keys';
}

export function trackRole(track: MusicTrack, step: NonNullable<Step> = { kind: 'note', midi: 60 }): PerformanceRole {
  const config = synthForEvent({ track, step });
  if (config) return synthRole(config);
  // No override preserves the original source mappings. Disabled patches stay
  // idle in the score, including modular:null, which explicitly disconnects audio.
  if (track.source.kind === 'sound') return 'drums';
  if (track.source.name === 'synth/bass' || track.source.name === 'synth/pluck') return 'bass';
  if (['synth/keys', 'synth/organ', 'synth/bell'].includes(track.source.name)) return 'keys';
  return 'dance';
}
