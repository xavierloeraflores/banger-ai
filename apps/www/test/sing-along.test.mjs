import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/sing-along.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: createRequire(import.meta.url) });
const { readSingAlong, currentLyricLine } = exports;
const words = [{ word: 'First', startMs: 500, endMs: 900 }, { word: 'light', startMs: 950, endMs: 1400 }, { word: 'Take', startMs: 3000, endMs: 3300 }, { word: 'flight', startMs: 3400, endMs: 4000 }];
const document = { plan: { chunks: [{ text: '[Verse]\n{softly}\nFirst light\nTake flight', durationMs: 5000, positiveStyles: [] }] }, audioMetadata: { wordsTimestamps: words, waveformVisual: [100, -200, 0] } };

test('native documents and browser JSON preserve lyric lines and measured timestamps', () => {
  for (const input of [document, JSON.stringify(document)]) {
    const result = readSingAlong(input);
    assert.deepEqual(Array.from(result.lines, line => line.words.map(word => word.word).join(' ')), ['First light', 'Take flight']);
    assert.deepEqual(Array.from(result.waveform), [100, -200, 0]);
    assert.equal(result.lyrics, 'First light\nTake flight');
    assert.equal(currentLyricLine(result.lines, 499), -1);
    assert.equal(currentLyricLine(result.lines, 500), 0);
    assert.equal(currentLyricLine(result.lines, 1400), -1, 'instrumental gap has no active lyric');
    assert.equal(currentLyricLine(result.lines, 3000), 1);
    assert.equal(currentLyricLine(result.lines, 4000), -1);
    assert.equal(currentLyricLine(result.lines, 600), 0, 'seeking backward finds the earlier line');
  }
});
test('edited lyric drafts cannot replace words from the saved recording', () => {
  const result = readSingAlong({ ...document, plan: { chunks: [{ text: '[Verse]\nDifferent unsung lyrics', durationMs: 5000, positiveStyles: [] }] } });
  assert.equal(result.lines.flatMap(line => line.words).map(word => word.word).join(' '), 'First light Take flight');
  assert.equal(result.lines.length, 2, 'silence separates phrases when the draft no longer matches');
});
test('missing and malformed metadata keep audio-only songs usable', () => {
  for (const input of [null, '{broken', { audioMetadata: { waveformVisual: ['bad'] } }]) {
    const result = readSingAlong(input);
    assert.equal(result.lines.length, 0); assert.equal(result.waveform.length, 0);
  }
  const result = readSingAlong({ plan: document.plan });
  assert.equal(result.lines.length, 0); assert.equal(result.lyrics, 'First light\nTake flight');
});
test('out-of-order timestamps are sorted and empty or backwards words are excluded', () => {
  const result = readSingAlong({ audioMetadata: { wordsTimestamps: [words[2], { word: 'bad', startMs: 20, endMs: 10 }, words[0], { word: '', startMs: 0, endMs: 10 }] } });
  assert.deepEqual(Array.from(result.lines.flatMap(line => line.words), word => word.word), ['First', 'Take']);
});
