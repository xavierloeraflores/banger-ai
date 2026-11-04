import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import { runBangerAgent } from '../dist/index.js';

const source = 'tempo 120; track kick { sound "drums/kick"; rhythm "x . x ."; }';
const requestId = '11111111-1111-4111-8111-111111111111';
const request = { requestId, messages: [{ role: 'user', content: 'Make a loop' }], currentFile: { name: 'song.banger', source }, previousFiles: [] };
const finish = reason => ({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } } });
const tool = source => ({ type: 'tool-call', toolCallId: 'create', toolName: 'create_banger_file', input: JSON.stringify({ name: 'new.banger', source }) });
const stream = parts => ({ stream: new ReadableStream({ start(output) { for (const part of parts) output.enqueue(part); output.close(); } }) });

test('streams answer text before completion, repairs invalid files, and excludes reasoning and tool JSON', async () => {
  const events = [];
  let release;
  let arrived;
  const firstText = new Promise(resolve => { arrived = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const model = new MockLanguageModelV4({ doStream: [
    stream([tool('invalid code'), finish('tool-calls')]),
    stream([tool(source), finish('tool-calls')]),
    { stream: new ReadableStream({ async start(output) {
      output.enqueue({ type: 'reasoning-start', id: 'private' });
      output.enqueue({ type: 'reasoning-delta', id: 'private', delta: 'PRIVATE REASONING' });
      output.enqueue({ type: 'reasoning-end', id: 'private' });
      output.enqueue({ type: 'text-start', id: 'answer' });
      output.enqueue({ type: 'text-delta', id: 'answer', delta: 'Your loop' });
      await gate;
      output.enqueue({ type: 'text-delta', id: 'answer', delta: ' is ready.' });
      output.enqueue({ type: 'text-end', id: 'answer' });
      output.enqueue(finish('stop'));
      output.close();
    } }) },
  ] });
  let completed = false;
  const result = runBangerAgent(request, { model, name: 'fixture' }, undefined, event => {
    events.push(event);
    if (event.type === 'text-delta') arrived();
  }).then(value => { completed = true; return value; });
  await firstText;
  assert.equal(completed, false);
  assert.equal(events.filter(e => e.type === 'text-delta').map(e => e.text).join(''), 'Your loop');
  assert.ok(events.every(e => e.requestId === requestId));
  assert.ok(events.some(e => e.message === 'Reading project context'));
  assert.ok(events.some(e => e.message === 'Validating new.banger'));
  assert.ok(events.some(e => e.message === 'Requesting a repair for rejected output'));
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE REASONING|drums\/kick|toolCallId/);
  release();
  const reply = await result;
  assert.equal(reply.files.length, 1);
  assert.equal(reply.text, 'Your loop is ready.');
});

test('stream errors and cancellation reject the reply and never publish proposals', async () => {
  for (const abort of [false, true]) {
    const controller = new AbortController();
    const events = [];
    const model = new MockLanguageModelV4({ doStream: [stream([tool(source), finish('tool-calls')]), stream([
      { type: 'text-start', id: 'answer' }, { type: 'text-delta', id: 'answer', delta: 'Partial answer' },
      ...(abort ? [finish('stop')] : [{ type: 'error', error: new Error('provider failure') }]),
    ])] });
    await assert.rejects(runBangerAgent(request, { model, name: 'fixture' }, controller.signal, event => {
      events.push(event);
      if (abort && event.type === 'text-delta') controller.abort();
    }));
    assert.ok(events.some(event => event.type === 'text-delta'));
    assert.ok(events.every(event => !('files' in event)));
  }
});
