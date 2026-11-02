import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createLocalModel, downloadArtifact } from "../dist/local-model.js";

const bytes = new TextEncoder().encode("verified model contents");
const artifact = { url: "https://example.invalid/model", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
async function temporary(work) {
  const directory = await mkdtemp(join(tmpdir(), "banger-local-test-"));
  try { await work(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("model downloads resume the exact range, verify the digest and atomically publish", () => temporary(async directory => {
  const path = join(directory, "model");
  await writeFile(`${path}.partial`, bytes.slice(0, 5));
  const progress = [];
  await downloadArtifact(artifact, path, AbortSignal.timeout(1000), (...value) => progress.push(value), async (_url, options) => {
    assert.equal(options.headers.Range, "bytes=5-");
    return new Response(bytes.slice(5), { status: 206, headers: { "content-range": `bytes 5-${bytes.length - 1}/${bytes.length}` } });
  });
  assert.deepEqual(new Uint8Array(await readFile(path)), bytes);
  assert.deepEqual(progress.at(-1), [bytes.length, true]);
  await assert.rejects(stat(`${path}.partial`));
}));

test("servers ignoring Range restart rather than append, and bad digests never become models", () => temporary(async directory => {
  const path = join(directory, "model");
  await writeFile(`${path}.partial`, bytes.slice(0, 5));
  await downloadArtifact(artifact, path, AbortSignal.timeout(1000), () => {}, async () => new Response(bytes));
  assert.equal((await stat(path)).size, bytes.length);
  await rm(path);
  await assert.rejects(downloadArtifact({ ...artifact, sha256: "bad" }, path, AbortSignal.timeout(1000), () => {}, async () => new Response(bytes)), /verification/);
  await assert.rejects(stat(path));
  await assert.rejects(stat(`${path}.partial`));
}));

test("incorrect ranges and truncated responses are rejected while resumable bytes survive", () => temporary(async directory => {
  const path = join(directory, "model");
  await writeFile(`${path}.partial`, bytes.slice(0, 5));
  await assert.rejects(downloadArtifact(artifact, path, AbortSignal.timeout(1000), () => {}, async () => new Response(bytes, { status: 206 })), /range/);
  await assert.rejects(downloadArtifact(artifact, path, AbortSignal.timeout(1000), () => {}, async () => new Response(bytes.slice(0, 9))), /interrupted/);
  assert.equal((await stat(`${path}.partial`)).size, 9);
  await assert.rejects(stat(path));
}));

test("aborted verification preserves partial downloads and never marks them installed", () => temporary(async directory => {
  const path = join(directory, "model");
  await writeFile(`${path}.partial`, bytes);
  const signal = AbortSignal.abort();
  await assert.rejects(downloadArtifact(artifact, path, signal, () => {}));
  await assert.rejects(stat(path));
  assert.equal((await stat(`${path}.partial`)).size, bytes.length);
}));

test("local selection persists without a keychain and never connects before startup", () => temporary(async directory => {
  const model = createLocalModel(directory);
  assert.equal((await model.status()).selected, false);
  await model.select(true);
  const reloaded = createLocalModel(directory);
  assert.equal((await reloaded.status()).selected, true);
  assert.throws(() => reloaded.connection(), /Start Muse/);
  await assert.rejects(reloaded.start(), /Download/);
  await reloaded.select(false);
  assert.equal((await createLocalModel(directory).status()).selected, false);
}));


test("both model sizes can be selected and persisted independently", () => temporary(async directory => {
  const model = createLocalModel(directory);
  assert.equal((await model.status()).variant, "small");
  await model.choose("dynamic");
  assert.equal((await model.status()).total, 19653960832);
  assert.equal((await createLocalModel(directory).status()).variant, "dynamic");
  await model.choose("small");
  assert.equal((await model.status()).total, 16756683904);
  await assert.rejects(model.choose("../../other"), /available model sizes/);
}));
