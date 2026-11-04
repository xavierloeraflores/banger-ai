import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { browserGeneration } from '../src/server/web-ai';
import { db } from '../src/server/db';

test('web generation uses the selected provider server-side and redacts upstream failures', { skip: !process.env.DATABASE_URL }, async t => {
  t.after(() => db().end());
  const user = `ai-${randomUUID()}`;
  const credentials = { provider: 'openai', model: 'fixture', key: 'private-fixture-key' };
  let text = 'A fixture reply';
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${credentials.key}`);
    assert.equal(JSON.parse(String(init?.body)).model, 'fixture');
    return Response.json({ id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  };
  const request = { messages: [{ role: 'user', content: 'Suggest a rhythm' }], previousFiles: [], currentFile: { name: 'song.banger', source: 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; }' } };
  const signal = new AbortController().signal;
  const chat = await browserGeneration(user, 'chat', { credentials, request }, signal, fetcher);
  assert.equal(chat.ok, true);
  assert.ok('reply' in chat && chat.reply?.text === text);
  text = JSON.stringify([{ index: 0, lyrics: 'Fixture lyrics' }]);
  const lyrics = await browserGeneration(user, 'lyrics', { credentials, request: { prompt: 'Write a verse', chunks: [] } }, signal, fetcher);
  assert.ok('edits' in lyrics);
  assert.equal(calls, 2);
  const failure = await browserGeneration(user, 'chat', { credentials, request }, signal, async () => { throw new Error(credentials.key); });
  assert.equal(failure.ok, false);
  assert.ok(!JSON.stringify(failure).includes(credentials.key));
  await assert.rejects(browserGeneration(user, 'chat', { credentials: { ...credentials, baseURL: 'http://internal/' }, request }, signal, fetcher), /AI settings/);
  assert.equal(calls, 2);
  await db().query('UPDATE web_auth_limits SET attempts=20 WHERE bucket=$1', [`ai:${user}`]);
  await assert.rejects(browserGeneration(user, 'chat', { credentials, request }, signal, fetcher), /Too many generation/);
  assert.equal(calls, 2);
});
