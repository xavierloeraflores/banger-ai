import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/project-files.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function browser(bridge) {
  const elements = [];
  const blobs = [];
  const exports = {};
  const window = { bangerProjects: bridge, setTimeout: (fn) => fn() };
  const document = {
    body: { append: () => {} },
    createElement(tag) {
      const listeners = {};
      const element = {
        tag, listeners, removed: false, clicked: false,
        addEventListener: (name, fn) => { listeners[name] = fn; },
        remove() { this.removed = true; },
        click() { this.clicked = true; },
      };
      elements.push(element);
      return element;
    },
  };
  vm.runInNewContext(compiled, { exports, window, document, TextEncoder, TextDecoder, Blob,
    URL: { createObjectURL: blob => { blobs.push(blob); return "blob:project"; }, revokeObjectURL: () => {} },
  });
  return { api: exports, elements, blobs };
}

test("browser save downloads UTF-8 source with a safe Unicode .banger name", async () => {
  const { api, elements, blobs } = browser();
  const result = await api.saveProject("♪ 雪", "../雪の曲 🎵");
  assert.equal(result.name, "雪の曲 🎵.banger");
  assert.equal(elements[0].download, result.name);
  assert.equal(elements[0].clicked, true);
  assert.equal(elements[0].removed, true);
  assert.equal(await blobs[0].text(), "♪ 雪");
});

test("browser open resolves cancellation and reads validated UTF-8 source", async () => {
  const { api, elements } = browser();
  const cancelled = api.openProject();
  elements[0].listeners.cancel();
  assert.equal(await cancelled, null);
  assert.equal(elements[0].removed, true);
  const opened = api.openProject();
  elements[1].files = [{ name: "雪.banger", size: 4, arrayBuffer: async () => new TextEncoder().encode("雪").buffer }];
  elements[1].listeners.change();
  const result = await opened;
  assert.equal(result.name, "雪.banger");
  assert.equal(result.source, "雪");
  const invalid = api.openProject();
  elements[2].files = [{ name: "bad.banger", size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer }];
  elements[2].listeners.change();
  await assert.rejects(invalid, /UTF-8/);
});

test("desktop adapter uses the scoped native bridge and preserves cancellation", async () => {
  const calls = [];
  const { api, elements } = browser({
    openProject: async () => ({ name: "native.banger", source: "tempo 120" }),
    saveProject: async (...args) => { calls.push(args); return null; },
  });
  assert.equal((await api.openProject()).source, "tempo 120");
  assert.equal(await api.saveProject("tempo 130", "song"), null);
  assert.equal(calls[0][0], "tempo 130");
  assert.equal(calls[0][1], "song.banger");
  assert.equal(elements.length, 0);
});
