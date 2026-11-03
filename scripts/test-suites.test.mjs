import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWorkspaces, changedFiles, root, selectSuites, suites } from "./test-suites.mjs";

const all = Object.keys(suites);
test("UI changes select web and the HTTP integration that renders the studio", () => {
  assert.deepEqual(selectSuites(["apps/www/src/components/producer/producer.css"]), ["web", "api-integration"]);
  assert.deepEqual(selectSuites(["packages/shadcn/src/button.tsx"]), ["web", "api-integration"]);
});
test("desktop tests cover their shared provider definitions", () => {
  assert.deepEqual(selectSuites(["apps/www/src/lib/ai-providers.ts"]), ["desktop", "web", "api-integration"]);
  assert.deepEqual(selectSuites(["apps/www/src/lib/project-files.ts"]), ["web", "api-integration"]);
  assert.deepEqual(selectSuites(["apps/desktop/src/ai-settings.ts"]), ["desktop"]);
});
test("package changes include transitive consumers and shared fixtures", () => {
  assert.deepEqual(selectSuites(["packages/compiler/src/index.ts"]), ["compiler", "engine", "agent", "harness", "desktop", "web", "api-unit", "api-integration"]);
  assert.deepEqual(selectSuites(["packages/elevenlabs/test/fixtures.mjs"]), ["elevenlabs", "desktop", "web", "api-unit", "api-integration"]);
  assert.deepEqual(selectSuites(["apps/api/migrations/001.sql"]), ["api-unit", "api-integration"]);
});
test("runtime language docs and example songs are test inputs", () => {
  assert.ok(selectSuites(["packages/compiler/LANGUAGE.md"]).includes("harness"));
  assert.deepEqual(selectSuites(["examples/night-drive.banger"]), all.filter(name => name !== "tooling"));
  assert.deepEqual(selectSuites(["README.md", "docs/testing.md", "apps/api/README.md"]), []);
  assert.deepEqual(selectSuites([]), []);
});
test("global config, test machinery and unknown paths fail toward full coverage", () => {
  for (const path of ["pnpm-lock.yaml", "package.json", "turbo.json", "pnpm-workspace.yaml", "apps/www/package.json", "scripts/test-suites.mjs", ".github/workflows/tests.yml", "new-package/code.ts", ".npmrc"]) {
    assert.deepEqual(selectSuites([path]), all, path);
  }
  assert.deepEqual(selectSuites(["scripts/dev.mjs"]), ["tooling"]);
  assert.deepEqual(selectSuites(["packages/typescript-config/base.json"]), all.filter(name => name !== "tooling"));
});
test("build preparation includes dependencies but never production apps", () => {
  assert.deepEqual(buildWorkspaces(["tooling"]), []);
  assert.deepEqual(buildWorkspaces(["engine"]).sort(), ["@banger/compiler", "@banger/engine"]);
  assert.ok(buildWorkspaces(["api-integration"]).includes("@banger/shadcn"));
  assert.ok(!buildWorkspaces(["api-unit"]).includes("@banger/engine"));
  assert.ok(!buildWorkspaces(all).some(name => ["@banger/www", "@banger/api", "@banger/desktop"].includes(name)));
});
test("git selection covers branch history, staged, unstaged, untracked, deleted and renamed files", t => {
  const cwd = mkdtempSync(join(tmpdir(), "banger-test-selection-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "test@example.test");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  const write = (path, text = "original") => { mkdirSync(join(cwd, path, ".."), { recursive: true }); writeFileSync(join(cwd, path), text); };
  for (const file of ["old/file.ts", "staged.ts", "unstaged.ts", "delete.ts"]) write(file);
  git("add", "."); git("commit", "-m", "base");
  git("switch", "-c", "feature");
  write("committed.ts"); git("add", "."); git("commit", "-m", "change");
  const head = git("rev-parse", "HEAD");
  mkdirSync(join(cwd, "new")); renameSync(join(cwd, "old/file.ts"), join(cwd, "new/file.ts"));
  write("staged.ts", "changed"); rmSync(join(cwd, "delete.ts")); git("add", ".");
  write("unstaged.ts", "changed"); write("untracked with spaces.ts");
  assert.deepEqual(changedFiles({ cwd }).sort(), ["committed.ts", "delete.ts", "new/file.ts", "old/file.ts", "staged.ts", "unstaged.ts", "untracked with spaces.ts"].sort());
  assert.deepEqual(changedFiles({ cwd, head }), ["committed.ts"]);
  assert.throws(() => changedFiles({ cwd, base: "missing-ref", head }));
  // A new commit on main must not contaminate the feature branch's merge-base diff.
  git("stash", "push", "-u"); git("switch", "main"); write("only-on-main.ts"); git("add", "."); git("commit", "-m", "main advances");
  assert.deepEqual(changedFiles({ cwd, head }), ["committed.ts"]);
});
test("CLI rejects typos and emits machine-readable plans without running builds", () => {
  const cli = args => execFileSync(process.execPath, ["scripts/test-suites.mjs", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.deepEqual(JSON.parse(cli(["--all", "--json"])), all);
  assert.deepEqual(JSON.parse(cli(["--suite", "desktop", "--json"])), ["desktop"]);
  for (const args of [["--suite", "typo"], ["--base"], ["--typo"], ["--all", "--suite", "web"]]) assert.throws(() => cli(args));
});
