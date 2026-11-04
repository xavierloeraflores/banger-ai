import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/full-send.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, setTimeout, clearTimeout, Date });
const { waitForMusic, assertLyricsPreserved } = exports;
const controller = () => new AbortController();
const complete = { id: 'mine', musicId: 'song', resultVersion: 2, status: 'completed', stage: 'Done' };

test('Full Send waits for its own acknowledged revision, ignoring other jobs', async () => {
  let polls = 0;
  const backend = {
    operations: async () => { polls++; return [{ ...complete, id: 'other' }, polls === 1 ? { ...complete, status: 'running' } : complete]; },
    get: async id => { assert.equal(id, 'song'); assert.equal(polls, 2); return { id, version: 2 }; },
  };
  const progress = [];
  assert.equal((await waitForMusic(backend, { ...complete, status: 'queued' }, controller().signal, text => progress.push(text))).version, 2);
  assert.ok(progress.length >= 3);
});
test('Full Send stops on failure, review, conflicts, stale results, and timeout', async () => {
  const backend = { get: async () => ({ version: 3 }), operations: async () => [] };
  for (const status of ['failed', 'needs_review', 'conflict']) {
    await assert.rejects(waitForMusic(backend, { ...complete, status, error: 'Provider failure' }, controller().signal, () => {}), /Provider failure/);
  }
  await assert.rejects(waitForMusic(backend, complete, controller().signal, () => {}), /composition changed/);
  await assert.rejects(waitForMusic(backend, { ...complete, status: 'running' }, controller().signal, () => {}, 0), /still pending/);
});
test('cancellation prevents the next provider poll and completed-result consumption', async () => {
  let calls = 0;
  const backend = { operations: async () => { calls++; return []; }, get: async () => { calls++; return { version: 2 }; } };
  const abort = controller();
  const pending = waitForMusic(backend, { ...complete, status: 'running' }, abort.signal, () => {});
  abort.abort();
  await assert.rejects(pending);
  await assert.rejects(waitForMusic(backend, complete, abort.signal, () => {}));
  assert.equal(calls, 0);
});
test('automatic fitting permits line distribution but rejects any rewrite, omission, repetition or reordering', () => {
  const original = '[Verse]\nKeep these words\n{softly}\n[Chorus]\nAnd these too';
  assert.doesNotThrow(() => assertLyricsPreserved(original, [{ index: 1, lyrics: 'And these too' }, { index: 0, lyrics: 'Keep\nthese words' }]));
  for (const lyrics of ['Keep those words And these too', 'Keep these words', 'Keep these words And these too And these too', 'And these too Keep these words']) {
    assert.throws(() => assertLyricsPreserved(original, [{ index: 0, lyrics }]), /changed the saved lyrics/);
  }
});
