export type SoundName = 'drums/kick' | 'drums/snare' | 'drums/hat';
export type InstrumentName = 'synth/bass' | 'synth/pluck';
export type Step = null | { kind: 'hit' } | { kind: 'note'; midi: number };
/** A note in a one-bar piano roll. Start and duration are quarter-note beats. */
export interface PianoNote { midi: number; start: number; duration: number; velocity: number }
export interface ReverbEffect { kind: 'reverb'; mix: number }
export interface MusicTrack {
  name: string;
  source: { kind: 'sound'; name: SoundName } | { kind: 'instrument'; name: InstrumentName };
  steps: Step[];
  /** When present, steps must be empty. An empty roll is a silent instrument. */
  pianoRoll?: PianoNote[];
  gain: number;
  effects?: ReverbEffect[];
}
export interface MusicProgram {
  tempo: number;
  meter: { numerator: 4; denominator: 4 };
  tracks: MusicTrack[];
}
export const MUSIC_LIMITS = Object.freeze({ minTempo: 20, maxTempo: 300, tracks: 16, steps: 64, notes: 128, sourceLength: 65536 });
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
    if (track.pianoRoll !== undefined) {
      if (track.source.kind !== 'instrument' || !Array.isArray(track.steps) || track.steps.length !== 0)
        fail('Piano rolls require an instrument and cannot be combined with steps');
      if (!Array.isArray(track.pianoRoll) || track.pianoRoll.length > MUSIC_LIMITS.notes) fail('Piano rolls support at most 128 notes');
      for (const note of track.pianoRoll) validatePianoNote(note);
    } else if (!Array.isArray(track.steps) || track.steps.length < 1 || track.steps.length > MUSIC_LIMITS.steps) fail('Patterns must have 1 to 64 steps');
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
      ...(track.pianoRoll === undefined ? {} : { pianoRoll: track.pianoRoll.map(note => ({ ...note })) }),
      steps: track.steps.map(step => step === null ? null : { ...step }),
      ...(track.effects === undefined ? {} : { effects: track.effects.map(effect => ({ ...effect })) }),
    })),
  };
}

export function validatePianoNote(note: PianoNote): void {
  if (!note || !Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127)
    throw new RangeError('Piano pitch must be a MIDI note from 0 to 127');
  if (!Number.isFinite(note.start) || note.start < 0 || note.start >= 4)
    throw new RangeError('Note start must be at least 0 and less than 4 beats');
  if (!Number.isFinite(note.duration) || note.duration <= 0 || note.start + note.duration > 4)
    throw new RangeError('Note duration must be positive and end within 4 beats');
  if (!Number.isFinite(note.velocity) || note.velocity < 0 || note.velocity > 1)
    throw new RangeError('Note velocity must be between 0 and 1');
}

/** Read legacy notes without changing their stored pattern or timing. */
export function pianoNotes(track: MusicTrack): PianoNote[] {
  if (track.pianoRoll !== undefined) return track.pianoRoll.map(note => ({ ...note }));
  return track.steps.flatMap((step, index) => step?.kind === 'note'
    ? [{ midi: step.midi, start: index * 4 / track.steps.length,
        duration: Math.min(4 / track.steps.length, 4 - index * 4 / track.steps.length), velocity: 1 }] : []);
}
