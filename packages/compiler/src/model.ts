export type SoundName = 'drums/kick' | 'drums/snare' | 'drums/hat';
export type InstrumentName = 'synth/bass' | 'synth/pluck';
export type Step = null | { kind: 'hit' } | { kind: 'note'; midi: number };
export interface ReverbEffect { kind: 'reverb'; mix: number }
export interface MusicTrack {
  name: string;
  source: { kind: 'sound'; name: SoundName } | { kind: 'instrument'; name: InstrumentName };
  steps: Step[];
  gain: number;
  effects?: ReverbEffect[];
}
export interface MusicProgram {
  tempo: number;
  meter: { numerator: 4; denominator: 4 };
  tracks: MusicTrack[];
}
export const MUSIC_LIMITS = Object.freeze({ minTempo: 20, maxTempo: 300, tracks: 16, steps: 64, sourceLength: 65536 });
export const SOUND_NAMES: readonly SoundName[] = ['drums/kick', 'drums/snare', 'drums/hat'];
export const INSTRUMENT_NAMES: readonly InstrumentName[] = ['synth/bass', 'synth/pluck'];
export const isTrackName = (name: unknown): name is string => typeof name === 'string' && /^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(name);

export function validateMusicProgram(value: unknown): asserts value is MusicProgram {
  const fail = (message: string): never => { throw new RangeError(message); };
  if (!value || typeof value !== 'object') fail('Expected a music program');
  const program = value as MusicProgram;
  if (!Number.isFinite(program.tempo) || program.tempo < MUSIC_LIMITS.minTempo || program.tempo > MUSIC_LIMITS.maxTempo)
    fail('Tempo must be between 20 and 300 BPM');
  if (program.meter?.numerator !== 4 || program.meter?.denominator !== 4) fail('Only 4/4 meter is supported');
  if (!Array.isArray(program.tracks) || program.tracks.length > MUSIC_LIMITS.tracks) fail('A program can have at most 16 tracks');
  const names = new Set<string>();
  for (const track of program.tracks) {
    if (!track || !isTrackName(track.name)) fail('Track names must be identifiers of 1 to 64 characters');
    if (names.has(track.name)) fail(`Duplicate track '${track.name}'`);
    names.add(track.name);
    if (!Number.isFinite(track.gain) || track.gain < 0 || track.gain > 1) fail(`Gain for '${track.name}' must be between 0 and 1`);
    if (!track.source || !((track.source.kind === 'sound' && SOUND_NAMES.includes(track.source.name)) ||
        (track.source.kind === 'instrument' && INSTRUMENT_NAMES.includes(track.source.name)))) fail(`Invalid source for '${track.name}'`);
    if (!Array.isArray(track.steps) || track.steps.length < 1 || track.steps.length > MUSIC_LIMITS.steps) fail('Patterns must have 1 to 64 steps');
    for (const step of track.steps) {
      if (step === null) continue;
      if (!step || typeof step !== 'object') fail('Invalid step');
      if (track.source.kind === 'sound' ? step.kind !== 'hit' :
        step.kind !== 'note' || !Number.isInteger(step.midi) || step.midi < 0 || step.midi > 127)
        fail('Use hits with sounds and MIDI notes from 0 to 127 with instruments');
    }
    if (track.effects !== undefined) {
      if (!Array.isArray(track.effects) || track.effects.length > 1) fail('A track supports at most one reverb');
      for (const effect of track.effects)
        if (!effect || effect.kind !== 'reverb' || !Number.isFinite(effect.mix) || effect.mix < 0 || effect.mix > 1) fail('Reverb mix must be between 0 and 1');
    }
  }
}

export function copyMusicProgram(program: MusicProgram): MusicProgram {
  validateMusicProgram(program);
  return {
    tempo: program.tempo, meter: { numerator: 4, denominator: 4 },
    tracks: program.tracks.map(track => ({
      name: track.name, source: { ...track.source }, gain: track.gain,
      steps: track.steps.map(step => step === null ? null : { ...step }),
      ...(track.effects === undefined ? {} : { effects: track.effects.map(effect => ({ ...effect })) }),
    })),
  };
}
