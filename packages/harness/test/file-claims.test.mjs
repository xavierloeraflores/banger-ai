import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { FileClaims, ProjectSession, openProject } from '../dist/index.js';

const response = (content, reason = 'stop') => ({ content, finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } }, warnings: [] });
const edit = (before, after) => response([{ type: 'tool-call', toolCallId: 'edit', toolName: 'edit_file', input: JSON.stringify({ path: 'song.banger', search: before, replacement: after }) }], 'tool-calls');
const finish = response([{ type: 'text', text: 'Done.' }]);

test('concurrent chats claim writes while both can list and read the file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'banger-claims-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain .6; }';
  await writeFile(join(root, 'song.banger'), source);
  const workspace = await openProject(root);
  const claims = new FileClaims();
  const outcomes = await Promise.allSettled([
    Promise.resolve().then(() => claims.claim(root, 'song.banger', 'chat-a')),
    Promise.resolve().then(() => claims.claim(root, 'song.banger', 'chat-b')),
  ]);
  assert.deepEqual(outcomes.map(item => item.status), ['fulfilled', 'rejected']);
  assert.match(outcomes[1].reason.message, /song\.banger is being edited in another chat/);
  assert.deepEqual(await workspace.list(), ['song.banger']);
  assert.equal((await workspace.read('song.banger')).source, source);
  claims.claim(root, 'song.banger', 'chat-a');
  claims.release('chat-a');
  claims.claim(root, 'song.banger', 'chat-b');
});

test('expired claims can be taken over and an old owner cannot release them', () => {
  let now = 0;
  const claims = new FileClaims(100, () => now);
  claims.claim('project', 'song.draft.json', 'chat-a');
  now = 101;
  claims.claim('project', 'song.draft.json', 'chat-b');
  claims.release('chat-a');
  assert.throws(() => claims.claim('project', 'song.draft.json', 'chat-c'), /another chat/);
});

test('agent sessions reject a competing write and release the file after cancellation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'banger-claim-sessions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'song.banger'), 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain .6; }');
  const workspace = await openProject(root);
  const controller = new AbortController();
  let saved;
  const firstSaved = new Promise(resolve => { saved = resolve; });
  let calls = 0;
  const firstModel = new MockLanguageModelV4({ doGenerate: async () => {
    if (calls++ === 0) return edit('120', '110');
    await new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }));
    return finish;
  } });
  const first = new ProjectSession({ workspace, selected: { model: firstModel, name: 'first' }, onEvent: event => { if (event.type === 'file-changed') saved(); } });
  const running = first.run('Change tempo', { activeFile: 'song.banger', signal: controller.signal });
  await firstSaved;
  const secondModel = new MockLanguageModelV4({ doGenerate: [edit('110', '100'), finish] });
  const second = new ProjectSession({ workspace, selected: { model: secondModel, name: 'second' } });
  const blocked = await second.run('Change tempo', { activeFile: 'song.banger' });
  assert.equal(blocked.status, 'incomplete');
  assert.deepEqual(blocked.changedPaths, []);
  assert.ok(JSON.stringify(secondModel.doGenerateCalls[1].prompt).includes('being edited in another chat'));
  assert.equal((await workspace.read('song.banger')).source.includes('tempo 110'), true);
  controller.abort();
  await assert.rejects(running);
  const nextModel = new MockLanguageModelV4({ doGenerate: [edit('110', '100'), finish] });
  const after = await new ProjectSession({ workspace, selected: { model: nextModel, name: 'next' } }).run('Change tempo', { activeFile: 'song.banger' });
  assert.equal(after.status, 'completed');
  assert.equal((await workspace.read('song.banger')).source.includes('tempo 100'), true);
});

for (const name of ['write_file', 'edit_file', 'write_draft', 'write_lyrics', 'edit_lyrics']) {
  test(`${name} blocks competing writes, permits discovery and reads, and releases after failure`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'banger-all-claims-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const music = 'tempo 120; track kick { sound "drums/kick"; rhythm "x . x ."; }';
    const path = name === 'write_draft' ? 'song.draft.json' : name.includes('lyrics') ? 'song.lyric.json' : 'song.banger';
    const original = path.endsWith('.banger') ? music : JSON.stringify(path.endsWith('.draft.json') ? { schemaVersion: 1, lyrics: 'Original words' } : { plan: { chunks: [{ text: 'Original words' }] } });
    await writeFile(join(root, 'song.banger'), music);
    await writeFile(join(root, path), original);
    const workspace = await openProject(root);
    const call = (toolName, input) => response([{ type: 'tool-call', toolCallId: toolName, toolName, input: JSON.stringify(input) }], 'tool-calls');
    const mutation = name.startsWith('edit') ? call(name, { path, search: path.endsWith('.banger') ? '120' : 'Original words', replacement: path.endsWith('.banger') ? '110' : 'Changed words' }) : call(name, { path, source: original });
    let release, ready;
    const gate = new Promise(resolve => { release = resolve; });
    const claimed = new Promise(resolve => { ready = resolve; });
    let count = 0;
    const ownerModel = new MockLanguageModelV4({ doGenerate: async () => {
      if (count++ === 0) return mutation;
      ready(); await gate; throw new Error('Provider failed');
    } });
    const owner = new ProjectSession({ workspace, selected: { model: ownerModel, name: 'owner' } }).run('Edit', { activeFile: path });
    const stopped = assert.rejects(owner, /Provider failed/);
    await claimed;
    const events = [];
    const contenderModel = new MockLanguageModelV4({ doGenerate: [call('list_files', {}), call('list_lyrics', {}), call(path.endsWith('.banger') ? 'read_file' : 'read_lyrics', { path }), mutation, finish] });
    try {
      const contender = await new ProjectSession({ workspace: await openProject(root), selected: { model: contenderModel, name: 'contender' }, onEvent: event => events.push(event) }).run('Edit', { activeFile: path });
      assert.equal(contender.status, 'incomplete');
      assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.ok), [true, true, true, false]);
      assert.equal(events.find(event => event.type === 'tool-result' && !event.ok).error, `${path} is being edited in another chat.`);
    } finally { release(); await stopped; }
    const current = path.endsWith('.banger') ? await workspace.read(path) : await workspace.readLyrics(path);
    const toolName = path.endsWith('.banger') ? 'write_file' : path.endsWith('.draft.json') ? 'write_draft' : 'write_lyrics';
    const next = await new ProjectSession({ workspace, selected: { model: new MockLanguageModelV4({ doGenerate: [call(toolName, { path, source: current.source }), finish] }), name: 'next' } }).run('Save', { activeFile: path });
    assert.equal(next.status, 'completed');
  });
}
