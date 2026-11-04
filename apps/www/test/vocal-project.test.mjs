import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/elevenlabs.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function backend(window, cloudRequest = () => {}) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, window, URL, crypto, Uint8Array, require: path => {
    if (path === './ai-providers') return { browserElevenLabsKey: () => 'fixture', aiSettingsBridge: () => ({ load: async () => ({ elevenLabsConfigured: false }) }) };
    if (path === './cloud-projects') return { cloudRequest, uploadWav: async () => 'artifact' };
    return {};
  } });
  return exports;
}
test('desktop vocal backend captures its song token for polling and both upload paths', async () => {
  const calls = [];
  const native = Object.fromEntries(['list', 'operations', 'importWav', 'rendered'].map(name => [name, async (...args) => { calls.push([name, ...args]); return []; }]));
  const api = backend({ bangerMusic: native }).desktopMusic('project-a-song-one');
  await api.list(); await api.operations(); await api.upload(); await api.rendered(new ArrayBuffer(4), 'external.wav', 'later-project-token');
  assert.equal(calls[0][1], 'project-a-song-one');
  assert.equal(calls[1][1], 'project-a-song-one');
  assert.equal(calls[2][2], 'project-a-song-one');
  assert.equal(calls[3][4], 'project-a-song-one');
});
test('cloud vocals filter songs and jobs by the active file and retain upload ownership', async () => {
  const calls = [];
  const request = async (connection, path, method, body) => {
    calls.push({ connection, path, body });
    if (method === 'POST') return { id: 'upload', musicId: 'upload', status: 'queued' };
    if (path.endsWith('/music')) return { music: [
      { id: 'newest-unrelated', studioPath: 'two.banger' },
      { id: 'legacy-unlinked' }, { id: 'mine', studioPath: 'one.banger' },
    ] };
    return { jobs: [
      { id: 'other-job', kind: 'elevenlabs', studioPath: 'two.banger', status: 'completed' },
      { id: 'my-upload', kind: 'elevenlabs', studioPath: 'one.banger', musicId: 'new', status: 'failed' },
      { id: 'my-edit', kind: 'elevenlabs', musicId: 'mine', status: 'completed' },
    ] };
  };
  const api = backend({}, request).cloudMusic({ url: 'https://example.test', projectId: 'project-a', revision: 1 }, 'one.banger');
  assert.deepEqual(Array.from(await api.list(), song => song.id), ['mine']);
  assert.deepEqual(Array.from(await api.operations(), job => job.id), ['my-upload', 'my-edit']);
  await api.upload(new File(['wav'], 'unrelated.wav'));
  assert.equal(calls.at(-1).body.input.studioPath, 'one.banger');
  assert.equal(calls.at(-1).path, '/projects/project-a/jobs');
  const empty = backend({}, request).cloudMusic({ url: 'https://example.test', projectId: 'project-a', revision: 1 }, 'new.banger');
  assert.equal((await empty.list()).length, 0);
  assert.equal((await empty.operations()).length, 0);
});

test('cloud polling includes actions on a newly uploaded song before the next library refresh', async () => {
  const api = backend({}, async (_connection, path, method) => {
    if (path.endsWith('/music')) return { music: [] };
    if (method === 'POST') return { id: 'edit', musicId: 'new-song', status: 'running' };
    return { jobs: [{ id: 'edit', kind: 'elevenlabs', musicId: 'new-song', status: 'completed', result: { version: 2 } }] };
  }).cloudMusic({ url: 'https://example.test', projectId: 'p', revision: 1 }, 'song.banger');
  await api.list();
  await api.act('new-song', { operation: 'edit', baseVersion: 1, edits: [{ index: 0, lyrics: 'New words' }] }, 'key');
  assert.deepEqual(Array.from(await api.operations(), job => job.id), ['edit']);
});
