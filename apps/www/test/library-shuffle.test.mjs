import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/library-shuffle.ts', import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports });
const { LibraryShuffle } = exports;

test('shuffle visits the entire library before repeating and avoids consecutive repeats', () => {
  const queue = new LibraryShuffle(), ids = ['native-single', 'record-song-a', 'record-song-b', 'browser-song'];
  let previous;
  for (let cycle = 0; cycle < 20; cycle++) {
    const visited = new Set();
    for (let index = 0; index < ids.length; index++) {
      const next = queue.next(ids, previous);
      assert.ok(ids.includes(next));
      assert.notEqual(next, previous);
      assert.ok(!visited.has(next));
      visited.add(next); previous = next;
    }
  }
});
test('shuffle reconciles additions and deletions without restarting the cycle', () => {
  const queue = new LibraryShuffle();
  assert.equal(queue.next(['a']), 'a');
  assert.equal(queue.next(['a', 'b'], 'a'), 'b');
  assert.equal(queue.next(['a', 'b', 'c'], 'b'), 'c');
  assert.equal(queue.next(['a', 'd'], 'c'), 'd');
  assert.equal(queue.next([], 'd'), undefined);
});
test('empty and single-song libraries are safe, and duplicate IDs are visited once', () => {
  const queue = new LibraryShuffle();
  assert.equal(queue.next([]), undefined);
  assert.equal(queue.next(['only']), 'only');
  assert.equal(queue.next(['only'], 'only'), 'only');
  assert.equal(queue.next(['only', 'other', 'other'], 'only'), 'other');
  assert.equal(queue.next(['only', 'other', 'other'], 'other'), 'only');
});
