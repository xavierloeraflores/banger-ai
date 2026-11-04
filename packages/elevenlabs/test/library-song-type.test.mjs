import assert from 'node:assert/strict';
import test from 'node:test';
import { librarySongType } from '../dist/protocol.js';

test('library tags ignore directions and use recorded words before draft lyrics', () => {
  for (const document of [undefined, '{broken', {}, { plan: { chunks: [{ text: '[Intro]\n{drums only}' }] } }]) {
    assert.equal(librarySongType(document), 'instrumental');
  }
  const vocal = { plan: { chunks: [{ text: '[Verse]\n{softly}\nMorning light' }] } };
  assert.equal(librarySongType(vocal), 'vocal');
  assert.equal(librarySongType(JSON.stringify(vocal)), 'vocal');
  assert.equal(librarySongType({ ...vocal, audioMetadata: { wordsTimestamps: [] } }), 'instrumental');
  assert.equal(librarySongType({ audioMetadata: { wordsTimestamps: [{ word: 'Hello', startMs: 0, endMs: 100 }] } }), 'vocal');
  assert.equal(librarySongType({ audioMetadata: { wordsTimestamps: [{ word: '', startMs: 0, endMs: 100 }] } }), 'instrumental');
});
