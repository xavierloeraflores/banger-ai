import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isAppUrl, serveApp } from "../dist/static-app.js";
import { MAX_PROJECT_BYTES, projectName, requireProjectExtension, validateSource } from "../dist/project-files.js";

test("project validation preserves Unicode while bounding size and filenames", () => {
  assert.equal(projectName("../雪の曲 🎵.banger"), "雪の曲 🎵.banger");
  assert.equal(projectName("C:\\private\\song"), "song.banger");
  assert.equal(projectName("..."), "Untitled.banger");
  assert.equal(validateSource("♪ 雪"), "♪ 雪");
  assert.throws(() => validateSource("a\0b"), /null/);
  assert.throws(() => validateSource("🎵".repeat(MAX_PROJECT_BYTES / 4 + 1)), /5 MB/);
  assert.throws(() => validateSource({ source: "x" }), /text/);
  assert.throws(() => requireProjectExtension("song.txt"), /\.banger/);
  requireProjectExtension("雪.BANGER");
});

test("trusted origin matching rejects other schemes, hosts, and credentials", () => {
  assert.equal(isAppUrl("banger://app/_next/a.js"), true);
  for (const url of ["file:///etc/passwd", "https://app/", "banger://evil/", "banger://user@app/", "banger://app:80/"]) {
    assert.equal(isAppUrl(url), false, url);
  }
  assert.equal(isAppUrl("http://127.0.0.1:3000/", "http://127.0.0.1:3000"), true);
  assert.equal(isAppUrl("http://127.0.0.1:3001/", "http://127.0.0.1:3000"), false);
});

test("static protocol serves export assets and rejects traversal and writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "banger-static-"));
  try {
    await writeFile(join(directory, "index.html"), "<h1>Banger</h1>");
    await mkdir(join(directory, "_next"));
    await writeFile(join(directory, "_next", "app.js"), "window.ready = true;");
    const response = await serveApp(new Request("banger://app/"), directory);
    assert.equal(await response.text(), "<h1>Banger</h1>");
    assert.match(response.headers.get("Content-Security-Policy"), /object-src 'none'/);
    const asset = await serveApp(new Request("banger://app/_next/app.js"), directory);
    assert.match(asset.headers.get("Content-Type"), /javascript/);
    assert.equal((await serveApp(new Request("banger://app/%2e%2e%2fsecret"), directory)).status, 403);
    assert.equal((await serveApp(new Request("banger://app/%5csecret"), directory)).status, 403);
    assert.equal((await serveApp(new Request("banger://evil/"), directory)).status, 403);
    assert.equal((await serveApp(new Request("banger://app/", { method: "POST" }), directory)).status, 405);
    assert.equal((await serveApp(new Request("banger://app/missing"), directory)).status, 404);
    assert.equal(await (await serveApp(new Request("banger://app/", { method: "HEAD" }), directory)).text(), "");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
