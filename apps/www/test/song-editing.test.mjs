import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/song-editing.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: createRequire(import.meta.url) });
const { isSongAgentEditing } = exports;
const song = { folder: { id: 'project-a' }, workspaceFile: { path: 'songs/beat.banger' }, fileName: 'beat.banger' };
const task = { id: 'writer', snapshot: song, status: 'running', history: { permissions: { beat: true, lyrics: false } } };

test('locks selected songs across chats in the same project, including before the first write', () => {
  assert.equal(isSongAgentEditing([task], song, 'another-chat'), true);
  assert.equal(isSongAgentEditing([task], { ...song, folder: { id: 'project-b' } }, 'reader'), false);
  const limited = { ...task, history: { permissions: { beat: true, lyrics: false, songs: ['songs/beat.banger'] } } };
  assert.equal(isSongAgentEditing([limited], song, 'reader'), true);
  assert.equal(isSongAgentEditing([limited], { ...song, workspaceFile: { path: 'other/beat.banger' } }, 'reader'), false);
});
test('read-only requests and completed, failed or cancelled tasks do not lock editing', () => {
  for (const status of ['idle', 'done', 'error']) assert.equal(isSongAgentEditing([{ ...task, status }], song, 'writer'), false);
  for (const permissions of [{ beat: false, lyrics: false }, { beat: true, lyrics: true, songs: [] }]) {
    assert.equal(isSongAgentEditing([{ ...task, history: { permissions } }], song, 'writer'), false);
  }
  const lyrics = { ...task, history: { permissions: { beat: false, lyrics: true } } };
  assert.equal(isSongAgentEditing([lyrics], song, 'reader'), true);
  assert.equal(isSongAgentEditing([{ ...task, status: 'done' }, lyrics], song, 'reader'), true);
});
test('folderless generation locks only its own active editor', () => {
  const local = { ...song, folder: undefined, workspaceFile: null };
  const request = { ...task, snapshot: local };
  assert.equal(isSongAgentEditing([request], local, 'writer'), true);
  assert.equal(isSongAgentEditing([request], local, 'other'), false);
});
