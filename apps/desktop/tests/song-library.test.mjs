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
test('library includes only explicitly saved global and project library entries', async t => {
  const { root, project, library } = await fixture(t);
  await mkdir(join(root, 'projects', 'unsaved'), { recursive: true });
  await writeFile(join(root, 'projects', 'unsaved', 'unsaved.banger'), 'tempo 80;');
  const entries = await library.list(project);
  assert.deepEqual(entries.map(item => item.name), ['Dawn', 'Night']);
  assert.ok(entries.every(item => item.recordId === undefined), 'standalone songs have no synthetic record');
  assert.match(entries.find(item => item.name === 'Dawn').artwork, /^data:image\/png;base64,/);
  assert.deepEqual((await library.read(entries[0].id)).bytes, wav());
  assert.deepEqual((await library.read(entries[0].id)).beat, { name: 'Dawn.banger', source: 'tempo 90;' });
  assert.equal((await library.read(entries[1].id)).beat, undefined);
  await assert.rejects(library.read('../outside'), /Refresh/);
  await library.list();
  await assert.rejects(library.read(entries[1].id), /Refresh/);
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

test('library reads the saved recording metadata and tolerates missing or damaged lyrics', async t => {
  const { root, library } = await fixture(t);
  const [entry] = await library.list();
  const sidecar = join(root, 'library', 'Dawn', 'Dawn.lyric.json');
  assert.equal((await library.read(entry.id)).lyrics, undefined);
  const lyrics = { audioMetadata: { wordsTimestamps: [{ word: 'Dawn', startMs: 500, endMs: 1400 }], waveformVisual: [12, -30] } };
  await writeFile(sidecar, JSON.stringify(lyrics));
  assert.deepEqual((await library.read(entry.id)).lyrics, lyrics);
  await writeFile(sidecar, '{broken');
  assert.equal((await library.read(entry.id)).lyrics, undefined);
  assert.deepEqual((await library.read(entry.id)).bytes, wav());
  await rm(sidecar);
  await symlink(join(root, 'library', 'Dawn', 'Dawn.banger'), sidecar);
  await assert.rejects(library.read(entry.id), /symbolic|regular/i);
});

test('existing library entries infer tags from lyric sidecars and honor saved recording tags', async t => {
  const { root, library } = await fixture(t);
  const folder = join(root, 'library', 'Dawn');
  assert.equal((await library.list())[0].songType, 'instrumental');
  await writeFile(join(folder, 'Dawn.lyrics.json'), JSON.stringify({ plan: { chunks: [{ text: '[Verse]\nSung words' }] } }));
  assert.equal((await library.list())[0].songType, 'vocal');
  await writeFile(join(folder, 'Dawn.library.json'), JSON.stringify({ songType: 'instrumental' }));
  assert.equal((await library.list())[0].songType, 'instrumental');
  await writeFile(join(folder, 'Dawn.library.json'), '{broken');
  assert.equal((await library.list())[0].songType, 'vocal');
});

test('song menu edits persist without changing audio and removed songs become standalone', async t => {
  const { root, project, library } = await fixture(t);
  const recordId = '12345678-1234-1234-1234-123456789abc';
  await mkdir(join(project, '.banger'), { recursive: true });
  await writeFile(join(project, '.banger', 'record.json'), JSON.stringify({ id: recordId }));
  await writeFile(join(root, 'recent-projects.json'), JSON.stringify([{ id: 'recent-project', root: project }]));
  await writeFile(join(root, 'library', 'Dawn', 'Dawn.library.json'), JSON.stringify({ record: { id: recordId, name: 'Original record' } }));
  const entries = await library.list(project), dawn = entries.find(song => song.name === 'Dawn'), night = entries.find(song => song.name === 'Night');
  assert.equal(dawn.projectId, 'recent-project');
  const other = createSongLibrary(root); await other.list(project);
  await Promise.all([library.renameSong(dawn.id, 'New Dawn'), other.addToRecord(night.id, recordId, 'Original record')]);
  await library.list(project);
  await library.editRecordSongs(recordId, [night.id, dawn.id]);
  let saved = await createSongLibrary(root).list(project);
  assert.equal(saved.find(song => song.id === dawn.id).name, 'New Dawn');
  assert.equal(saved.find(song => song.id === night.id).recordPosition, 0);
  assert.equal(saved.find(song => song.id === dawn.id).recordPosition, 1);
  await assert.rejects(library.editRecordSongs(recordId, [night.id, 'missing']), /Refresh/);
  await library.editRecordSongs(recordId, [night.id]);
  saved = await library.list(project);
  assert.equal(saved.find(song => song.id === dawn.id).recordId, undefined);
  assert.equal(saved.find(song => song.id === dawn.id).projectId, 'recent-project');
  assert.deepEqual((await library.read(dawn.id)).bytes, wav());
  assert.equal((await library.read(dawn.id)).beat.source, 'tempo 90;');
  await library.editRecordSongs(recordId, []);
  assert.ok((await library.list(project)).every(song => song.recordId === undefined));
  await assert.rejects(library.renameSong(dawn.id, ' '), /name/);
  await assert.rejects(library.addToRecord(dawn.id, '../escape', 'Bad'), /ID/);
  await rm(project, { recursive: true });
  assert.equal((await library.list())[0].projectId, undefined);
});

test('standalone songs regenerate their own artwork without becoming records', async t => {
  const { root } = await fixture(t);
  const { createLibraryRecords } = await import('../dist/library-records.js');
  const cover = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1sAAAAASUVORK5CYII=';
  await writeFile(join(root, 'library', 'Dawn', 'cover.png'), Buffer.from(cover.split(',')[1], 'base64'));
  let finish;
  const records = createLibraryRecords(root, () => new Promise(resolve => { finish = resolve; }));
  const library = createSongLibrary(root, records), [song] = await library.list();
  await library.regenerateSongArtwork(song.id);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal((await library.list())[0].artworkPending, true);
  await library.renameSong(song.id, 'New name during generation');
  finish(cover); await records.settled();
  const [saved] = await createSongLibrary(root, records).list();
  assert.equal(saved.name, 'New name during generation');
  assert.equal(saved.recordId, undefined);
  assert.equal(saved.artwork, cover);
  assert.equal(saved.artworkPending, false);
});
