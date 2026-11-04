import { Buffer } from "node:buffer";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSongLibrary } from '../dist/song-library.js';
import { wav } from '../../../packages/elevenlabs/test/fixtures.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'banger-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  await mkdir(join(root, 'library', 'Dawn'), { recursive: true });
  await mkdir(join(project, '.banger', 'library', 'Night'), { recursive: true });
  await writeFile(join(root, 'library', 'Dawn', 'Dawn.wav'), wav());
  await writeFile(join(root, 'library', 'Dawn', 'Dawn.banger'), 'tempo 90;');
  await writeFile(join(root, 'library', 'Dawn', 'cover.png'), Buffer.from('cover'));
  await writeFile(join(project, '.banger', 'library', 'Night', 'Night.wav'), wav());
  await writeFile(join(project, 'Beat.banger'), 'tempo 120;');
  return { root, project, library: createSongLibrary(root) };
}
test('library includes project beats, global and project audio, artwork and fallback projects', async t => {
  const { root, project, library } = await fixture(t);
  await mkdir(join(root, 'projects', 'unsaved'), { recursive: true });
  await writeFile(join(root, 'projects', 'unsaved', 'unsaved.banger'), 'tempo 80;');
  const entries = await library.list(project);
  assert.deepEqual(entries.map(item => item.name), ['Beat', 'Dawn', 'Night', 'unsaved']);
  assert.match(entries.find(item => item.name === 'Dawn').artwork, /^data:image\/png;base64,/);
  assert.equal(entries.find(item => item.name === 'Beat').artwork, undefined);
  assert.equal((await library.read(entries[0].id)).source, 'tempo 120;');
  assert.deepEqual((await library.read(entries[1].id)).bytes, wav());
  assert.deepEqual((await library.read(entries[1].id)).beat, { name: 'Dawn.banger', source: 'tempo 90;' });
  assert.equal((await library.read(entries[2].id)).beat, undefined);
  await assert.rejects(library.read('../outside'), /Refresh/);
  await library.list();
  await assert.rejects(library.read(entries[0].id), /Refresh/);
});
test('library excludes symbolic links and rechecks directories when reading a previously listed song', async t => {
  const { root, project, library } = await fixture(t);
  await symlink(project, join(root, 'library', 'linked'));
  await symlink(join(project, 'Beat.banger'), join(root, 'library', 'escape.banger'));
  const entries = await library.list();
  assert.deepEqual(entries.map(item => item.name), ['Dawn']);
  await rename(join(root, 'library', 'Dawn'), join(root, 'moved'));
  await symlink(join(root, 'moved'), join(root, 'library', 'Dawn'));
  await assert.rejects(library.read(entries[0].id), /symbolic links/);
});
