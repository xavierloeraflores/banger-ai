import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artworkContext, generateRecordArtwork, validateArtwork } from '../dist/index.js';

test('Wonder directs one square Muse Image cover using all song context', async () => {
  const calls = [];
  const artwork = await generateRecordArtwork({ name: 'Night record', prompt: 'A hopeful dawn', source: 'tempo 90;', lyrics: 'We wake together' }, { provider: 'meta', key: 'fixture' }, async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body });
    if (url.endsWith('/chat/completions')) return Response.json({ id: 'brief', object: 'chat.completion', created: 1, model: 'muse-wonder-1.0', choices: [{ index: 0, message: { role: 'assistant', content: 'A sunrise over an empty blue city.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] });
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.model, 'muse-wonder-1.0');
  for (const text of ['A hopeful dawn', 'tempo 90;', 'We wake together']) assert.ok(JSON.stringify(calls[0].body.messages).includes(text));
  assert.equal(calls[1].body.model, 'muse-image-1.0');
  assert.equal(calls[1].body.size, '1024x1024');
  assert.equal(calls[1].body.n, 1);
  assert.equal(artwork, 'data:image/png;base64,aW1hZ2U=');
});
test('record context and artwork are bounded and external or active image content is rejected', () => {
  assert.equal(artworkContext({name:'x'.repeat(200),prompt:'x'.repeat(20000)}).prompt.length,16000);
  for (const value of ['https://example.com/cover.png','data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,'+'a'.repeat(8*1024*1024)]) assert.throws(()=>validateArtwork(value));
});

test('Vercel routes Wonder and one square image through the configured key', async () => {
  const calls=[];
  // A valid PNG header lets the SDK detect the returned media type.
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1sAAAAASUVORK5CYII=';
  const result=await generateRecordArtwork({name:'Record'},{provider:'vercel',key:'fixture'},async(url,init)=>{
    const body=JSON.parse(init.body);calls.push({url,body,headers:init.headers});
    if(url.endsWith('/language-model'))return Response.json({content:[{type:'text',text:'A blue sunrise'}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1},outputTokens:{total:1}},warnings:[]});
    return Response.json({images:[png]});
  });
  assert.equal(calls.length,2);
  assert.equal(new Headers(calls[0].headers).get('ai-language-model-id'),'meta/muse-wonder-1.0');
  assert.equal(new Headers(calls[1].headers).get('ai-model-id'),'meta/muse-image-1.0');
  assert.equal(calls[1].body.n,1);assert.equal(calls[1].body.size,'1024x1024');
  assert.match(result,/^data:image\/png;base64,/);
});
