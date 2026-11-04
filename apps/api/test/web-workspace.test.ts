import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { installWebWorkspace, type WebRequest } from '../src/app/web-workspace';
import { aiSettingsBridge } from '../../www/src/lib/ai-providers';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test('web project tasks retain their project and thread while switching, cancel independently, and remember recents per account', async t => {
  const local = storage();
  const previousLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'localStorage', {value:local, configurable:true});
  Object.defineProperty(globalThis, 'window', {value:{sessionStorage:storage()}, configurable:true});
  t.after(() => { for (const [key, descriptor] of [['localStorage',previousLocal],['window',previousWindow]] as const) { if (descriptor) Object.defineProperty(globalThis,key,descriptor); else Reflect.deleteProperty(globalThis,key); } });
  await aiSettingsBridge().save('openai', 'fixture', 'fixture-key');
  const snapshots = new Map(['A', 'B'].map(id => [id, { projectId: id, name: `Project ${id}`, revision: 1, files: [{ path: 'song.banger', source: `source ${id}` }] }]));
  const request: WebRequest = async <T>(path: string) => {
    if (path === '/projects') return { projects: [...snapshots.keys()].map(id => ({ id })) } as T;
    const snapshot = snapshots.get(path.split('/')[2]!);
    if (!snapshot) throw new Error('Project access denied');
    return structuredClone(snapshot) as T;
  };
  const pending = new Map<string, { complete(): void; signal: AbortSignal; thread: string }>();
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const id = String(url).split('/')[3]!;
    const signal = init!.signal as AbortSignal;
    const body = JSON.parse(String(init!.body));
    return await new Promise<Response>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true });
      pending.set(body.thread, { signal, thread: body.thread, complete() {
        snapshots.get(id)!.files[0]!.source = `completed ${id}`;
        resolve(new Response(`${JSON.stringify({ event: { type: 'file-changed', file: { path: 'song.banger', source: `completed ${id}` } } })}\n${JSON.stringify({ reply: { text: `Done ${id}`, status: 'completed', changedPaths: ['song.banger'] } })}\n`));
      } });
    });
  });
  const web = installWebWorkspace(request, async () => 'A', 'account-one');
  const events: {projectId?: string; threadId?: string}[] = [];
  web.workspace.onEvent(event => events.push(event));
  await web.workspace.open();
  const first = web.workspace.run('Task A', 'song.banger', false, {beat:true, lyrics:false}, 'A', 'chat-a');
  while (!pending.has('chat-a')) await setImmediate();
  await web.workspace.restore!('B');
  const second = web.workspace.run('Task B', 'song.banger', false, {beat:true, lyrics:false}, 'B', 'chat-b');
  while (!pending.has('chat-b')) await setImmediate();
  assert.deepEqual(await web.workspace.run('Duplicate', undefined, false, undefined, 'A', 'chat-a'), {ok:false,error:'A project task is already running.'});
  await web.workspace.cancel('A');
  assert.equal((await first).ok, false);
  assert.equal(pending.get('chat-b')!.signal.aborted, false);
  pending.get('chat-b')!.complete();
  assert.equal((await second).ok, true);
  assert.equal(web.current().projectId, 'B');
  pending.delete('chat-a');
  const third = web.workspace.run('Another A task', 'song.banger', false, undefined, 'A', 'chat-a-two');
  while (!pending.has('chat-a-two')) await setImmediate();
  pending.get('chat-a-two')!.complete();
  assert.equal((await third).ok, true);
  assert.equal(web.current().projectId, 'B');
  assert.equal((await web.workspace.read('song.banger', 'A')).source, 'completed A');
  assert.equal(web.current().projectId, 'B');
  assert.deepEqual(events.map(event => [event.projectId,event.threadId]), [['B','chat-b'],['A','chat-a-two']]);
  const simultaneousA = web.workspace.run('Concurrent A', 'song.banger', false, undefined, 'A', 'parallel-a');
  const simultaneousB = web.workspace.run('Concurrent B', 'song.banger', false, undefined, 'A', 'parallel-b');
  while (!pending.has('parallel-a') || !pending.has('parallel-b')) await setImmediate();
  await web.workspace.cancel('A', 'parallel-a');
  assert.equal((await simultaneousA).ok, false);
  assert.equal(pending.get('parallel-b')!.signal.aborted, false);
  pending.get('parallel-b')!.complete();
  assert.equal((await simultaneousB).ok, true);
  assert.deepEqual((await web.workspace.recent!()).map(item => item.id), ['B','A']);
  const reopened = installWebWorkspace(request, async () => null, 'account-one');
  assert.equal((await reopened.workspace.recent!()).length, 2);
  await reopened.workspace.restore!('A');
  assert.deepEqual((await reopened.workspace.recent!()).map(item => item.id), ['A','B']);
  assert.equal((await installWebWorkspace(request, async () => null, 'account-two').workspace.recent!()).length, 0);
  snapshots.delete('A');
  assert.deepEqual((await reopened.workspace.recent!()).map(item => item.id), ['B']);
  await assert.rejects(reopened.workspace.restore!('A'), /access denied/);
});
