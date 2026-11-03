import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as compiler from "@banger/compiler";

const source = await readFile(new URL("../src/lib/banger-highlighting.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: () => compiler });
const { highlightBanger } = exports;

test("highlighting preserves source and distinguishes comments, strings, numbers and variables", () => {
  const source = '// tempo 123\r\nlet speed = 1.12e2;\n tempo speed;\ntrack kick { sound "drums/kick"; rhythm "x ."; }';
  const tokens = highlightBanger(source);
  assert.equal(tokens.map(token => token.text).join(""), source + " ");
  for (const [text, kind] of [["// tempo 123", "comment"], ["let", "keyword"], ["speed", "identifier"], ["1.12e2", "number"], ['"drums/kick"', "string"]]) {
    assert.equal(tokens.find(token => token.text === text)?.kind, kind);
  }
  assert.ok(tokens.every(token => !token.error));
});

for (const [source, marked, message] of [
  ["let speed = 120;\ntempo speeed;", "speeed", /Unknown variable/],
  ["temop 120;", "temop", /Unknown statement/],
  ["tempo ;", ";", /Expected a number/],
  ["tempo 100 + ;", ";", /Expected a number/],
  ["tempo 100 / 0;", "/", /Division by zero/],
  ["tempo ", " ", /Expected a number/],
  ['track kick { sound "drums/kick', '"drums/kick', /unterminated string/],
  ["tempo $;", "$", /Unexpected character/],
]) {
  test(`compiler diagnostic marks ${JSON.stringify(marked)} in ${JSON.stringify(source)}`, () => {
    let error;
    try { compiler.compileMusic(source); } catch (cause) { error = cause; }
    assert.ok(error instanceof compiler.CompileError);
    assert.match(error.message, message);
    const tokens = highlightBanger(source, error.position.offset);
    assert.equal(tokens.filter(token => token.error).map(token => token.text).join(""), marked);
    assert.equal(tokens.map(token => token.text).join(""), source + " ");
  });
}

test("invalid text does not stop highlighting later lines; fixing the error clears the marker", () => {
  const tokens = highlightBanger('"unfinished\ntempo 120; $\n// still a comment', 0);
  assert.equal(tokens.find(token => token.text === "tempo").kind, "keyword");
  assert.equal(tokens.find(token => token.text === "// still a comment").kind, "comment");
  const valid = "let speed = 120;\ntempo speed;";
  compiler.compileMusic(valid);
  assert.ok(highlightBanger(valid).every(token => !token.error));
});
