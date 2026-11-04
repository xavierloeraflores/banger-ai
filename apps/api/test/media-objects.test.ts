import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaObjects, boundedAudio } from '../src/server/media-objects';

test('private local media is immutable, bounded and rejects traversal and links', async t => {
  const root = await mkdtemp(join(tmpdir(), 'banger-media-test-'));
  const previous = process.env.BANGER_LOCAL_DATA_DIR;
  process.env.BANGER_LOCAL_DATA_DIR = root;
  t.after(async () => { if (previous === undefined) delete process.env.BANGER_LOCAL_DATA_DIR; else process.env.BANGER_LOCAL_DATA_DIR = previous; await rm(root, { recursive: true, force: true }); });
  const path = 'projects/fixture/audio/fixture.wav';
  const bytes = Buffer.from('immutable fixture');
  await mediaObjects.write(path, bytes, 'audio/wav');
  assert.deepEqual(await mediaObjects.read(path), bytes);
  assert.equal(await mediaObjects.size(path), bytes.length);
  assert.equal((await stat(join(root, path))).mode & 0o777, 0o600);
  await assert.rejects(mediaObjects.write(path, Buffer.from('overwrite'), 'audio/wav'));
  assert.deepEqual(await mediaObjects.read(path), bytes);
  await assert.rejects(mediaObjects.read('../outside'));
  await symlink(join(root, path), join(root, 'linked.wav'));
  await assert.rejects(mediaObjects.read('linked.wav'));
  await mkdir(join(root, 'outside'));
  await symlink(join(root, 'outside'), join(root, 'redirect'));
  await assert.rejects(mediaObjects.write('redirect/audio.wav', bytes, 'audio/wav'));
  await assert.rejects(boundedAudio(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(10));controller.close();}}), 5), /exceeds/);
});
