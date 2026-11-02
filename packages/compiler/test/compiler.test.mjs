import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileMusic, serializeMusic, createDefaultProgram, CompileError, validateMusicProgram, copyMusicProgram } from '../dist/index.js';

const drum = pattern => `track kick { sound "drums/kick"; rhythm "${pattern}"; gain 0.8; }`;

test('compiles the prototype language and arithmetic precedence', () => {
  const song = compileMusic(`// a song\r\nlet beat = "x . x ."; let speed = 20 * (2 + 4); tempo speed; meter 4/4;
track kick { sound "drums/kick"; rhythm beat; gain 1 - 0.4 / 2; }
track bass { instrument "synth/bass"; notes "C-1 Eb2 F#3 G9"; gain +.5; effect reverb { mix 1 / 4; } }`);
  assert.equal(song.tempo, 120);
  assert.equal(song.tracks[0].gain, 0.8);
  assert.deepEqual(song.tracks[1].steps.map(step => step.midi), [0, 39, 54, 127]);
  assert.deepEqual(song.tracks[1].effects, [{ kind: 'reverb', mix: .25 }]);
  assert.equal(compileMusic('tempo 180 - 60 - 20;').tempo, 100);
});

test('default program and canonical serialization round trip', () => {
  const program = createDefaultProgram();
  assert.equal(program.tracks.length, 4);
  assert.ok(program.tracks.every(track => track.steps.length === 16));
  assert.deepEqual(compileMusic(serializeMusic(program)), program);
  const pitched = compileMusic('tempo 1.2e2; track lead { instrument "synth/pluck"; notes "Cb4 B#4 . A4"; gain 1e-7; effect reverb { mix .2; } }');
  assert.deepEqual(compileMusic(serializeMusic(pitched)), pitched);
  program.tracks[0].steps[0] = null;
  assert.notEqual(createDefaultProgram().tracks[0].steps[0], null);
});

test('reports exact line and column for bad source', () => {
  assert.throws(() => compileMusic('tempo 120;\r\ntrack kick {\r\n  gain missing;\r\n}'), error => {
    assert.ok(error instanceof CompileError);
    assert.equal(error.line, 3); assert.equal(error.column, 8);
    assert.match(error.message, /Unknown variable 'missing'/);
    return true;
  });
  assert.throws(() => compileMusic('tempo 120\ntrack x {}'), error => error.line === 2 && error.column === 1);
});

test('rejects malformed and unsafe expressions without executing code', () => {
  for (const source of ['tempo 1 / 0;', 'let n = 1e999;', 'tempo "120";', 'let n = "a" + "b";', 'let a = 1; let a = 2;', 'let a = unknown;', 'tempo 120; tempo 100;', 'meter 3/4;', 'meter 4/4; meter 4/4;', 'let a = "\\q";', 'let a = "unfinished', 'globalThis.alert(1);', 'let n = ;', 'tempo (120;', 'track a {']) {
    assert.throws(() => compileMusic(source), CompileError, source);
  }
});

test('rejects invalid tracks and limits work before audio scheduling', () => {
  const invalid = [drum(''), drum('X .'), drum(Array(65).fill('x').join(' ')), drum('x') + drum('x'),
    'track a { sound "bad"; rhythm "x"; }', 'track a { instrument "synth/bass"; rhythm "x"; }',
    'track a { sound "drums/kick"; notes "C4"; }', 'track a { instrument "synth/pluck"; notes "C10"; }',
    'track a { instrument "synth/pluck"; notes "Cb-1"; }', 'track a { sound "drums/kick"; rhythm "x"; gain 2; }',
    'track a { sound "drums/kick"; sound "drums/hat"; rhythm "x"; }',
    'track a { sound "drums/kick"; rhythm "x"; effect reverb { mix 2; } }',
    'track a { sound "drums/kick"; rhythm "x"; effect delay {} }',
    'track a { sound "drums/kick"; rhythm "x"; effect reverb {} effect reverb {} }',
    'tempo 19;', 'tempo 301;', ' '.repeat(65537), `tempo ${'('.repeat(100)}120${')'.repeat(100)};`,
    Array.from({ length: 17 }, (_, i) => `track t${i} { sound "drums/hat"; rhythm "x"; }`).join('\n')];
  for (const source of invalid) assert.throws(() => compileMusic(source), CompileError);
});

test('validates program objects and makes independent copies', () => {
  const original = createDefaultProgram();
  const clone = copyMusicProgram(original);
  clone.tracks[0].steps[0].kind = 'oops';
  assert.equal(original.tracks[0].steps[0].kind, 'hit');
  for (const mutate of [p => p.tempo = NaN, p => p.meter.numerator = 3, p => p.tracks[0].gain = Infinity,
    p => p.tracks[0].steps = [], p => p.tracks[0].steps = [undefined], p => p.tracks[0].steps = [{ kind: 'note', midi: 60 }],
    p => p.tracks[3].steps = [{ kind: 'note', midi: 128 }], p => p.tracks[0].name = 'bad name',
    p => p.tracks[0].source.name = 'other', p => p.tracks[0].effects = [{ kind: 'reverb', mix: -1 }]]) {
    const bad = copyMusicProgram(original); mutate(bad);
    assert.throws(() => validateMusicProgram(bad), RangeError);
    assert.throws(() => serializeMusic(bad), RangeError);
  }
});

test('all MIDI notes survive serialization', () => {
  for (let midi = 0; midi <= 127; midi++) {
    const program = { tempo: 120, meter: { numerator: 4, denominator: 4 }, tracks: [{ name: 'lead', source: { kind: 'instrument', name: 'synth/pluck' }, steps: [{ kind: 'note', midi }], gain: .4 }] };
    assert.deepEqual(compileMusic(serializeMusic(program)), program);
  }
});
