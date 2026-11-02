import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { mkdtemp, writeFile, readFile, mkdir, symlink, link, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { MockLanguageModelV4 } from "ai/test";
import { compileMusic } from "@banger/compiler";
import { openProject, ProjectSession } from "../dist/index.js";
import { runCli } from "../dist/cli.js";

const source = 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain .6; }';
const response = (content, reason = "stop") => ({ content, finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } }, warnings: [] });
const call = (toolName, input, id = toolName) => ({ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) });
const step = (...calls) => response(calls, "tool-calls");
const finish = text => response([{ type: "text", text }]);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "banger-harness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "song.banger"), source);
  return { root, workspace: await openProject(root) };
}

test("agent reads multiple project files, repairs invalid code, then revises the previous file on a follow-up", async t => {
  const { workspace, root } = await fixture(t);
  await mkdir(join(root, "variations"));
  await writeFile(join(root, "variations/slow.banger"), source);
  const events = [];
  const model = new MockLanguageModelV4({ doGenerate: [
    step(call("list_files", {})),
    step(call("read_file", { path: "song.banger" }, "read-a"), call("read_file", { path: "variations/slow.banger" }, "read-b")),
    step(call("write_file", { path: "song.banger", source: "invalid music" })),
    step(call("edit_file", { path: "song.banger", search: "tempo 120", replacement: "tempo 100" }, "edit-a"), call("edit_file", { path: "variations/slow.banger", search: "tempo 120", replacement: "tempo 80" }, "edit-b")),
    step(call("validate_project", {})),
    finish("Both tempos changed."),
    step(call("edit_file", { path: "variations/slow.banger", search: "gain .6", replacement: "gain .3" })),
    finish("The previous variation is quieter."),
  ] });
  const session = new ProjectSession({ workspace, selected: { model, name: "test" }, onEvent: event => events.push(event) });
  const first = await session.run("Slow down both files.");
  assert.equal(first.status, "completed");
  assert.deepEqual(first.changedPaths, ["song.banger", "variations/slow.banger"]);
  assert.deepEqual(first.validation.map(item => item.tempo), [100, 80]);
  assert.match(JSON.stringify(model.doGenerateCalls[3].prompt), /"ok":false/);
  const second = await session.run("Make the one you just edited quieter.");
  assert.equal(second.status, "completed");
  assert.deepEqual(second.changedPaths, ["variations/slow.banger"]);
  assert.equal(compileMusic((await workspace.read("variations/slow.banger")).source).tracks[0].gain, .3);
  assert.equal((await workspace.list()).length, 2);
  assert.match(JSON.stringify(model.doGenerateCalls[6].prompt), /Slow down both files/);
  assert.equal(events.filter(event => event.type === "file-changed").length, 3);
});

test("workspace confines files, preserves invalid drafts and rejects symlinks, hard links and lost updates", async t => {
  const { workspace, root } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "banger-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "secret.banger"), source);
  await symlink(outside, join(root, "escape"));
  await symlink(join(outside, "secret.banger"), join(root, "link.banger"));
  await link(join(outside, "secret.banger"), join(root, "hard.banger"));
  for (const path of ["../secret.banger", join(outside, "secret.banger"), "escape/secret.banger", "link.banger", "hard.banger", ".env", "song.txt", "a/../song.banger"]) {
    await assert.rejects(workspace.read(path));
    await assert.rejects(workspace.write(path, source, null));
  }
  assert.equal((await readFile(join(outside, "secret.banger"), "utf8")), source);
  await assert.rejects(workspace.write("song.banger", "bad source", source));
  assert.equal((await workspace.read("song.banger")).source, source);
  await assert.rejects(workspace.write("song.banger", source.replace("120", "90"), null), /changed|read/);
  const current = source.replace("120", "110");
  await writeFile(join(root, "song.banger"), current);
  await assert.rejects(workspace.write("song.banger", source.replace("120", "90"), source), /changed/);
  assert.equal((await workspace.read("song.banger")).source, current);
  const created = await workspace.write("new.banger", source, null);
  assert.equal(created.source, source);
  await assert.rejects(workspace.write("new.banger", source, null), /changed/);
});

test("parallel saves serialize and do not overwrite stale expected source", async t => {
  const { workspace } = await fixture(t);
  const outcomes = await Promise.allSettled([
    workspace.write("song.banger", source.replace("120", "110"), source),
    workspace.write("song.banger", source.replace("120", "100"), source),
  ]);
  assert.deepEqual(outcomes.map(outcome => outcome.status), ["fulfilled", "rejected"]);
  assert.equal(compileMusic((await workspace.read("song.banger")).source).tempo, 110);
});

test("unresolved compiler errors and exhausted agent steps remain incomplete", async t => {
  const { workspace } = await fixture(t);
  const invalid = new MockLanguageModelV4({ doGenerate: [step(call("write_file", { path: "new.banger", source: "bad" })), finish("Done!")] });
  const result = await new ProjectSession({ workspace, selected: { model: invalid, name: "test" } }).run("Create a file");
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.files, []);
  assert.match(result.text, /unfinished/);
  const endless = new MockLanguageModelV4({ doGenerate: step(call("list_files", {})) });
  const limited = await new ProjectSession({ workspace, selected: { model: endless, name: "test" }, maxSteps: 2 }).run("Inspect");
  assert.equal(limited.status, "incomplete");
  assert.equal(endless.doGenerateCalls.length, 2);
});

test("cancellation prevents generation and preserves files already saved before stopping", async t => {
  const { workspace } = await fixture(t);
  const controller = new AbortController();
  const model = new MockLanguageModelV4({ doGenerate: [step(call("edit_file", { path: "song.banger", search: "120", replacement: "100" })), finish("unused")] });
  const events = [];
  const session = new ProjectSession({ workspace, selected: { model, name: "test" }, onEvent(event) {
    events.push(event);
    if (event.type === "file-changed") controller.abort();
  } });
  await assert.rejects(session.run("Slow it down", { activeFile: "song.banger", signal: controller.signal }));
  assert.equal(compileMusic((await workspace.read("song.banger")).source).tempo, 100);
  assert.equal(events.at(-1).type, "stopped");
  assert.deepEqual(events.at(-1).changedPaths, ["song.banger"]);
  const already = new AbortController(); already.abort();
  await assert.rejects(session.run("Unused", { signal: already.signal }));
  assert.equal(model.doGenerateCalls.length, 1);
});

test("invalid UTF-8, null bytes, large files and ambiguous edits are rejected", async t => {
  const { workspace, root } = await fixture(t);
  await writeFile(join(root, "invalid.banger"), Buffer.from([0xff, 0xfe]));
  await writeFile(join(root, "null.banger"), "\0");
  await writeFile(join(root, "large.banger"), "x".repeat(65537));
  for (const path of ["invalid.banger", "null.banger", "large.banger"]) await assert.rejects(workspace.read(path));
  await assert.rejects(workspace.edit("song.banger", ".", "x", source), /exactly one/);
  assert.equal((await workspace.validate(["invalid.banger"]))[0].ok, false);
});

test("CLI invokes the real project loop, emits events, validates config and runs as an executable", async t => {
  const { root, workspace } = await fixture(t);
  const model = new MockLanguageModelV4({ doGenerate: [step(call("edit_file", { path: "song.banger", search: "120", replacement: "90" })), finish("Slower.")] });
  let stdout = "", stderr = "";
  const code = await runCli([root, "Slow down", "--active", "song.banger", "--json"], { selected: { model, name: "test" }, stdout: text => { stdout += text; }, stderr: text => { stderr += text; } });
  assert.equal(code, 0); assert.equal(stderr, "");
  const events = stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.ok(events.some(event => event.type === "file-changed"));
  assert.equal(events.at(-1).type, "result");
  assert.equal(compileMusic((await workspace.read("song.banger")).source).tempo, 90);
  assert.equal(await runCli([root, "task"], { env: {}, stderr: () => {} }), 2);
  assert.equal(await runCli([root, "task", "--provider", "unknown"], { env: {}, stderr: () => {} }), 2);
  const executable = resolve("bin/banger-agent.mjs");
  const spawned = spawnSync(executable, ["--help"], { encoding: "utf8" });
  assert.equal(spawned.status, 0, spawned.stderr);
  assert.match(spawned.stdout, /Usage: banger-agent/);
});
