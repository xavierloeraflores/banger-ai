import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileMusic, serializeMusic, validateMusicProgram, resolveArrangement, programDurationBeats } from '../dist/index.js';

const source = `track kick { sound "drums/kick"; rhythm "x ."; mute on; solo off; }
track bass { instrument "synth/bass"; notes "C2 ."; solo on; pattern B { bars 2; notes "G2 ."; } }
section verse { bars 3; play kick; }
song { play verse 2; }`;

test('chain toggle roundtrips and preserves the stored song', () => {
  const song = compileMusic(source);
  assert.equal(programDurationBeats(song), 24);
  const disabled = compileMusic(serializeMusic({ ...song, chainEnabled: false }));
  assert.deepEqual(disabled.timeline, song.timeline);
  assert.deepEqual(disabled.sections, song.sections);
  assert.equal(programDurationBeats(disabled), 4);
  assert.deepEqual(resolveArrangement(disabled).map(clip => clip.track), ['kick', 'bass']);
  const restored = compileMusic(serializeMusic({ ...disabled, chainEnabled: true }));
  assert.equal(programDurationBeats(restored), 24);
  assert.deepEqual(resolveArrangement(restored), resolveArrangement(song));
  assert.equal(restored.tracks[0].muted, true);
  assert.equal(restored.tracks[0].solo, false);
  assert.equal(restored.tracks[1].solo, true);
});

test('unchained global pattern uses matching phrases and base fallback', () => {
  const song = { ...compileMusic(source), chainEnabled: false, activePattern: 'B' };
  assert.equal(programDurationBeats(song), 8);
  assert.deepEqual(resolveArrangement(song).map(clip => [clip.track, clip.pattern, clip.durationBeats]), [['kick', undefined, 4], ['kick', undefined, 4], ['bass', 'B', 8]]);
});

test('invalid chain and mixer state is rejected', () => {
  for (const field of ['chainEnabled', 'activePattern']) assert.throws(() => validateMusicProgram({ ...compileMusic(source), [field]: 1 }), RangeError);
  for (const field of ['muted', 'solo']) {
    const song = compileMusic(source); song.tracks[0][field] = 'yes';
    assert.throws(() => validateMusicProgram(song), RangeError);
  }
  assert.throws(() => compileMusic('chain maybe;'));
  assert.throws(() => compileMusic('chain on; chain off;'));
  assert.throws(() => compileMusic(source.replace('mute on', 'mute 1')));
});
