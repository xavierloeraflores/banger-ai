import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileMusic, serializeMusic, copyMusicProgram } from '../dist/index.js';

test('step performance, master, click and launch round-trip without changing the song', () => {
  const program = compileMusic(`master .65; metronome on; activePattern A; chain off;
    track kick { sound "drums/kick"; rhythm "x@.35?.8!fill . x?0!every-2"; pattern A { rhythm "x@.5!first"; } }
    section verse { play kick; } song { play verse 2; }`);
  assert.deepEqual(compileMusic(serializeMusic(program)), program);
  assert.deepEqual(copyMusicProgram(program), program);
  assert.equal(program.tracks[0].steps[0].velocity, .35);
  for (const token of ['x@2', 'x?-1', 'x!unknown', 'x@NaN', 'x?.1.2', '.@.5']) assert.throws(() => compileMusic(`track k { sound "drums/kick"; rhythm "${token}"; }`));
  for (const text of ['master 2;', 'metronome maybe;', 'master .5; master .7;']) assert.throws(() => compileMusic(text));
});
