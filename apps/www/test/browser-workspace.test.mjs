import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/browser-workspace.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const music = 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain 0.5; }';
function directory(name) {
  const entries = new Map();
  return { kind: 'directory', name, entries, async *values() { yield* entries.values(); },
    async getDirectoryHandle(name, options) {
      if (!entries.has(name)) { if (!options?.create) throw new DOMException('Missing', 'NotFoundError'); entries.set(name, directory(name)); }
      return entries.get(name);
    },
    async getFileHandle(name, options) {
      if (!entries.has(name)) {
        if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
        let source = '';
        entries.set(name, { kind: 'file', name, getFile: async () => new File([source], name), createWritable: async () => ({ write: async text => { source = text; }, close: async () => {} }) });
      }
      return entries.get(name);
    },
  };
}
function browser(window) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, window, TextEncoder, require: createRequire(import.meta.url) });
  return exports.getProjectWorkspace();
}
test('folder creation stores the first song, switches projects, and protects existing content', async () => {
  const parent = directory('Projects');
  const window = { prompt: () => 'My Project', showDirectoryPicker: async () => parent };
  const api = browser(window);
  const created = await api.create('sample.banger', music);
  assert.equal(created.name, 'My Project');
  assert.equal((await api.read('sample.banger')).source, music);
  await assert.rejects(api.create('sample.banger', music), /already exists/);
  await assert.rejects(api.save('sample.banger', music + '\n', null), /changed/);
  await api.save('verse.banger', music, null);
  assert.deepEqual(Array.from(await api.list()), ['sample.banger', 'verse.banger']);
  await assert.rejects(api.save('../escape.banger', music, null), /inside/);
  await assert.rejects(api.save('verse.banger', 'invalid', music));
  const other = await parent.getDirectoryHandle('Empty', { create: true });
  window.showDirectoryPicker = async () => other;
  assert.equal((await api.open()).file, null);
  window.showDirectoryPicker = async () => parent.entries.get('My Project');
  assert.equal((await api.open()).file.path, 'sample.banger');
  window.showDirectoryPicker = async () => { throw new DOMException('Canceled', 'AbortError'); };
  assert.equal(await api.open(), null);
  assert.equal((await api.read('sample.banger')).source, music);
});
test('canceling creation does not create a folder; unsupported browsers explain folder access', async () => {
  const parent = directory('Projects');
  const api = browser({ prompt: () => 'Canceled', showDirectoryPicker: async () => { throw new DOMException('Canceled', 'AbortError'); } });
  assert.equal(await api.create('sample.banger', music), null);
  assert.equal(parent.entries.size, 0);
  await assert.rejects(browser({}).open(), /folder access/);
});

test('new projects stay empty until the first named song is saved', async () => {
  const parent = directory('Projects');
  const api = browser({ prompt: () => 'New Project', showDirectoryPicker: async () => parent });
  const folder = await api.create();
  assert.equal(folder.file, null);
  assert.deepEqual(Array.from(folder.paths), []);
  assert.equal(parent.entries.get('New Project').entries.size, 0);
  await api.save('My first song.banger', music, null);
  assert.deepEqual(Array.from(await api.list()), ['My first song.banger']);
  assert.equal((await api.read('My first song.banger')).source, music);
});

test('recent folder identities distinguish equal names and restore the intended project', async () => {
  const first = directory('Same name');
  const second = directory('Same name');
  const window = { showDirectoryPicker: async () => first };
  const api = browser(window);
  const a = await api.open();
  await api.save('song.banger', music, null);
  window.showDirectoryPicker = async () => second;
  const b = await api.open();
  await api.save('song.banger', music.replace('120', '130'), null);
  assert.notEqual(a.id, b.id);
  assert.equal((await api.recent()).length, 2);
  assert.equal((await api.read('song.banger', a.id)).source, music);
  assert.match((await api.read('song.banger')).source, /130/);
  assert.equal((await api.restore(a.id)).id, a.id);
  assert.equal((await api.read('song.banger')).source, music);
  assert.equal((await api.recent()).length, 2);
  await api.activate(b.id);
  assert.match((await api.read('song.banger')).source, /130/);
  await assert.rejects(api.restore('unknown'), /reconnect/);
  assert.match((await api.read('song.banger')).source, /130/);
});
