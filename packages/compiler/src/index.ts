export * from './synth.js';
import type { SynthConfig } from './synth.js';
import { compileMusic } from './parser.js';
import { validateMusicProgram, type MusicProgram, type MusicTrack, type MusicBus, type MusicPattern } from './model.js';
export { compileMusic } from './parser.js';
export { CompileError, type Position } from './lexer.js';
export * from './model.js';
export { BANGER_LANGUAGE_GUIDE } from './language.js';

export function serializeMusic(program: MusicProgram): string {
  validateMusicProgram(program);
  const pitches = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pitch = (midi: number) => `${pitches[midi % 12]}${Math.floor(midi / 12) - 1}`;
  const lines = [`tempo ${program.tempo};`, 'meter 4/4;'];
  if (program.chainEnabled !== undefined) lines.push(`chain ${program.chainEnabled ? 'on' : 'off'};`);
  if (program.masterGain !== undefined) lines.push(`master ${program.masterGain};`);
  if (program.metronome !== undefined) lines.push(`metronome ${program.metronome ? 'on' : 'off'};`);
  if (program.activePattern !== undefined) lines.push(`activePattern ${program.activePattern};`);
  const synthBlock = (config: SynthConfig) => `{ ${Object.entries(config).map(([key,value]) => `${key} ${typeof value === 'boolean' ? Number(value) : JSON.stringify(value)};`).join(' ')} }`;
  const phrase = (pattern: Pick<MusicPattern, 'bars' | 'steps' | 'pianoRoll'>, source: MusicTrack['source'], indent: string): void => {
    if (pattern.bars !== undefined) lines.push(`${indent}bars ${pattern.bars};`);
    if (pattern.pianoRoll === undefined) {
      const steps = pattern.steps.map(step => step === null ? '.' : `${step.kind === 'hit' ? 'x' : pitch(step.midi)}${step.velocity === undefined ? '' : `@${step.velocity}`}${step.probability === undefined ? '' : `?${step.probability}`}${step.condition === undefined ? '' : `!${step.condition}`}`).join(' ');
      lines.push(`${indent}${source.kind === 'sound' ? 'rhythm' : 'notes'} ${JSON.stringify(steps)};`);
      pattern.steps.forEach((step,index) => { if (step?.locks && Object.keys(step.locks).length) lines.push(`${indent}lock ${index} { ${Object.entries(step.locks).map(([key,value]) => `${key} ${value};`).join(' ')} }`); });
    } else lines.push(`${indent}piano {`, ...pattern.pianoRoll.map(note => `${indent}  note ${JSON.stringify(pitch(note.midi))} start ${note.start} duration ${note.duration} velocity ${note.velocity};`), `${indent}}`);
  };
  const mixer = (item: MusicBus | MusicTrack): void => {
    lines.push(`  gain ${item.gain};`);
    if (item.pan !== undefined) lines.push(`  pan ${item.pan};`);
    for (const effect of item.effects ?? []) lines.push(`  effect ${effect.kind} { ${Object.entries(effect).filter(([key, value]) => key !== 'kind' && value !== undefined).map(([key, value]) => `${key} ${value};`).join(' ')} }`);
    for (const send of item.sends ?? []) lines.push(`  send ${send.bus} ${send.gain};`);
    for (const curve of item.automation ?? []) {
      lines.push(`  automation ${JSON.stringify(curve.target)} {`);
      if (curve.interpolation !== undefined) lines.push(`    interpolation ${curve.interpolation};`);
      lines.push(...curve.points.map(point => `    point ${point.beat} ${point.value};`), '  }');
    }
  };
  for (const track of program.tracks) {
    lines.push('', `track ${track.name} {`, `  ${track.source.kind} ${JSON.stringify(track.source.name)};`);
    if (track.synth) lines.push(`  synth ${synthBlock(track.synth)}`);
    if (track.modular !== undefined) lines.push(`  modular ${JSON.stringify(track.modular?.name ?? '')}${track.modular ? ' '+synthBlock(track.modular.config) : ';'}`);
    for (const patch of track.patchLibrary ?? []) lines.push(`  patch ${JSON.stringify(patch.name)} ${synthBlock(patch.config)}`);
    phrase(track, track.source, '  ');
    for (const pattern of track.patterns ?? []) {
      lines.push(`  pattern ${pattern.name} {`); phrase(pattern, track.source, '    '); lines.push('  }');
    }
    if (track.groove !== undefined) lines.push(`  groove { ${Object.entries(track.groove).filter(([, value]) => value !== undefined).map(([key, value]) => `${key} ${value};`).join(' ')} }`);
    if (track.output !== undefined) lines.push(`  output ${track.output};`);
    if (track.muted !== undefined) lines.push(`  mute ${track.muted ? 'on' : 'off'};`);
    if (track.solo !== undefined) lines.push(`  solo ${track.solo ? 'on' : 'off'};`);
    mixer(track); lines.push('}');
  }
  for (const bus of program.buses ?? []) { lines.push('', `bus ${bus.name} {`); mixer(bus); lines.push('}'); }
  for (const section of program.sections ?? []) lines.push('', `section ${section.name} {`, `  bars ${section.bars};`, ...section.tracks.map(binding => `  play ${binding.track}${binding.pattern === undefined ? '' : ` ${binding.pattern}`};`), '}');
  if (program.timeline !== undefined) lines.push('', 'song {', ...program.timeline.map(entry => `  play ${entry.section}${entry.repeats === undefined ? '' : ` ${entry.repeats}`};`), '}');
  return `${lines.join('\n')}\n`;
}

export function createDefaultProgram(): MusicProgram {
  return compileMusic(`tempo 120;
meter 4/4;
track kick { sound "drums/kick"; rhythm "x . . . . . . . x . . . . . . ."; gain 0.8; }
track snare { sound "drums/snare"; rhythm ". . . . x . . . . . . . x . . ."; gain 0.55; }
track hats { sound "drums/hat"; rhythm "x . x . x . x . x . x . x . x ."; gain 0.3; }
track bass { instrument "synth/bass"; notes "C2 . . . . . . . G1 . . . . . . ."; gain 0.45; }
`);
}
