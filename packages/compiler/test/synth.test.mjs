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
  assert.equal(new Set(FACTORY_PATCHES.map(patch => patch.name)).size, FACTORY_PATCHES.length);
  for (const patch of FACTORY_PATCHES) {
    for (const mode of ['synth','modular']) {
      const program=song(); program.tracks[0][mode]=mode==='synth'?patch.config:patch;
      assert.deepEqual(compileMusic(serializeMusic(program)),program);
    }
  }
});
test('older synth configs retain their tone and filter envelope defaults', () => {
  const program=song(); program.tracks[0].synth={...INIT_SYNTH};
  delete program.tracks[0].synth.tone; delete program.tracks[0].synth.filterSweep; delete program.tracks[0].synth.filterDecay;
  assert.doesNotThrow(()=>validateMusicProgram(program));
  const restored=compileMusic(serializeMusic(program)).tracks[0].synth;
  assert.equal(restored.tone,1); assert.equal(restored.filterSweep,0); assert.equal(restored.filterDecay,0);
});
test('untrusted synth config, lock indices, scalar ranges and graph budgets are rejected', () => {
  for (const [key,value] of [['tone',-1],['tone',NaN],['filterSweep',2],['filterDecay',-1],['filterDecay',3],['voices',5],['voices',1.5],['release',9],['cutoff',Infinity],['enabled',1],['osc1','custom'],['extra',1]]) {
    const program=song();program.tracks[0].synth={...INIT_SYNTH,[key]:value};assert.throws(()=>validateMusicProgram(program));
  }
  for (const source of ['lock 1 { cutoff 20; }','lock 0 { bogus 1; }','lock 0 { cutoff 20; cutoff 40; }','lock 0 { voices 9; }','synth { enabled 3; }']) assert.throws(()=>compileMusic(`track lead { instrument "synth/lead"; notes "C3 ."; ${source} }`));
  const program=song();program.tracks[0].synth={...INIT_SYNTH,voices:4};
  program.sections=[{name:'a',bars:64,tracks:[{track:'lead'}]}];program.timeline=[{section:'a',repeats:16}];assert.throws(()=>validateMusicProgram(program),/render budget/);
  program.tracks[0].synth.enabled=false;assert.doesNotThrow(()=>validateMusicProgram(program));
});

test('built-in synth instruments round trip with patterns, locks, chords and arrangement', async () => {
  const { INSTRUMENT_PATCHES, INSTRUMENT_NAMES, BANGER_LANGUAGE_GUIDE, validateSynth } = await import('../dist/index.js');
  for (const [name, patch] of Object.entries(INSTRUMENT_PATCHES)) {
    assert.ok(INSTRUMENT_NAMES.includes(name));
    assert.ok(BANGER_LANGUAGE_GUIDE.includes(name));
    validateSynth(patch.config);
    const program = compileMusic(`track part { instrument "${name}"; notes "C2 . G2 ."; lock 0 { drive .2; release .4; }
      pattern chord { piano { note "C4" start 0 duration 1 velocity .7; note "E4" start 0 duration 1 velocity .6; } }
    } section a { bars 2; play part chord; } song { play a; }`);
    assert.equal(program.tracks[0].synth, undefined, 'recipe need not be serialized');
    assert.deepEqual(compileMusic(serializeMusic(program)), program);
    assert.ok(!FACTORY_PATCHES.some(item => item.name === patch.name), 'defer picker changes');
    const dense = compileMusic(`track part { instrument "${name}"; notes "C2 C2 C2 C2"; }`);
    dense.sections = [{ name: 'long', bars: 64, tracks: [{ track: 'part' }] }];
    dense.timeline = [{ section: 'long', repeats: 16 }];
    assert.throws(() => validateMusicProgram(dense), /render budget/);
    dense.tracks[0].modular = null;
    assert.doesNotThrow(() => validateMusicProgram(dense));
  }
  assert.throws(() => compileMusic('track bad { instrument "synth/guitar"; notes "C4"; }'), /Unknown instrument/);
});


test('agent-facing preset recipes compile to exactly the factory sound without new source syntax', async () => {
  const { BANGER_LANGUAGE_GUIDE, INSTRUMENT_PATCHES } = await import('../dist/index.js');
  for (const name of ['Music Box', 'Clavinet', '808 Bass']) {
    const line = BANGER_LANGUAGE_GUIDE.split('\n').find(line => line.startsWith(name + ': synth {'));
    assert.ok(line, name + ' recipe missing from shared agent prompt');
    const program = compileMusic('track voice { instrument "synth/keys"; notes "C4 ."; ' + line.slice(name.length + 2) + ' }');
    const patch = [...FACTORY_PATCHES, ...Object.values(INSTRUMENT_PATCHES)].find(patch => patch.name === name);
    assert.deepEqual(program.tracks[0].synth, patch.config);
    assert.deepEqual(compileMusic(serializeMusic(program)), program);
  }
  for (const source of ['synth/music-box', 'synth/clavinet']) assert.throws(() => compileMusic('track bad { instrument "' + source + '"; notes "C4"; }'), /Unknown instrument/);
});
