import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function browser() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const cache = new Map();
  const nativeRequire = createRequire(import.meta.url);
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {}; cache.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, window: { sessionStorage: storage }, localStorage: storage,
      require: name => name.startsWith('.') ? load(resolve(dirname(path), `${name}.ts`)) : nativeRequire(name) });
    return exports;
  }
  const lib = fileURLToPath(new URL('../src/lib/', import.meta.url));
  return { settings: load(resolve(lib, 'ai-providers.ts')), account: load(resolve(lib, 'browser-account.ts')), drafts: load(resolve(lib, 'song-storage.ts')) };
}

test('hosted server status enables generation without storing or requiring a key', () => {
  const { settings } = browser();
  const status = {
    providers: { vercel: { available: true, model: 'meta/muse-wonder-1.0' }, anthropic: { available: false }, openai: { available: false }, meta: { available: true, model: 'muse-wonder-1.0' }, grok: { available: false } },
    elevenlabs: true, artwork: true, defaultProvider: 'vercel', defaultModel: 'meta/muse-wonder-1.0',
  };
  assert.equal(settings.hasLanguageModel({ activeProvider: null, providers: {}, server: status }), true);
  assert.equal(settings.vocalsConfigured({ activeProvider: null, providers: {}, elevenLabsConfigured: false, server: status }), true);
  assert.equal(settings.hasLanguageModel({ activeProvider: null, providers: {} }), false);
  assert.equal(settings.vocalsConfigured({ activeProvider: null, providers: {}, elevenLabsConfigured: false }), false);
  assert.equal(JSON.stringify(status).includes('sk-'), false);
});

test('hosted accounts cannot inherit another account’s keys or same-named lyric drafts', async () => {
  const { settings, account, drafts } = browser();
  const bridge = settings.aiSettingsBridge();
  await bridge.save('openai', 'fixture', 'legacy-key');
  account.setBrowserAccount('alice');
  assert.equal((await bridge.load()).activeProvider, null);
  await bridge.save('openai', 'fixture', 'alice-key');
  const aliceDraft = drafts.draftStorage('song.banger');
  await aliceDraft.save({ schemaVersion: 1, lyrics: 'Alice lyrics' }, null);
  const aliceLibrary = account.browserStorageKey('banger-library');
  account.setBrowserAccount('bob');
  assert.equal((await bridge.load()).activeProvider, null);
  assert.equal(await drafts.draftStorage('song.banger').read(), null);
  assert.notEqual(account.browserStorageKey('banger-library'), aliceLibrary);
  await bridge.save('anthropic', 'fixture', 'bob-key');
  account.setBrowserAccount('alice');
  assert.equal(settings.browserCredentials().key, 'alice-key');
  assert.equal((await drafts.draftStorage('song.banger').read()).lyrics, 'Alice lyrics');
});
