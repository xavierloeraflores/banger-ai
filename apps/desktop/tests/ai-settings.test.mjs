import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createAISettingsStore } from "../dist/ai-settings.js";

const source = await readFile(new URL("../../www/src/lib/ai-providers.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function browser(storage = new Map(), native) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, window: { bangerAI: native, sessionStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } } });
  return { bridge: exports.aiSettingsBridge(), providers: exports.AI_PROVIDERS };
}

async function lifecycle(bridge) {
  assert.equal((await bridge.load()).activeProvider, null);
  for (const { id } of browser().providers) {
    const result = await bridge.save(id, `${id}/model`, `test-key-${id}`);
    assert.equal(result.activeProvider, id);
    assert.equal(result.providers[id].configured, true);
    assert.equal(JSON.stringify(result).includes("test-key"), false, "Responses must not contain API keys.");
  }
  assert.equal(Object.keys((await bridge.load()).providers).length, 5);
  await bridge.save("anthropic", "updated-model", "");
  assert.equal((await bridge.load()).providers.anthropic.model, "updated-model");
  await assert.rejects(bridge.save("openai", "bad model", "new-key"), /model ID/);
  await assert.rejects(bridge.save("openai", "model", "bad\nkey"), /API key/);
  await assert.rejects(bridge.save("unknown", "model", "key"), /supported/);
  assert.equal((await bridge.load()).providers.openai.model, "openai/model");
  await bridge.remove("openai");
  assert.equal((await bridge.load()).activeProvider, "anthropic");
  assert.equal((await bridge.load()).providers.openai, undefined);
  await assert.rejects(bridge.save("openai", "model", ""), /API key/);
  await bridge.remove("anthropic");
  assert.equal((await bridge.load()).activeProvider, null);
  assert.equal(Object.keys((await bridge.load()).providers).length, 3);
}

// Exercise real encrypted bytes with an injected cipher, without touching the user's keychain.
function cipher() {
  const secret = randomBytes(32);
  return {
    isAvailable: () => true,
    encrypt(text) {
      const iv = randomBytes(12);
      const encryptor = createCipheriv("aes-256-gcm", secret, iv);
      const bytes = Buffer.concat([encryptor.update(text, "utf8"), encryptor.final()]);
      return Buffer.concat([iv, encryptor.getAuthTag(), bytes]);
    },
    decrypt(bytes) {
      const decryptor = createDecipheriv("aes-256-gcm", secret, bytes.subarray(0, 12));
      decryptor.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decryptor.update(bytes.subarray(28)), decryptor.final()]).toString("utf8");
    },
  };
}

test("web settings isolate providers, persist within a tab, replace and remove keys", async () => {
  const storage = new Map();
  const { bridge } = browser(storage);
  await lifecycle(bridge);
  const reloaded = browser(storage).bridge;
  assert.equal(Object.keys((await reloaded.load()).providers).length, 3);
  await reloaded.save("grok", "model-2", "replacement");
  assert.ok([...storage.values()][0].includes("replacement"));
  assert.equal([...storage.values()][0].includes("test-key-grok"), false);
  assert.equal(Object.keys((await browser().bridge.load()).providers).length, 0);
});

test("web reports unavailable storage and chooses native storage when present", async () => {
  const unavailable = { get: () => { throw new Error("private detail"); } };
  await assert.rejects(browser(unavailable).bridge.load(), /Allow session storage/);
  const native = { load: async () => "native" };
  assert.equal(browser(unavailable, native).bridge, native);
});

test("desktop encrypts keys, redacts responses, persists and serializes changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "banger-ai-"));
  try {
    const path = join(directory, "keys.enc");
    const encryption = cipher();
    const store = createAISettingsStore(path, encryption);
    await lifecycle(store);
    const bytes = await readFile(path);
    assert.equal(bytes.includes(Buffer.from("test-key")), false);
    const reloaded = createAISettingsStore(path, encryption);
    assert.equal(Object.keys((await reloaded.load()).providers).length, 3);
    await Promise.all([reloaded.save("openai", "model", "first"), reloaded.save("anthropic", "model", "second")]);
    assert.equal(Object.keys((await reloaded.load()).providers).length, 5);
    await reloaded.save("openai", "new-model", "");
    assert.equal(JSON.parse(encryption.decrypt(await readFile(path))).providers.openai.key, "first");
    await reloaded.save("openai", "new-model", "replacement");
    assert.equal(JSON.parse(encryption.decrypt(await readFile(path))).providers.openai.key, "replacement");
    await reloaded.remove("openai");
    assert.equal(JSON.parse(encryption.decrypt(await readFile(path))).providers.openai, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("desktop refuses unavailable encryption and preserves unreadable settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "banger-ai-"));
  try {
    const path = join(directory, "keys.enc");
    const encryption = cipher();
    const store = createAISettingsStore(path, { ...encryption, isAvailable: () => false });
    await assert.rejects(store.save("openai", "model", "test-key"), /Secure key storage/);
    await assert.rejects(readFile(path), { code: "ENOENT" });
    await writeFile(path, "corrupted");
    await assert.rejects(createAISettingsStore(path, encryption).save("openai", "model", "test-key"), /Could not unlock/);
    assert.equal(await readFile(path, "utf8"), "corrupted");
    await assert.rejects(createAISettingsStore(join(directory, "missing", "keys.enc"), encryption).save("openai", "model", "test-key"), /Could not save/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
