import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMusic, serializeMusic, copyMusicProgram, INIT_SYNTH, FACTORY_PATCHES, validateMusicProgram } from '../dist/index.js';
const song = () => compileMusic('track lead { instrument "synth/lead"; notes "C3 . G3 ."; pattern second { notes "C4 ."; } }');
test('editable synth, step locks, named-pattern locks and saved modular patches survive source save/reopen', () => {
  const program = song(), track = program.tracks[0];
  track.synth = { ...INIT_SYNTH, osc1:'square', filterType:'bandpass', lfo2Target:'pitch', fm:.7, voices:4, release:3 };
  track.steps[0].locks = { cutoff:260, fm:.2, voices:2, release:2 };
  track.patterns[0].steps[0].locks = { pitchEnv:12 };
  track.modular = structuredClone(FACTORY_PATCHES[2]);
  track.patchLibrary = [{ name:'My bell', config:{...track.modular.config, drive:.4} }];
  assert.deepEqual(compileMusic(serializeMusic(copyMusicProgram(program))),program);
  track.modular = null;
  assert.deepEqual(compileMusic(serializeMusic(program)),program);
});
test('all visible factory patches validate and round trip independently', () => {
  for (const patch of FACTORY_PATCHES) { const program=song(); program.tracks[0].modular=patch; assert.deepEqual(compileMusic(serializeMusic(program)),program); }
});
test('untrusted synth config, lock indices, scalar ranges and graph budgets are rejected', () => {
  for (const [key,value] of [['voices',5],['voices',1.5],['release',9],['cutoff',Infinity],['enabled',1],['osc1','custom'],['extra',1]]) {
    const program=song();program.tracks[0].synth={...INIT_SYNTH,[key]:value};assert.throws(()=>validateMusicProgram(program));
  }
  for (const source of ['lock 1 { cutoff 20; }','lock 0 { bogus 1; }','lock 0 { cutoff 20; cutoff 40; }','lock 0 { voices 9; }','synth { enabled 3; }']) assert.throws(()=>compileMusic(`track lead { instrument "synth/lead"; notes "C3 ."; ${source} }`));
  const program=song();program.tracks[0].synth={...INIT_SYNTH,voices:4};
  program.sections=[{name:'a',bars:64,tracks:[{track:'lead'}]}];program.timeline=[{section:'a',repeats:16}];assert.throws(()=>validateMusicProgram(program),/render budget/);
  program.tracks[0].synth.enabled=false;assert.doesNotThrow(()=>validateMusicProgram(program));
});
