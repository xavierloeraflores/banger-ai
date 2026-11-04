import { INSTRUMENT_PATCHES, trackSynth, validateSynth, validateSynthLocks, validatePatch, type SynthInstrumentName, type SynthConfig, type SynthLocks, type SynthPatch } from './synth.js';
export type SoundName = 'drums/kick' | 'drums/snare' | 'drums/hat' | 'drums/clap' | 'drums/tom' | 'drums/open-hat';
export type InstrumentName = 'synth/bass' | 'synth/pluck' | 'synth/lead' | 'synth/pad' | 'synth/bell' | 'synth/organ' | 'synth/keys' | SynthInstrumentName;
export const STEP_CONDITIONS = ['always', 'fill', 'not-fill', 'first', 'every-2', 'every-4'] as const;
export type StepCondition = typeof STEP_CONDITIONS[number];
export interface StepPerformance { velocity?: number; probability?: number; condition?: StepCondition; locks?: SynthLocks }
export type Step = null | (({ kind: 'hit' } | { kind: 'note'; midi: number }) & StepPerformance);
/** A note in a phrase piano roll. Start and duration are quarter-note beats. */
export interface PianoNote { midi: number; start: number; duration: number; velocity: number }
export interface ReverbEffect { kind: 'reverb'; mix: number }
export interface DelayEffect { kind: 'delay'; mix: number; time: number; feedback: number }
export interface FilterEffect { kind: 'filter'; cutoff: number; resonance: number }
export interface EqEffect { kind: 'eq'; low: number; mid: number; high: number }
export interface CompressorEffect { kind: 'compressor'; threshold: number; ratio: number; attack: number; release: number; knee: number; sidechain?: string }
export interface DistortionEffect { kind: 'distortion'; amount: number; mix: number }
export type MusicEffect = ReverbEffect | DelayEffect | FilterEffect | EqEffect | CompressorEffect | DistortionEffect;
export interface MusicPattern { name: string; bars?: number; steps: Step[]; pianoRoll?: PianoNote[] }
export interface Groove { quantize?: number; swing?: number; humanize?: number; seed?: number }
export type AutomationTarget = 'gain' | 'pan' | 'pitch' | 'filter.cutoff' | 'filter.resonance' | 'reverb.mix' | 'delay.mix' | 'delay.time' | 'delay.feedback' | 'eq.low' | 'eq.mid' | 'eq.high' | 'compressor.threshold' | 'compressor.ratio' | 'distortion.amount' | 'distortion.mix';
export interface AutomationPoint { beat: number; value: number }
export interface AutomationCurve { target: AutomationTarget; points: AutomationPoint[]; interpolation?: 'linear' | 'step' }
export interface Send { bus: string; gain: number }
export interface MusicBus { name: string; gain: number; pan?: number; effects?: MusicEffect[]; sends?: Send[]; automation?: AutomationCurve[] }
export interface MusicSection { name: string; bars: number; tracks: { track: string; pattern?: string }[] }
export interface TimelineEntry { section: string; repeats?: number }
export interface ResolvedClip { track: string; pattern?: string; startBeat: number; durationBeats: number; section?: string }
export interface MusicTrack {
  muted?: boolean;
  solo?: boolean;
  synth?: SynthConfig;
  modular?: SynthPatch | null;
  patchLibrary?: SynthPatch[];
  bars?: number;
  patterns?: MusicPattern[];
  groove?: Groove;
  output?: string;
  sends?: Send[];
  automation?: AutomationCurve[];
  name: string;
  source: { kind: 'sound'; name: SoundName } | { kind: 'instrument'; name: InstrumentName };
  steps: Step[];
  /** When present, steps must be empty. An empty roll is a silent instrument. */
  pianoRoll?: PianoNote[];
  gain: number;
  pan?: number;
  effects?: MusicEffect[];
}
export interface MusicProgram {
  chainEnabled?: boolean;
  masterGain?: number;
  metronome?: boolean;
  activePattern?: string;
  sections?: MusicSection[];
  timeline?: TimelineEntry[];
  buses?: MusicBus[];
  tempo: number;
  meter: { numerator: 4; denominator: 4 };
  tracks: MusicTrack[];
}
export const MUSIC_LIMITS = Object.freeze({ minTempo: 20, maxTempo: 300, tracks: 16, steps: 64, notes: 128, totalNotes: 4096, sourceLength: 65536, patterns: 32, bars: 64, sections: 64, timeline: 128, songBars: 1024, buses: 8, sends: 8, curves: 16, points: 128, expandedEvents: 65536 });
export const SOUND_NAMES: readonly SoundName[] = ['drums/kick', 'drums/snare', 'drums/hat', 'drums/clap', 'drums/tom', 'drums/open-hat'];
export const INSTRUMENT_NAMES: readonly InstrumentName[] = ['synth/bass', 'synth/pluck', 'synth/lead', 'synth/pad', 'synth/bell', 'synth/organ', 'synth/keys', ...Object.keys(INSTRUMENT_PATCHES) as SynthInstrumentName[]];
export const isTrackName = (name: unknown): name is string => typeof name === 'string' && /^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(name);

const fail = (message: string): never => { throw new RangeError(message); };
const range = (value: number, min: number, max: number, label: string): void => {
  if (!Number.isFinite(value) || value < min || value > max) fail(`${label} must be between ${min} and ${max}`);
};
const integer = (value: number, min: number, max: number, label: string): void => {
  range(value, min, max, label);
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
};
const array = (value: unknown, max: number, label: string): void => {
  if (!Array.isArray(value) || value.length > max) fail(`${label} supports at most ${max} entries`);
};
const name = (value: unknown): void => { if (!isTrackName(value)) fail('Names must be identifiers of 1 to 64 characters'); };
const uniqueNames = (items: { name: string }[]): Set<string> => {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item) fail('Expected a named object');
    name(item.name);
    if (seen.has(item.name)) fail(`Duplicate name '${item.name}'`);
    seen.add(item.name);
  }
  return seen;
};
export const AUTOMATION_RANGES: Readonly<Record<AutomationTarget, readonly [number, number]>> = Object.freeze({
  gain: [0, 1], pan: [-1, 1], pitch: [-48, 48], 'filter.cutoff': [20, 20000], 'filter.resonance': [0, 20],
  'reverb.mix': [0, 1], 'delay.mix': [0, 1], 'delay.time': [.01, 2], 'delay.feedback': [0, .85],
  'eq.low': [-24, 24], 'eq.mid': [-24, 24], 'eq.high': [-24, 24],
  'compressor.threshold': [-100, 0], 'compressor.ratio': [1, 20], 'distortion.amount': [0, 1], 'distortion.mix': [0, 1],
});
function validateAutomation(curves: AutomationCurve[] | undefined, effects: MusicEffect[] | undefined, bus = false): void {
  if (curves === undefined) return;
  array(curves, MUSIC_LIMITS.curves, 'Automation');
  const seen = new Set<string>();
  for (const curve of curves) {
    if (!curve || !Object.hasOwn(AUTOMATION_RANGES, curve.target)) fail('Unknown automation target');
    if (seen.has(curve.target)) fail(`Duplicate automation '${curve.target}'`);
    seen.add(curve.target);
    if (bus && curve.target === 'pitch') fail('Bus pitch automation is not supported');
    if (curve.target.includes('.') && !effects?.some(effect => effect.kind === curve.target.split('.')[0])) fail(`Automation requires effect '${curve.target.split('.')[0]}'`);
    if (curve.interpolation !== undefined && curve.interpolation !== 'linear' && curve.interpolation !== 'step') fail('Interpolation must be linear or step');
    array(curve.points, MUSIC_LIMITS.points, 'Automation points');
    if (!curve.points.length) fail('Automation needs at least one point');
    let previous = -1;
    for (const point of curve.points) {
      if (!point) fail('Invalid automation point');
      range(point.beat, 0, MUSIC_LIMITS.songBars * 4, 'Automation beat');
      if (point.beat <= previous) fail('Automation beats must be strictly increasing');
      previous = point.beat;
      const bounds = AUTOMATION_RANGES[curve.target];
      range(point.value, bounds[0], bounds[1], 'Automation value');
    }
  }
}
function validateMixer(item: MusicBus | MusicTrack, trackNames: Set<string>, busNames: Set<string>, bus = false): void {
  range(item.gain, 0, 1, 'Gain');
  if (item.pan !== undefined) range(item.pan, -1, 1, 'Pan');
  if (item.effects !== undefined) {
    array(item.effects, 6, 'Effects');
    const kinds = new Set<string>();
    for (const effect of item.effects) {
      validateEffect(effect);
      if (kinds.has(effect.kind)) fail(`Duplicate effect '${effect.kind}'`);
      kinds.add(effect.kind);
      if (effect.kind === 'compressor' && effect.sidechain !== undefined && !trackNames.has(effect.sidechain)) fail(`Unknown sidechain track '${effect.sidechain}'`);
    }
  }
  if (item.sends !== undefined) {
    array(item.sends, MUSIC_LIMITS.sends, 'Sends');
    const seen = new Set<string>();
    for (const send of item.sends) {
      if (!send || !busNames.has(send.bus)) fail('Send refers to an unknown bus');
      if (seen.has(send.bus)) fail(`Duplicate send '${send.bus}'`);
      seen.add(send.bus); range(send.gain, 0, 1, 'Send gain');
    }
  }
  validateAutomation(item.automation, item.effects, bus);
}
function validatePattern(pattern: Pick<MusicPattern, 'bars' | 'steps' | 'pianoRoll'>, source: MusicTrack['source']): number {
  if (pattern.bars !== undefined) integer(pattern.bars, 1, MUSIC_LIMITS.bars, 'Pattern bars');
  array(pattern.steps, MUSIC_LIMITS.steps, 'Steps');
  if (pattern.pianoRoll !== undefined) {
    if (source.kind !== 'instrument' || pattern.steps.length) fail('Piano rolls require an instrument and cannot be combined with steps');
    array(pattern.pianoRoll, MUSIC_LIMITS.notes, 'Piano rolls');
    for (const note of pattern.pianoRoll) validatePianoNote(note, patternDurationBeats(pattern));
  } else if (!pattern.steps.length) fail('Patterns must have 1 to 64 steps');
  for (const step of pattern.steps) {
    if (step === null) continue;
    if (!step || typeof step !== 'object') fail('Invalid step');
    if (step.velocity !== undefined) range(step.velocity, 0, 1, 'Step velocity');
    if (step.probability !== undefined) range(step.probability, 0, 1, 'Step probability');
    if (step.condition !== undefined && !STEP_CONDITIONS.includes(step.condition)) fail('Unknown step condition');
    if (step.locks !== undefined) validateSynthLocks(step.locks);
    if (source.kind === 'sound' ? step.kind !== 'hit' : step.kind !== 'note' || !Number.isInteger(step.midi) || step.midi < 0 || step.midi > 127)
      fail('Use hits with sounds and MIDI notes from 0 to 127 with instruments');
  }
  return pattern.pianoRoll?.length ?? 0;
}
export function validateGroove(groove: Groove): void {
  if (!groove || typeof groove !== 'object') fail('Invalid groove');
  if (groove.quantize !== undefined) range(groove.quantize, 1 / 128, 4, 'Quantize');
  if (groove.swing !== undefined) range(groove.swing, 0, 1, 'Swing');
  if (groove.humanize !== undefined) range(groove.humanize, 0, .5, 'Humanize');
  if (groove.seed !== undefined) integer(groove.seed, 0, 4294967295, 'Seed');
}
export function validateMusicProgram(value: unknown): asserts value is MusicProgram {
  if (!value || typeof value !== 'object') fail('Expected a music program');
  const program = value as MusicProgram;
  if (program.chainEnabled !== undefined && typeof program.chainEnabled !== 'boolean') fail('Chain enabled must be a boolean');
  if (program.activePattern !== undefined) name(program.activePattern);
  if (program.masterGain !== undefined) range(program.masterGain, 0, 1, 'Master gain');
  if (program.metronome !== undefined && typeof program.metronome !== 'boolean') fail('Metronome must be boolean');
  range(program.tempo, MUSIC_LIMITS.minTempo, MUSIC_LIMITS.maxTempo, 'Tempo');
  if (program.meter?.numerator !== 4 || program.meter?.denominator !== 4) fail('Only 4/4 meter is supported');
  array(program.tracks, MUSIC_LIMITS.tracks, 'Tracks');
  const tracks = uniqueNames(program.tracks);
  if (program.buses !== undefined) array(program.buses, MUSIC_LIMITS.buses, 'Buses');
  const buses = uniqueNames(program.buses ?? []);
  let totalNotes = 0;
  for (const track of program.tracks) {
    if (track.muted !== undefined && typeof track.muted !== 'boolean') fail('Track mute must be a boolean');
    if (track.solo !== undefined && typeof track.solo !== 'boolean') fail('Track solo must be a boolean');
    if (!track.source || !((track.source.kind === 'sound' && SOUND_NAMES.includes(track.source.name)) ||
      (track.source.kind === 'instrument' && INSTRUMENT_NAMES.includes(track.source.name)))) fail(`Invalid source for '${track.name}'`);
    if (track.synth !== undefined) validateSynth(track.synth);
    if (track.modular !== undefined && track.modular !== null) validatePatch(track.modular);
    if (track.patchLibrary !== undefined) { array(track.patchLibrary, 32, 'Saved patches'); for (const patch of track.patchLibrary) validatePatch(patch); }
    totalNotes += validatePattern(track, track.source);
    if (track.patterns !== undefined) {
      array(track.patterns, MUSIC_LIMITS.patterns, 'Patterns'); uniqueNames(track.patterns);
      for (const pattern of track.patterns) totalNotes += validatePattern(pattern, track.source);
    }
    if (track.groove !== undefined) validateGroove(track.groove);
    if (track.output !== undefined && !buses.has(track.output)) fail(`Unknown output bus '${track.output}'`);
    validateMixer(track, tracks, buses);
  }
  if (totalNotes > MUSIC_LIMITS.totalNotes) fail(`A program supports at most ${MUSIC_LIMITS.totalNotes} piano notes`);
  for (const bus of program.buses ?? []) validateMixer(bus, tracks, buses, true);
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) fail('Bus routing must not contain cycles');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const send of program.buses?.find(bus => bus.name === id)?.sends ?? []) visit(send.bus);
    visiting.delete(id); visited.add(id);
  };
  for (const id of buses) visit(id);
  if (program.sections !== undefined) array(program.sections, MUSIC_LIMITS.sections, 'Sections');
  const sections = uniqueNames(program.sections ?? []);
  for (const section of program.sections ?? []) {
    integer(section.bars, 1, MUSIC_LIMITS.bars, 'Section bars');
    array(section.tracks, MUSIC_LIMITS.tracks, 'Section tracks');
    const seen = new Set<string>();
    for (const binding of section.tracks) {
      if (!binding || !tracks.has(binding.track)) fail('Section refers to an unknown track');
      if (seen.has(binding.track)) fail(`Duplicate section track '${binding.track}'`);
      seen.add(binding.track);
      const track = program.tracks.find(track => track.name === binding.track)!;
      if (binding.pattern !== undefined && !track.patterns?.some(pattern => pattern.name === binding.pattern)) fail(`Unknown pattern '${binding.pattern}'`);
    }
  }
  if (program.timeline !== undefined) {
    array(program.timeline, MUSIC_LIMITS.timeline, 'Timeline');
    if (!program.timeline.length) fail('Song needs at least one section');
    let bars = 0;
    for (const entry of program.timeline) {
      if (!entry || !sections.has(entry.section)) fail('Timeline refers to an unknown section');
      integer(entry.repeats ?? 1, 1, MUSIC_LIMITS.songBars, 'Repeats');
      bars += program.sections!.find(section => section.name === entry.section)!.bars * (entry.repeats ?? 1);
    }
    if (bars > MUSIC_LIMITS.songBars) fail(`Song supports at most ${MUSIC_LIMITS.songBars} bars`);
  }
  // Count an upper bound without allocating the expanded arrangement or note events.
  let synthNodes = 0;
  const count = (track: MusicTrack, patternName: string | undefined, duration: number): number => {
    const pattern = resolvePattern(track, patternName);
    const events = pattern.pianoRoll?.length ?? pattern.steps.filter(step => step !== null).length;
    const repetitions = Math.ceil(duration / patternDurationBeats(pattern));
    const synth = trackSynth(track);
    if (synth?.enabled) {
      const cost = (locks?: SynthLocks) => 20 + (locks?.voices ?? synth.voices) * 8;
      synthNodes += repetitions * (pattern.pianoRoll ? pattern.pianoRoll.length * cost() : pattern.steps.reduce((sum,step) => sum + (step ? cost(step.locks) : 0),0));
    }
    return repetitions * events;
  };
  let events = 0;
  if (program.timeline && program.chainEnabled !== false) {
    for (const entry of program.timeline) {
      const section = program.sections!.find(section => section.name === entry.section)!;
      for (const binding of section.tracks) { const before = synthNodes; events += count(program.tracks.find(track => track.name === binding.track)!, binding.pattern, section.bars * 4) * (entry.repeats ?? 1); synthNodes += (synthNodes - before) * ((entry.repeats ?? 1) - 1); }
    }
  } else {
    const duration = Math.max(4, ...program.tracks.map(track => patternDurationBeats(resolvePattern(track, activePatternName(program, track)))));
    for (const track of program.tracks) events += count(track, activePatternName(program, track), duration);
  }
  if (synthNodes > 32768) fail('Custom synth arrangement exceeds the 32768-node render budget. Shorten the arrangement or reduce unison voices.');
  if (events > MUSIC_LIMITS.expandedEvents) fail(`Arrangement supports at most ${MUSIC_LIMITS.expandedEvents} expanded events`);
}

export function copyMusicProgram(program: MusicProgram): MusicProgram {
  validateMusicProgram(program);
  return JSON.parse(JSON.stringify(program)) as MusicProgram;
}

export function validatePianoNote(note: PianoNote, durationBeats = 4): void {
  if (!note || !Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127)
    throw new RangeError('Piano pitch must be a MIDI note from 0 to 127');
  if (!Number.isFinite(note.start) || note.start < 0 || note.start >= durationBeats)
    throw new RangeError(`Note start must be at least 0 and less than ${durationBeats} beats`);
  if (!Number.isFinite(note.duration) || note.duration <= 0 || note.start + note.duration > durationBeats)
    throw new RangeError(`Note duration must be positive and end within ${durationBeats} beats`);
  if (!Number.isFinite(note.velocity) || note.velocity < 0 || note.velocity > 1)
    throw new RangeError('Note velocity must be between 0 and 1');
}

/** Read legacy notes without changing their stored pattern or timing. */
export function pianoNotes(track: MusicTrack): PianoNote[] {
  if (track.pianoRoll !== undefined) return track.pianoRoll.map(note => ({ ...note }));
  return track.steps.flatMap((step, index) => step?.kind === 'note'
    ? [{ midi: step.midi, start: index * patternDurationBeats(track) / track.steps.length,
        duration: Math.min(patternDurationBeats(track) / track.steps.length, patternDurationBeats(track) - index * patternDurationBeats(track) / track.steps.length), velocity: step.velocity ?? 1 }] : []);
}

export function validateEffect(effect: MusicEffect): void {
  if (!effect || !['reverb', 'delay', 'filter', 'eq', 'compressor', 'distortion'].includes(effect.kind)) fail('Unknown effect');
  switch (effect.kind) {
    case 'filter': range(effect.cutoff, 20, 20000, 'Filter cutoff'); range(effect.resonance, 0, 20, 'Filter resonance'); break;
    case 'eq': for (const band of ['low', 'mid', 'high'] as const) range(effect[band], -24, 24, `EQ ${band}`); break;
    case 'compressor':
      range(effect.threshold, -100, 0, 'Compressor threshold'); range(effect.ratio, 1, 20, 'Compressor ratio');
      range(effect.attack, 0, 1, 'Compressor attack'); range(effect.release, 0, 1, 'Compressor release'); range(effect.knee, 0, 40, 'Compressor knee');
      if (effect.sidechain !== undefined) name(effect.sidechain);
      break;
    case 'distortion': range(effect.amount, 0, 1, 'Distortion amount'); range(effect.mix, 0, 1, 'Effect mix'); break;
    case 'delay': range(effect.time, .01, 2, 'Delay time'); range(effect.feedback, 0, .85, 'Delay feedback'); range(effect.mix, 0, 1, 'Effect mix'); break;
    case 'reverb': range(effect.mix, 0, 1, 'Effect mix'); break;
  }
}

export function patternDurationBeats(pattern: { bars?: number }): number { return (pattern.bars ?? 1) * 4; }
export function resolvePattern(track: MusicTrack, patternName?: string): MusicPattern {
  if (patternName === undefined) return { name: track.name, steps: track.steps, ...(track.bars === undefined ? {} : { bars: track.bars }), ...(track.pianoRoll === undefined ? {} : { pianoRoll: track.pianoRoll }) };
  const pattern = track.patterns?.find(item => item.name === patternName);
  if (!pattern) fail(`Unknown pattern '${patternName}'`);
  return pattern!;
}
export function programDurationBeats(program: MusicProgram): number {
  validateMusicProgram(program);
  if (!program.timeline || program.chainEnabled === false) return Math.max(4, ...program.tracks.map(track => patternDurationBeats(resolvePattern(track, activePatternName(program, track)))));
  return program.timeline.reduce((sum, entry) => sum + program.sections!.find(section => section.name === entry.section)!.bars * 4 * (entry.repeats ?? 1), 0);
}
/** A global launch falls back to a track's base phrase when that pattern is absent. */
export function activePatternName(program: MusicProgram, track: MusicTrack): string | undefined {
  return track.patterns?.some(pattern => pattern.name === program.activePattern) ? program.activePattern : undefined;
}
/** Expand bounded phrase repetitions. Clip durations truncate the final phrase at a section boundary. */
export function resolveArrangement(program: MusicProgram): ResolvedClip[] {
  validateMusicProgram(program);
  const clips: ResolvedClip[] = [];
  const add = (binding: { track: string; pattern?: string }, start: number, duration: number, section?: string): void => {
    const track = program.tracks.find(track => track.name === binding.track)!;
    const length = patternDurationBeats(resolvePattern(track, binding.pattern));
    for (let offset = 0; offset < duration; offset += length) clips.push({ ...binding, startBeat: start + offset, durationBeats: Math.min(length, duration - offset), ...(section === undefined ? {} : { section }) });
  };
  if (!program.timeline || program.chainEnabled === false) for (const track of program.tracks) {
    const pattern = activePatternName(program, track);
    add({ track: track.name, ...(pattern === undefined ? {} : { pattern }) }, 0, programDurationBeats(program));
  }
  else {
    let start = 0;
    for (const entry of program.timeline) {
      const section = program.sections!.find(section => section.name === entry.section)!;
      for (let repeat = 0; repeat < (entry.repeats ?? 1); repeat++) {
        for (const binding of section.tracks) add(binding, start, section.bars * 4, section.name);
        start += section.bars * 4;
      }
    }
  }
  return clips;
}
/** Quantize, delay alternate subdivisions, then apply deterministic timing jitter in beats. */
export function applyGroove(beat: number, groove: Groove = {}, index = 0): number {
  validateGroove(groove);
  if (!Number.isFinite(beat) || !Number.isInteger(index)) fail('Invalid groove event');
  const grid = groove.quantize ?? .5;
  let result = groove.quantize === undefined ? beat : Math.round(beat / grid) * grid;
  if (Math.abs(Math.round(result / grid) % 2) === 1) result += (groove.swing ?? 0) * grid * .5;
  let hash = ((groove.seed ?? 0) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b); hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2ae35); hash ^= hash >>> 16;
  result += (((hash >>> 0) / 4294967295) * 2 - 1) * (groove.humanize ?? 0);
  return Math.max(0, result);
}
export function sampleAutomation(curve: AutomationCurve, beat: number): number {
  if (!curve.points.length || !Number.isFinite(beat)) fail('Cannot sample empty automation or invalid beat');
  if (beat <= curve.points[0].beat) return curve.points[0].value;
  for (let index = 1; index < curve.points.length; index++) {
    const next = curve.points[index], previous = curve.points[index - 1];
    if (beat < next.beat) return curve.interpolation === 'step' ? previous.value : previous.value + (next.value - previous.value) * (beat - previous.beat) / (next.beat - previous.beat);
  }
  return curve.points[curve.points.length - 1].value;
}
