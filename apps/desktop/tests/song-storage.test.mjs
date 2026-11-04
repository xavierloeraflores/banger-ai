import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openProject } from '@banger/harness';
import { createSongStorage } from '../dist/song-storage.js';
import { createMusicStore } from '../dist/elevenlabs-music.js';
import { fixtureProvider, fixturePlan, wav } from '../../../packages/elevenlabs/test/fixtures.mjs';
async function savedFolder(root, name) { return join(root, (await readdir(root)).find(folder => folder.endsWith(`-${name}`))); }
const document = text => ({ plan: { chunks: [{ text }] } });
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'banger-storage-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project'); await mkdir(project);
  const storage = createSongStorage(root), song = await storage.prepare(project, 'midnight.banger', 'tempo 120;');
  return { root, project, storage, song };
}
test('root files, concurrent immutable numbering, selected library copies, and collision preservation', async t => {
  const { root, project, storage, song } = await fixture(t);
  await storage.saveLyrics(song, document('First lyric'));
  await storage.saveLyrics(song, document('Second lyric'));
  const revisions = await Promise.all(Array.from({ length: 12 }, () => storage.saveAudio(song, 'instrumentals', wav())));
  assert.equal(new Set(revisions).size, 12);
  await storage.saveAudio(song, 'vocals', wav());
  const history = await storage.list(song);
  assert.equal(history.instrumentals[0], 'midnight.instrumental-v001.wav');
  assert.equal(history.instrumentals.at(-1), 'midnight.instrumental-v012.wav');
  assert.equal(history.vocals[0], 'midnight.vocals-v001.wav');
  assert.deepEqual(JSON.parse(await readFile(join(project, 'midnight.lyric.json'))), document('Second lyric'));
  assert.deepEqual(JSON.parse(await readFile(join(project, '.banger/history/midnight/lyrics/lyrics-v001.json'))), document('First lyric'));
  const selection = { audio: 'vocals/midnight.vocals-v001.wav', instrumental: 'midnight.instrumental-v001.wav', lyrics: 'lyrics-v001.json' };
  await assert.rejects(storage.copyToLibrary(song, 'global', { audio: selection.audio }), /instrumental/);
  for (const scope of ['global', 'project']) {
    await storage.copyToLibrary(song, scope, selection);
    const destination = await savedFolder(join(scope === 'global' ? root : join(project, '.banger'), 'library'), 'midnight');
    assert.deepEqual((await readdir(destination)).sort(), ['midnight.banger', 'midnight.instrumental.wav', 'midnight.library.json', 'midnight.lyric.json', 'midnight.wav']);
    assert.deepEqual(await readFile(join(destination, 'midnight.wav')), wav());
    assert.deepEqual(JSON.parse(await readFile(join(destination, 'midnight.lyric.json'))), document('First lyric'));
    await assert.rejects(storage.copyToLibrary(song, scope, selection), { code: 'EEXIST' });
    assert.deepEqual(await readFile(join(destination, 'midnight.wav')), wav());
  }
  assert.equal((await storage.list(song)).instrumentals.length, 12);
  assert.equal(await readFile(join(project, 'midnight.banger'), 'utf8'), 'tempo 120;');
  // An instrumental-only song needs just primary audio, with any available source files.
  const instrumental = await storage.prepare(project, 'dawn.banger', 'tempo 90;');
  await storage.saveAudio(instrumental, 'instrumentals', wav());
  await storage.copyToLibrary(instrumental, 'project', { audio: 'instrumentals/dawn.instrumental-v001.wav' });
  assert.deepEqual((await readdir(await savedFolder(join(project, '.banger/library'), 'dawn'))).sort(), ['dawn.banger', 'dawn.library.json', 'dawn.wav']);
});
test('rejects traversal, symlinked storage and invalid WAV without replacing originals', async t => {
  const { root, project, storage, song } = await fixture(t);
  for (const name of ['../song', '.secret', 'folder/song', 'song\\escape']) await assert.rejects(storage.prepare(project, name));
  await assert.rejects(storage.saveAudio(song, 'vocals', Buffer.from('ID3 compressed bytes')));
  await symlink(root, join(project, '.banger'));
  await assert.rejects(storage.saveLyrics(song, document('No write')), /symbolic links/);
  assert.deepEqual((await readdir(root)).sort(), ['project']);
});
test('fallback projects preserve an existing source and create separate song directories', async t => {
  const { root, storage } = await fixture(t);
  const song = await storage.prepare(undefined, 'unsaved.banger', 'first');
  await storage.prepare(undefined, 'unsaved.banger', 'draft');
  assert.equal(song.root, join(root, 'projects/unsaved'));
  assert.equal(await readFile(join(song.root, 'unsaved.banger'), 'utf8'), 'first');
});
test('music operations retain their project binding through restart and recover archiving without another paid call', async t => {
  const { root, storage, song } = await fixture(t);
  const provider = fixtureProvider(); let fail = false;
  const hooks = {
    imported: (location, bytes) => storage.saveAudio(location, 'instrumentals', bytes),
    saved: async (location, version, audio) => {
      assert.deepEqual(location, song);
      if (fail) throw new Error('disk unavailable');
      if (audio) await storage.saveAudio(location, 'vocals', wav());
      await storage.saveLyrics(location, { plan: version.plan });
    },
  };
  const cache = join(root, 'cache'); let store = createMusicStore(cache, () => provider, hooks);
  async function done(id) { for (let i=0;i<200;i++) { const op=await store.operation(id); if (!['running','queued'].includes(op.status)) return op; await new Promise(resolve=>setTimeout(resolve,10)); } throw new Error('Timed out'); }
  const key = randomUUID(); await Promise.all([store.importWav(wav(), 'midnight.wav', key, song), store.importWav(wav(), 'midnight.wav', key, song)]); assert.equal((await done(key)).status, 'completed');
  await store.importWav(wav(), 'midnight.wav', key, song);
  assert.equal((await storage.list(song)).instrumentals.length, 1);
  store = createMusicStore(cache, () => provider, hooks);
  const edit = await store.act(key, { operation:'edit', baseVersion:1, edits:[{ index:0, lyrics:'New lyrics' }] }, randomUUID());
  assert.equal((await done(edit.id)).status, 'completed');
  fail = true;
  const generate = await store.act(key, { operation:'generate', baseVersion:2, indices:[0] }, randomUUID());
  assert.equal((await done(generate.id)).status, 'needs_review');
  fail = false;
  assert.equal((await store.recover(generate.id)).status, 'completed');
  await store.recover(generate.id);
  assert.equal(provider.calls.generate, 1);
  assert.equal((await storage.list(song)).vocals.length, 1);
  assert.equal((await storage.list(song)).lyrics.length, 3);
  assert.notDeepEqual(JSON.parse(await readFile(join(song.root, 'midnight.lyric.json'))).plan, fixturePlan);
});
test('a short rendered WAV is archived even when ElevenLabs rejects its duration', async t => {
  const { root, storage, song } = await fixture(t);
  const short = wav().subarray(0, 44 + 8000 * 2);
  short.writeUInt32LE(short.length - 8, 4); short.writeUInt32LE(short.length - 44, 40);
  const provider = fixtureProvider();
  const store = createMusicStore(join(root, 'cache'), () => provider, {
    imported: (location, bytes) => storage.saveAudio(location, 'instrumentals', bytes),
    saved: async () => {},
  });
  await assert.rejects(store.importWav(short, 'midnight.wav', randomUUID(), song), /3 seconds/);
  assert.equal((await storage.list(song)).instrumentals.length, 1);
  assert.equal(provider.calls.analyze, 0);
});
test('legacy cached lyric versions migrate once and keep their first project binding', async t => {
  const { root, storage, song } = await fixture(t);
  const cache = join(root, 'legacy'), provider = fixtureProvider();
  let store = createMusicStore(cache, () => provider);
  const done = async id => { for(let i=0;i<200;i++) { const op=await store.operation(id); if(op.status==='completed') return; await new Promise(resolve=>setTimeout(resolve,10)); } throw new Error('Timed out'); };
  const key = randomUUID(); await store.importWav(wav(), 'midnight.wav', key); await done(key);
  const edit = await store.act(key, { operation:'edit', baseVersion:1, edits:[{ index:0, lyrics:'Legacy lyric' }] }, randomUUID()); await done(edit.id);
  store = createMusicStore(cache, () => provider, {
    imported: (location, bytes) => storage.saveAudio(location, 'instrumentals', bytes),
    saved: (location, version) => storage.saveLyrics(location, { plan:version.plan }),
  });
  await store.bind(key, song);
  await store.bind(key, { root, name:'different' });
  assert.deepEqual(await store.location(key), song);
  assert.equal((await storage.list(song)).lyrics.length, 2);
  assert.equal((await storage.list(song)).instrumentals.length, 1);
});


test('desktop lyrics and harness edits share history numbering and current content', async t => {
  const { project, storage, song } = await fixture(t);
  await storage.saveLyrics(song, document('Desktop lyric'));
  const workspace = await openProject(project);
  const current = 'midnight.lyric.json';
  const original = (await workspace.readLyrics(current)).source;
  const edited = await workspace.editLyrics(current, 'Desktop lyric', 'Agent lyric', original);
  await storage.saveLyrics(song, document('Next desktop lyric'));
  assert.deepEqual((await storage.list(song)).lyrics, ['lyrics-v001.json', 'lyrics-v002.json', 'lyrics-v003.json']);
  assert.equal((await workspace.readLyrics('.banger/history/midnight/lyrics/lyrics-v001.json')).source, original);
  assert.equal((await workspace.readLyrics('.banger/history/midnight/lyrics/lyrics-v002.json')).source, edited.source);
  assert.deepEqual(JSON.parse((await workspace.readLyrics(current)).source), document('Next desktop lyric'));
});


test('library copies retain the selected vocal beat snapshot after studio changes', async t => {
  const { root, storage, song } = await fixture(t);
  const beat = { name: 'midnight.banger', source: 'tempo 93;' };
  await storage.saveLyrics(song, { ...document('Vocal words'), beat });
  await storage.saveAudio(song, 'instrumentals', wav());
  await storage.saveAudio(song, 'vocals', wav());
  await storage.copyToLibrary(song, 'global', { audio: 'vocals/midnight.vocals-v001.wav', instrumental: 'midnight.instrumental-v001.wav' });
  assert.equal(await readFile(join(await savedFolder(join(root, 'library'), 'midnight'), 'midnight.banger'), 'utf8'), beat.source);
});

test('explicit library snapshot preserves current source, lyrics and audio history as one entry', async t => {
  const { root, storage, song } = await fixture(t);
  await storage.saveAudio(song, 'instrumentals', wav());
  await storage.saveAudio(song, 'vocals', wav());
  await storage.saveLyrics(song, document('Saved lyrics'));
  await storage.addToLibrary(song, wav(), 'tempo 99;', document('Selected lyrics'));
  const [entry] = await readdir(join(root, 'library'));
  const target = join(root, 'library', entry);
  assert.equal(await readFile(join(target, 'midnight.banger'), 'utf8'), 'tempo 99;');
  assert.deepEqual(JSON.parse(await readFile(join(target, 'midnight.lyric.json'))), document('Selected lyrics'));
  assert.deepEqual(await readFile(join(target, 'midnight.wav')), wav());
  assert.equal((await readdir(join(target, '.history', 'instrumentals'))).length, 1);
  assert.equal((await readdir(join(target, '.history', 'vocals'))).length, 1);
  assert.equal((await readdir(join(target, '.history', 'lyrics'))).length, 1);
  const { createSongLibrary } = await import('../dist/song-library.js');
  assert.equal((await createSongLibrary(root).list())[0].songType, 'vocal');
  await storage.addToLibrary(song, wav(), 'tempo 100;');
  assert.equal((await readdir(join(root, 'library'))).length, 2);
  assert.ok((await createSongLibrary(root).list()).every(entry => entry.songType === 'vocal'));
  assert.equal(await readFile(join(song.root, 'midnight.banger'), 'utf8'), 'tempo 120;');
});

test('nested songs keep separate vocal storage and reject traversal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'banger-nested-vocals-'));
 try{
  const storage=createSongStorage(root);
  const first=await storage.prepare(root,'disc-one/song.banger');
  const second=await storage.prepare(root,'disc-two/song.banger');
  assert.notEqual(first.root,second.root);
  assert.equal(first.name,second.name);
  await assert.rejects(storage.prepare(root,'../escape.banger'),/inside/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('library export retains the selected recording words and waveform with its lyrics', async t => {
  const { root, storage, song } = await fixture(t);
  const selected = { ...document('Recorded words'), audioId: 'selected-take', audioMetadata: {
    wordsTimestamps: [{ word: 'Recorded', startMs: 1200, endMs: 1800 }, { word: 'words', startMs: 2000, endMs: 2900 }],
    waveformVisual: [0, 312, -500, 20],
  } };
  await storage.saveLyrics(song, document('Newer unsung draft'));
  await storage.addToLibrary(song, wav(), 'tempo 120;', selected);
  const folder = (await readdir(join(root, 'library'))).find(name => name.startsWith('midnight-'));
  const stored = JSON.parse(await readFile(join(root, 'library', folder, 'midnight.lyric.json'), 'utf8'));
  assert.deepEqual(stored, selected);
});

test('beat exports stay instrumental despite project lyrics, and selected revisions retain their type', async t => {
  const { root, storage, song } = await fixture(t);
  await storage.saveLyrics(song, document('Unsung draft'));
  await storage.addToLibrary(song, wav(), 'tempo 120;', undefined, 'instrumental');
  const { createSongLibrary } = await import('../dist/song-library.js');
  const library = createSongLibrary(root);
  assert.equal((await library.list())[0].songType, 'instrumental');
  await storage.saveAudio(song, 'vocals', wav());
  await storage.copyToLibrary(song, 'global', { audio: 'vocals/midnight.vocals-v001.wav', instrumental: await storage.saveAudio(song, 'instrumentals', wav()) });
  assert.deepEqual((await library.list()).map(entry => entry.songType).sort(), ['instrumental', 'vocal']);
});
