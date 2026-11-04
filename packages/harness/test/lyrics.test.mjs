import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, link, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MockLanguageModelV4 } from 'ai/test';
import { openProject, ProjectSession, songStorage } from '../dist/index.js';

const document = text => ({ schemaVersion: 1, musicId: 'music-1', version: 2, createdAt: '2026-11-03', plan: { chunks: [{ text, durationMs: 10000, positiveStyles: ['pop'] }] } });
const current = 'song.lyric.json';
const revision = version => `.banger/history/song/lyrics/lyrics-v${String(version).padStart(3, '0')}.json`;
async function fixture(t, lyrics = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'banger-lyrics-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'song.banger'), 'tempo 120; track kick { sound "drums/kick"; rhythm "x . x ."; }');
  if (lyrics) await songStorage.saveLyrics({ root, name: 'song' }, document('First line'));
  return { root, workspace: await openProject(root) };
}
const response = (content, reason = 'tool-calls') => ({ content, finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } }, warnings: [] });
const call = (toolName, input) => response([{ type: 'tool-call', toolCallId: toolName, toolName, input: JSON.stringify(input) }]);
const finish = () => response([{ type: 'text', text: 'Finished.' }], 'stop');

test('discovery includes current lyrics and exact history paths, with no storage side effects', async t => {
  const { root, workspace } = await fixture(t);
  await mkdir(join(root, 'nested'));
  await songStorage.saveLyrics({ root: join(root, 'nested'), name: 'other' }, document('Nested line'));
  for (const path of ['.banger/library/copy', '.banger/history/song/vocals', '.private']) {
    await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, path, 'secret.lyric.json'), JSON.stringify(document('Secret')));
  }
  await writeFile(join(root, '.banger/history/song/lyrics/arbitrary.json'), '{}');
  await writeFile(join(root, 'settings.json'), '{}');
  assert.deepEqual(await workspace.list(), ['song.banger']);
  assert.deepEqual(await workspace.listLyrics(), [revision(1), 'nested/.banger/history/other/lyrics/lyrics-v001.json', 'nested/other.lyric.json', current]);
  for (const path of await workspace.listLyrics()) assert.ok(JSON.parse((await workspace.readLyrics(path)).source).plan);
  assert.equal(await workspace.readLyrics('absent.lyric.json'), null);
  assert.equal(await workspace.readLyrics('.banger/history/absent/lyrics/lyrics-v001.json'), null);
  assert.ok(!(await readdir(join(root, '.banger/history'))).includes('absent'));
  const empty = await fixture(t, false);
  assert.deepEqual(await empty.workspace.listLyrics(), []);
  assert.equal(await empty.workspace.readLyrics(current), null);
  assert.deepEqual((await readdir(empty.root)).sort(), ['song.banger']);
});

test('edits and full writes use the shared save workflow and preserve every history snapshot', async t => {
  const { root, workspace } = await fixture(t);
  const original = (await workspace.readLyrics(current)).source;
  const edited = await workspace.editLyrics(current, 'First line', 'Second line $&', original);
  const written = await workspace.writeLyrics(current, JSON.stringify(document('Third line')), edited.source);
  assert.deepEqual(JSON.parse(written.source), document('Third line'));
  assert.equal((await workspace.readLyrics(revision(1))).source, original);
  assert.equal((await workspace.readLyrics(revision(2))).source, edited.source);
  assert.equal((await workspace.readLyrics(revision(3))).source, written.source);
  assert.equal(await readFile(join(root, current), 'utf8'), written.source);
  for (const path of [revision(1), revision(3)]) {
    const historical = (await workspace.readLyrics(path)).source;
    await assert.rejects(workspace.writeLyrics(path, written.source, historical), /read-only/);
    await assert.rejects(workspace.editLyrics(path, 'line', 'word', historical), /read-only/);
    await assert.rejects(workspace.write(path, written.source, historical));
    assert.equal((await workspace.readLyrics(path)).source, historical);
  }
  await assert.rejects(workspace.writeLyrics('.banger/history/song/lyrics/lyrics-v004.json', written.source, written.source));
  assert.equal((await workspace.listLyrics()).length, 4);
  await songStorage.saveLyrics({ root, name: 'song' }, document('Desktop line'));
  assert.deepEqual(JSON.parse((await workspace.readLyrics(revision(4))).source), document('Desktop line'));
});

test('stale, unread, ambiguous, cancelled and invalid edits preserve current lyrics and history', async t => {
  const { root, workspace } = await fixture(t);
  const original = (await workspace.readLyrics(current)).source;
  for (const invalid of ['{', 'null', '[]', '{}', '{"plan":{"chunks":[{"text":2}]}}', JSON.stringify(document('\0')), JSON.stringify(document('x'.repeat(65536))), '\0']) {
    await assert.rejects(workspace.writeLyrics(current, invalid, original));
  }
  await assert.rejects(workspace.writeLyrics(current, original, null), /changed|read/);
  await assert.rejects(workspace.editLyrics(current, 'missing', 'anything', original), /exactly one/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(workspace.writeLyrics(current, original, original, controller.signal));
  assert.equal(await readFile(join(root, current), 'utf8'), original);
  assert.deepEqual(await readdir(join(root, '.banger/history/song/lyrics')), ['lyrics-v001.json']);
  const outcomes = await Promise.allSettled([
    workspace.editLyrics(current, 'First line', 'Winner', original),
    workspace.editLyrics(current, 'First line', 'Stale', original),
  ]);
  assert.deepEqual(outcomes.map(result => result.status), ['fulfilled', 'rejected']);
  assert.deepEqual(JSON.parse((await workspace.readLyrics(current)).source), document('Winner'));
  assert.equal((await workspace.listLyrics()).length, 3);
  await assert.rejects(workspace.writeLyrics('missing.lyric.json', original, original));
});

test('lyrics reads enforce UTF-8, JSON, size, path and link protections', async t => {
  const { root, workspace } = await fixture(t);
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'outside-lyrics-')));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const original = (await workspace.readLyrics(current)).source;
  await writeFile(join(outside, current), original);
  await symlink(outside, join(root, 'escape'));
  await symlink(join(outside, current), join(root, 'linked.lyric.json'));
  await link(join(outside, current), join(root, 'hard.lyric.json'));
  await symlink(outside, join(root, '.banger/history/escape'));
  for (const path of ['../song.lyric.json', join(outside, current), 'a/../song.lyric.json', 'escape/song.lyric.json', 'linked.lyric.json', 'hard.lyric.json', '.env', 'settings.json', '.banger/library/song.lyric.json', '.banger/history/song/vocals/lyrics-v001.json', '.banger/history/song/lyrics/arbitrary.json', '.banger/history/escape/lyrics/lyrics-v001.json']) {
    await assert.rejects(workspace.readLyrics(path), path);
    await assert.rejects(workspace.writeLyrics(path, original, original), path);
  }
  for (const [name, bytes] of [['utf8', Buffer.from([0xff])], ['null', '\0'], ['big', 'x'.repeat(65537)], ['json', '{}']]) {
    await writeFile(join(root, `${name}.lyric.json`), bytes);
    await assert.rejects(workspace.readLyrics(`${name}.lyric.json`));
  }
  assert.equal(await readFile(join(outside, current), 'utf8'), original);
  assert.ok(!(await workspace.listLyrics()).some(path => /linked|hard|escape/.test(path)));
});

test('symlinked hidden storage cannot redirect history writes', async t => {
  const { root, workspace } = await fixture(t, false);
  const original = JSON.stringify(document('Original'));
  await writeFile(join(root, current), original);
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'outside-history-')));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(root, '.banger'));
  await assert.rejects(workspace.writeLyrics(current, JSON.stringify(document('Changed')), original), /symbolic links/);
  assert.equal(await readFile(join(root, current), 'utf8'), original);
  assert.deepEqual(await readdir(outside), []);
});

test('agent discovers, reads history, edits lyrics, writes again and follows up on the current lyrics', async t => {
  const { workspace } = await fixture(t);
  const model = new MockLanguageModelV4({ doGenerate: [
    call('list_lyrics', {}), call('read_lyrics', { path: revision(1) }), call('read_lyrics', { path: current }),
    call('edit_lyrics', { path: current, search: 'First line', replacement: 'Second line' }),
    call('write_lyrics', { path: current, source: JSON.stringify(document('Third line')) }), finish(),
    call('edit_lyrics', { path: current, search: 'Third line', replacement: 'Follow-up' }), finish(),
  ] });
  const events = [];
  const session = new ProjectSession({ workspace, selected: { model, name: 'fixture' }, onEvent: event => events.push(event) });
  const result = await session.run('Revise the lyrics', { activeFile: 'song.banger' });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.changedPaths, [current]);
  assert.deepEqual(result.validation, [{ path: current, ok: true, kind: 'lyrics' }]);
  assert.deepEqual(JSON.parse(result.files[0].source), document('Third line'));
  assert.match(JSON.stringify(model.doGenerateCalls[0].prompt), /lyricsPaths/);
  assert.match(JSON.stringify(model.doGenerateCalls[2].prompt), /First line/);
  assert.equal((await session.run('Revise that line again')).status, 'completed');
  assert.deepEqual(JSON.parse((await workspace.readLyrics(revision(4))).source), document('Follow-up'));
  assert.equal(events.filter(event => event.type === 'file-changed').length, 3);
});

test('agent reports missing lyrics gracefully and cannot write unread lyrics or history', async t => {
  const { workspace } = await fixture(t);
  const model = new MockLanguageModelV4({ doGenerate: [
    call('read_lyrics', { path: 'missing.lyric.json' }), finish(),
    call('write_lyrics', { path: current, source: JSON.stringify(document('Unread')) }), finish(),
    call('read_lyrics', { path: revision(1) }),
    call('write_lyrics', { path: revision(1), source: JSON.stringify(document('History edit')) }), finish(),
  ] });
  const session = new ProjectSession({ workspace, selected: { model, name: 'fixture' } });
  assert.equal((await session.run('Read missing lyrics')).status, 'completed');
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt), /"result":null/);
  assert.equal((await session.run('Write without reading')).status, 'incomplete');
  assert.equal((await session.run('Overwrite history')).status, 'incomplete');
  assert.equal((await workspace.listLyrics()).length, 2);
});


test('separate workspaces serialize lyric saves, and failed precommit checks remove only the new revision', async t => {
  const { root, workspace } = await fixture(t);
  const other = await openProject(root);
  const original = (await workspace.readLyrics(current)).source;
  const outcomes = await Promise.allSettled([
    workspace.writeLyrics(current, JSON.stringify(document('Editor one')), original),
    other.writeLyrics(current, JSON.stringify(document('Editor two')), original),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length, 1);
  const saved = (await workspace.readLyrics(current)).source;
  let checks = 0;
  await assert.rejects(songStorage.saveLyrics({ root, name: 'song' }, document('Rejected'), async () => {
    if (++checks === 2) throw new Error('File changed before commit');
  }), /changed before commit/);
  assert.equal(checks, 2);
  assert.equal((await workspace.readLyrics(current)).source, saved);
  assert.equal((await workspace.readLyrics(revision(1))).source, original);
  assert.equal((await workspace.readLyrics(revision(2))).source, saved);
  assert.deepEqual((await readdir(join(root, '.banger/history/song/lyrics'))).sort(), ['lyrics-v001.json', 'lyrics-v002.json']);
  assert.deepEqual((await readdir(root)).sort(), ['.banger', 'song.banger', current]);
});

test('drafts persist without chunks, detect conflicts, and retire only after chunk lyrics save', async t => {
  const {root,workspace}=await fixture(t,false);
  const song={root,name:'song'}, path='song.draft.json';
  const draft={schemaVersion:1,lyrics:'[Verse]\nBefore the morning'};
  const saved=await workspace.writeDraft(path,JSON.stringify(draft),null);
  assert.deepEqual(await songStorage.readDraft(song),draft);
  assert.deepEqual(await workspace.listLyrics(),[path]);
  await assert.rejects(workspace.writeDraft(path,JSON.stringify(draft),null),/changed/);
  await assert.rejects(songStorage.retireDraft(song,draft),/Save chunk lyrics/);
  assert.equal((await workspace.readLyrics(path)).source,saved.source);
  await songStorage.saveLyrics(song,document('Before the morning'));
  await assert.rejects(workspace.writeDraft(path,JSON.stringify(draft),saved.source),/composition/);
  await songStorage.retireDraft(song,draft);
  assert.equal(await songStorage.readDraft(song),null);
  await assert.rejects(workspace.writeDraft(path,JSON.stringify(draft),null),/composition/);
  assert.equal(JSON.parse((await workspace.readLyrics(current)).source).plan.chunks[0].text,'Before the morning');
});

test('the project agent creates a draft using its file tool when no composition exists', async t=>{
  const {workspace}=await fixture(t,false);
  const draft={schemaVersion:1,lyrics:'[Chorus]\nA brighter day'};
  const model=new MockLanguageModelV4({doGenerate:[call('write_draft',{path:'song.draft.json',source:JSON.stringify(draft)}),finish()]});
  const result=await new ProjectSession({workspace,selected:{model,name:'fixture'}}).run('Write lyrics for this song',{activeFile:'song.banger'});
  assert.equal(result.status,'completed');
  assert.deepEqual(result.changedPaths,['song.draft.json']);
  assert.deepEqual(JSON.parse((await workspace.readLyrics('song.draft.json')).source),draft);
});

test('legacy lyrics remain discoverable and the next agent edit saves the canonical lyric filename', async t=>{
 const {root,workspace}=await fixture(t,false);
 await writeFile(join(root,'song.lyrics.json'),JSON.stringify(document('Legacy words')));
 assert.deepEqual(await workspace.listLyrics(),[current]);
 const original=await workspace.readLyrics(current);
 await workspace.editLyrics(current,'Legacy words','Current words',original.source);
 assert.match(await readFile(join(root,current),'utf8'),/Current words/);
 assert.match(await readFile(join(root,'song.lyrics.json'),'utf8'),/Legacy words/);
});
