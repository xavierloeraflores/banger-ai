import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import type { ChatEvent, ChatRequest } from '@banger/agent/protocol';
import type {} from '../../www/src/lib/ai-chat';
const request: ChatRequest = { messages: [{ role: 'user', content: 'Hello' }], previousFiles: [], currentFile: { name: 'song.banger', source: '' } };

const compiled = ts.transpileModule(await readFile(new URL('../src/app/web-chat.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup(fetch: typeof globalThis.fetch) {
  const exports = {} as { installWebChat(id: string): void }, window = {} as { bangerChat: NonNullable<Window["bangerChat"]> };
  vm.runInNewContext(compiled, { exports, window, fetch, AbortController, Set, Error, TextDecoder, JSON, require:()=>({browserCredentials:()=>({provider:'fixture',key:'test',model:'fixture'})}) });
  exports.installWebChat('account');
  return window.bangerChat;
}

test('hosted chat handles fragmented unicode events, ignores other requests and returns only the final reply', async () => {
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const bridge = setup(async (_url, options) => {
    assert.equal(new Headers(options?.headers).get("Accept"),'application/x-ndjson');
    return new Response(new ReadableStream({start(controller){output=controller;}}),{headers:{'Content-Type':'application/x-ndjson'}});
  });
  const events: ChatEvent[] = [];
  const unsubscribe = bridge.onEvent!(event=>events.push(event));
  const pending = bridge.send({...request,requestId:'one'});
  await Promise.resolve();
  const bytes = new TextEncoder().encode(JSON.stringify({event:{type:'text-delta',requestId:'other',text:'stale'}})+'\n'+JSON.stringify({event:{type:'text-delta',requestId:'one',text:'Música'}})+'\n');
  for (const byte of bytes) output.enqueue(Uint8Array.of(byte));
  output.enqueue(new TextEncoder().encode(JSON.stringify({result:{ok:true,reply:{text:'Música',files:[],model:'test'}}})+'\n'));
  output.close();
  const result = await pending;
  assert.ok(result.ok);
  assert.equal(result.reply.text,'Música');
  assert.equal(events.length,1);
  assert.ok(events[0]?.type === 'text-delta');
  assert.equal(events[0].text,'Música');
  unsubscribe();
});

test('cancellation is request-scoped and a truncated response cannot become a completed reply', async () => {
  let signal!: AbortSignal;
  const bridge=setup(async (_url, options)=>{ signal=options!.signal!; return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason))); });
  const pending=bridge.send({...request,requestId:'new'});
  await bridge.cancel('old');
  assert.equal(signal.aborted,false);
  await bridge.cancel('new');
  await assert.rejects(pending);
  const truncated=setup(async()=>new Response('{"event":{"requestId":"x","type":"text-delta","text":"Partial"}}\n',{headers:{'Content-Type':'application/x-ndjson'}}));
  await assert.rejects(truncated.send({...request,requestId:'x'}),/interrupted/);
});
