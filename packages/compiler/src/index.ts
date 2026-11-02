import { compileMusic } from './parser.js';
import { validateMusicProgram, type MusicProgram } from './model.js';
export { compileMusic } from './parser.js';
export { CompileError, type Position } from './lexer.js';
export * from './model.js';

export function serializeMusic(program: MusicProgram): string {
  validateMusicProgram(program);
  const pitches = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pitch = (midi: number) => `${pitches[midi % 12]}${Math.floor(midi / 12) - 1}`;
  const lines = [`tempo ${program.tempo};`, 'meter 4/4;'];
  for (const track of program.tracks) {
    const pattern = track.steps.map(step => step === null ? '.' : step.kind === 'hit' ? 'x' : `${pitches[step.midi % 12]}${Math.floor(step.midi / 12) - 1}`).join(' ');
    lines.push('', `track ${track.name} {`, `  ${track.source.kind} ${JSON.stringify(track.source.name)};`,
      ...(track.pianoRoll === undefined
        ? [`  ${track.source.kind === 'sound' ? 'rhythm' : 'notes'} ${JSON.stringify(pattern)};`]
        : ['  piano {', ...track.pianoRoll.map(note => `    note ${JSON.stringify(pitch(note.midi))} start ${note.start} duration ${note.duration} velocity ${note.velocity};`), '  }']),
      `  gain ${track.gain};`);
    if (track.pan !== undefined) lines.push(`  pan ${track.pan};`);
    for (const effect of track.effects ?? []) {
      if (effect.kind === 'reverb') lines.push(`  effect reverb { mix ${effect.mix}; }`);
      else if (effect.kind === 'delay') lines.push(`  effect delay { mix ${effect.mix}; time ${effect.time}; feedback ${effect.feedback}; }`);
      else lines.push(`  effect ${effect.kind} { ${Object.entries(effect).filter(([key]) => key !== 'kind').map(([key, value]) => `${key} ${value};`).join(' ')} }`);
    }
    lines.push('}');
  }
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
