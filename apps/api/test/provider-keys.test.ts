import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MusicProviderError, type MusicProvider } from '@banger/elevenlabs';
import { ApiError } from '../src/server/domain';
import { bindElevenInput, claim, enqueue } from '../src/server/jobs';
import { runElevenStep, type MusicObjects } from '../src/server/elevenlabs';
import { browserGeneration } from '../src/server/web-ai';
import { runWebTask } from '../src/server/web-task';
import { createProject } from '../src/server/projects';
import { db } from '../src/server/db';
import {
  decideElevenKey, defaultServerSelection, resolveArtworkCredentials, resolveWebCredentials, serverAIStatus, serverKeyFor,
} from '../src/server/provider-keys';

const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'AI_GATEWAY_API_KEY', 'META_API_KEY', 'MUSE_API_KEY', 'BANGER_API_KEY', 'BANGER_PROVIDER', 'BANGER_MODEL', 'ELEVENLABS_API_KEY'] as const;
const saved = Object.fromEntries(KEYS.map(name => [name, process.env[name]]));
function clearKeys() { for (const name of KEYS) delete process.env[name]; }
function restoreKeys() { for (const name of KEYS) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } }
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => [key, ...strings(item)]);
}
function hides(value: unknown, ...secrets: string[]) {
  const encoded = JSON.stringify(value);
  for (const secret of secrets) assert.equal(encoded.includes(secret), false);
  assert.equal(strings(value).some(item => item.toLowerCase() === 'key' || item.toLowerCase().endsWith('apikey')), false);
}

describe('hosted provider keys', { concurrency: 1 }, () => {
test('hosted keys prefer server configuration, hide secrets, and do not fall back after an invalid key', () => {
  clearKeys();
  try {
    assert.equal(serverKeyFor('openai').state, 'absent');
    assert.equal(defaultServerSelection(), undefined);
    hides(serverAIStatus());

    process.env.BANGER_API_KEY = 'banger-openai-fixture';
    process.env.BANGER_MODEL = 'gpt-6.1-sol';
    assert.equal(serverKeyFor('openai').key, 'banger-openai-fixture');
    assert.deepEqual(defaultServerSelection(), { provider: 'openai', model: 'gpt-6.1-sol' });
    process.env.OPENAI_API_KEY = 'conventional-openai-fixture';
    assert.equal(resolveWebCredentials({ provider: 'openai', model: 'fixture', key: 'user-openai-fixture' }).key, 'conventional-openai-fixture');
    assert.equal(resolveWebCredentials({ provider: 'openai', model: 'fixture', key: 'user-openai-fixture' }).source, 'server');
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '   ';
    assert.equal(serverKeyFor('openai').key, 'banger-openai-fixture');
    process.env.OPENAI_API_KEY = 'bad openai key';
    assert.equal(serverKeyFor('openai').state, 'invalid');
    assert.throws(() => resolveWebCredentials({ provider: 'openai', model: 'fixture', key: 'user-openai-fixture' }), (error: unknown) => error instanceof ApiError && error.status === 503 && !error.message.includes('bad openai') && !error.message.includes('user-openai'));
    delete process.env.OPENAI_API_KEY;

    process.env.BANGER_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'conventional-anthropic-fixture';
    assert.equal(serverKeyFor('anthropic').key, 'conventional-anthropic-fixture');
    assert.equal(defaultServerSelection()?.provider, 'anthropic');
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(serverKeyFor('anthropic').key, 'banger-openai-fixture');
    process.env.BANGER_PROVIDER = 'not-a-provider';
    assert.equal(serverKeyFor('openai').state, 'absent');
    assert.equal(serverKeyFor('anthropic').state, 'absent');
    delete process.env.BANGER_PROVIDER;
    delete process.env.BANGER_API_KEY;
    delete process.env.BANGER_MODEL;

    process.env.META_API_KEY = 'meta-muse-fixture';
    process.env.MUSE_API_KEY = 'alias-muse-fixture';
    process.env.AI_GATEWAY_API_KEY = 'gateway-muse-fixture';
    assert.equal(serverKeyFor('meta').key, 'meta-muse-fixture');
    assert.equal(resolveArtworkCredentials({ provider: 'vercel', key: 'user-artwork-fixture' }).key, 'meta-muse-fixture');
    delete process.env.META_API_KEY;
    assert.equal(serverKeyFor('meta').key, 'alias-muse-fixture');
    process.env.META_API_KEY = 'bad meta key';
    assert.equal(serverKeyFor('meta').state, 'invalid');
    assert.throws(() => resolveArtworkCredentials({ provider: 'vercel', key: 'user-artwork-fixture' }), (error: unknown) => error instanceof ApiError && error.status === 503 && !String(error).includes('user-artwork') && !String(error).includes('gateway-muse'));
    delete process.env.META_API_KEY;
    delete process.env.MUSE_API_KEY;
    assert.equal(resolveArtworkCredentials(undefined).key, 'gateway-muse-fixture');
    delete process.env.AI_GATEWAY_API_KEY;
    assert.deepEqual(resolveArtworkCredentials({ provider: 'vercel', key: 'user-artwork-fixture' }), { provider: 'vercel', key: 'user-artwork-fixture' });

    process.env.XAI_API_KEY = 'grok-fixture';
    assert.equal(defaultServerSelection()?.provider, 'grok');
    assert.equal(resolveWebCredentials(undefined).model, 'grok-4.7');
    assert.equal(resolveWebCredentials({ provider: 'grok' }).model, 'grok-4.7');
    const status = serverAIStatus();
    hides(status, 'grok-fixture');
    assert.equal(status.providers.grok.available, true);
    assert.equal(status.providers.openai.available, false);
    assert.equal(status.elevenlabs, false);
    assert.equal(status.artwork, false);
    process.env.ELEVENLABS_API_KEY = 'eleven-fixture';
    assert.equal(serverAIStatus().elevenlabs, true);
    hides(serverAIStatus(), 'eleven-fixture', 'grok-fixture');
    process.env.ELEVENLABS_API_KEY = 'bad eleven key';
    assert.equal(serverAIStatus().elevenlabs, true);
    hides(serverAIStatus(), 'bad eleven key');
    assert.equal(decideElevenKey({}, {}, true).action, 'fail');
    delete process.env.ELEVENLABS_API_KEY;
    assert.equal(decideElevenKey({ clientKeyRequired: true }, {}, false).action, 'wait');
    process.env.ELEVENLABS_API_KEY = 'eleven-fixture';
    assert.equal(decideElevenKey({ clientKeyRequired: true }, {}, true).action, 'use-client');
    assert.equal(decideElevenKey({ keySource: 'server' }, {}, true).action, 'use-server');
    delete process.env.ELEVENLABS_API_KEY;
    assert.equal(decideElevenKey({ keySource: 'server' }, {}, true).action, 'wait');
    assert.equal(decideElevenKey({}, { serverKeyRejected: true }, true).action, 'fail');
    assert.equal(decideElevenKey({}, {}, true).action, 'use-client');
    process.env.BANGER_MODEL = 'not a model';
    process.env.BANGER_API_KEY = 'banger-openai-fixture';
    assert.equal(defaultServerSelection()?.model, 'gpt-6-astra');
    clearKeys();
    assert.throws(() => resolveWebCredentials({ provider: 'openai', model: 'fixture', baseURL: 'http://internal' } as never), /AI settings|Invalid/);
  } finally { restoreKeys(); }
});

test('hosted chat, project tasks, and vocals run from server keys and do not spend a personal key after rejection', { skip: !process.env.DATABASE_URL }, async t => {
  clearKeys();
  t.after(async () => { restoreKeys(); await db().end(); });
  const user = `keys-${randomUUID()}`;
  const serverKey = 'server-openai-fixture';
  const userKey = 'user-openai-must-not-be-used';
  process.env.OPENAI_API_KEY = serverKey;
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls += 1;
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${serverKey}`);
    assert.equal(String(init?.body).includes(serverKey), false);
    assert.equal(String(init?.body).includes(userKey), false);
    return new Response('unauthorized', { status: 401 });
  };
  const request = { messages: [{ role: 'user', content: 'Suggest a rhythm' }], previousFiles: [], currentFile: { name: 'song.banger', source: 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; }' } };
  const rejected = await browserGeneration(user, 'chat', { credentials: { provider: 'openai', model: 'fixture', key: userKey }, request }, new AbortController().signal, fetcher);
  assert.equal(calls, 1);
  assert.equal(rejected.ok, false);
  assert.equal('code' in rejected && rejected.code, 'hosted_provider_rejected');
  hides(rejected, serverKey, userKey);
  process.env.OPENAI_API_KEY = 'bad server key';
  await assert.rejects(browserGeneration(user, 'chat', { credentials: { provider: 'openai', model: 'fixture', key: userKey }, request }, new AbortController().signal, async () => { throw new Error('provider called'); }), (error: unknown) => error instanceof ApiError && error.status === 503 && !String(error).includes(userKey));
  process.env.OPENAI_API_KEY = serverKey;
  let hostedCalls = 0;
  const hosted = await browserGeneration(`${user}-hosted`, 'chat', { request }, new AbortController().signal, async (_url, init) => {
    hostedCalls += 1;
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${serverKey}`);
    assert.equal(JSON.parse(String(init?.body)).model, 'gpt-6-astra');
    return Response.json({ id: 'fixture', object: 'chat.completion', created: 1, model: 'gpt-6-astra', choices: [{ index: 0, message: { role: 'assistant', content: 'Hosted reply' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  assert.equal(hostedCalls, 1);
  assert.equal(hosted.ok, true);
  hides(hosted, serverKey);

  const source = 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain .6; }';
  const project = (await createProject(user, 'Hosted keys', [{ path: 'song.banger', source }])).projectId;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${serverKey}`);
    assert.equal(String(init?.body).includes(serverKey), false);
    return Response.json({ id: 'fixture', object: 'chat.completion', created: 1, model: 'gpt-6-astra', choices: [{ index: 0, message: { role: 'assistant', content: 'Project reply' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }) as typeof fetch;
  try {
    const task = await runWebTask(user, project, { thread: randomUUID(), baseRevision: 1, prompt: 'Leave the song unchanged', activeFile: 'song.banger' }, new AbortController().signal);
    assert.equal(task.reply.text, 'Project reply');
    hides(task, serverKey);
    const history = (await db().query('SELECT history,model FROM web_agent_threads WHERE project_id=$1', [project])).rows[0];
    hides(history, serverKey);
  } finally { globalThis.fetch = previousFetch; }

  delete process.env.OPENAI_API_KEY;
  const personal = await browserGeneration(`${user}-byok`, 'chat', { credentials: { provider: 'openai', model: 'fixture', key: 'personal-fixture-key' }, request }, new AbortController().signal, async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer personal-fixture-key');
    return Response.json({ id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content: 'Personal reply' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  assert.equal(personal.ok, true);

  const artifact = randomUUID();
  const objects = new Map<string, Buffer>([[`${artifact}.wav`, Buffer.from('fixture')]]);
  const storage: MusicObjects = { async exists(path) { return objects.has(path); }, async read(path) { return objects.get(path)!; }, async write(path, body) { objects.set(path, Buffer.from(body)); }, async size(path) { return objects.get(path)?.length ?? 0; } };
  await db().query("INSERT INTO artifacts(id,project_id,revision,user_id,kind,pathname,content_type,size,status) VALUES($1,$2,1,$3,'wav',$4,'audio/wav',7,'ready')", [artifact, project, user, `${artifact}.wav`]);
  process.env.ELEVENLABS_API_KEY = 'server-eleven-fixture';
  const bound = bindElevenInput({ artifactId: artifact, studioPath: 'song.banger' }, 'client-eleven-must-not-be-stored');
  hides(bound, 'server-eleven-fixture', 'client-eleven-must-not-be-stored');
  assert.equal('keySource' in bound && bound.keySource, 'server');
  const queued = await enqueue(user, project, 'elevenlabs', randomUUID(), bound);
  hides(queued.input, 'server-eleven-fixture', 'client-eleven-must-not-be-stored');
  let clientCalls = 0;
  const client: MusicProvider = { async analyze() { clientCalls += 1; throw new Error('personal provider used'); }, async lyrics() { throw new Error('personal provider used'); }, async generate() { throw new Error('personal provider used'); } };
  let serverCalls = 0;
  const denied: MusicProvider = { async analyze() { serverCalls += 1; throw new MusicProviderError('ElevenLabs denied access. Check the API key and Music permissions.'); }, async lyrics() { throw new Error('lyrics'); }, async generate() { throw new Error('generate'); } };
  await runElevenStep((await claim(queued.id))!, client, storage, denied);
  assert.equal(serverCalls, 1);
  assert.equal(clientCalls, 0);
  const failed = (await db().query('SELECT status,error,input,checkpoint FROM jobs WHERE id=$1', [queued.id])).rows[0];
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /personal key was not used/);
  hides(failed, 'server-eleven-fixture', 'client-eleven-must-not-be-stored');
  delete process.env.ELEVENLABS_API_KEY;
  await db().query("UPDATE jobs SET status='queued',lease_until=now()-interval '1 second',available_at=now() WHERE id=$1", [queued.id]);
  await runElevenStep((await claim(queued.id))!, client, storage, denied);
  assert.equal(clientCalls, 0);
  assert.equal(serverCalls, 1);
  const stale = (await db().query('SELECT status,error FROM jobs WHERE id=$1', [queued.id])).rows[0];
  assert.equal(stale.status, 'needs_review');
  hides(stale, 'server-eleven-fixture');

  const waiting = await enqueue(user, project, 'elevenlabs', randomUUID(), bindElevenInput({ artifactId: artifact }, null));
  await runElevenStep((await claim(waiting.id))!, undefined, storage);
  assert.equal((await db().query('SELECT status FROM jobs WHERE id=$1', [waiting.id])).rows[0].status, 'awaiting_provider');
  process.env.ELEVENLABS_API_KEY = 'server-eleven-restored';
  await db().query("UPDATE jobs SET status='queued',lease_until=now()-interval '1 second',available_at=now() WHERE id=$1", [waiting.id]);
  const restored: MusicProvider = { async analyze() { return { songId: 'hosted', plan: { chunks: [{ text: '[Verse]\nWords', durationMs: 4000, positiveStyles: ['piano'] }] } }; }, async lyrics(plan) { return plan; }, async generate() { throw new Error('generate'); } };
  await runElevenStep((await claim(waiting.id))!, client, storage, restored);
  assert.equal(clientCalls, 0);
  assert.equal((await db().query('SELECT status FROM jobs WHERE id=$1', [waiting.id])).rows[0].status, 'completed');
  hides((await db().query('SELECT input,checkpoint,result,error FROM jobs WHERE id=$1', [waiting.id])).rows[0], 'server-eleven-restored');
  delete process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'server-eleven-fixture';
  const staleJob = await enqueue(user, project, 'elevenlabs', randomUUID(), bindElevenInput({ artifactId: artifact }, null));
  delete process.env.ELEVENLABS_API_KEY;
  await runElevenStep((await claim(staleJob.id))!, client, storage);
  assert.equal(clientCalls, 0);
  const staleBound = (await db().query('SELECT status,error,input,checkpoint FROM jobs WHERE id=$1', [staleJob.id])).rows[0];
  assert.equal(staleBound.status, 'awaiting_provider');
  assert.match(staleBound.error, /no longer configured/);
  hides(staleBound, 'server-eleven-fixture');
});
});
