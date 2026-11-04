import assert from 'node:assert/strict';
import test from 'node:test';
import {MockLanguageModelV4} from 'ai/test';
import {generateLyrics} from '../dist/index.js';
const request={prompt:'A hopeful chorus',chunks:[{index:2,text:'[Chorus]\nOld words',durationMs:8000}]};
function modelFor(value){return new MockLanguageModelV4({doGenerate:{content:[{type:'text',text:JSON.stringify(value)}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:10},outputTokens:{total:10}},warnings:[]}});}
test('lyrics use the selected LLM and return only edits for requested chunks',async()=>{
 const edits=[{index:2,lyrics:'Tomorrow brings the light'}];
 const model=modelFor(edits);
 assert.deepEqual(await generateLyrics(request,{model}),edits);
 assert.ok(JSON.stringify(model.doGenerateCalls[0].prompt).includes('Old words'));
 assert.equal(model.doGenerateCalls.length,1);
});
test('lyrics reject extra, missing, duplicate and oversized chunk edits',async()=>{
 for(const edits of [[],[{index:0,lyrics:'wrong'}],[{index:2,lyrics:'one'},{index:2,lyrics:'two'}],[{index:2,lyrics:'x'.repeat(6001)}]])await assert.rejects(generateLyrics(request,{model:modelFor(edits)}));
 const model=modelFor([]);
 await assert.rejects(generateLyrics({...request,chunks:[...request.chunks,...request.chunks]},{model}));
 assert.equal(model.doGenerateCalls.length,0);
 const controller=new AbortController();controller.abort();
 await assert.rejects(generateLyrics(request,{model},controller.signal));
});

test('lyrics can be written before analysis without fabricated chunk timings', async()=>{
 const edits=[{index:0,lyrics:'[Verse]\nWe follow the morning'}];
 const model=modelFor(edits);
 assert.deepEqual(await generateLyrics({prompt:'Write a hopeful song',chunks:[]},{model}),edits);
 assert.match(JSON.stringify(model.doGenerateCalls[0].prompt),/Do not invent chunk timings/);
 await assert.rejects(generateLyrics({prompt:'Draft',chunks:[]},{model:modelFor([{index:1,lyrics:'Wrong index'}])}));
});

test('a targeted lyric edit retains untouched chunks and sends explicit scope instructions', async () => {
 const chunks=[{index:0,text:'[Verse]\nKeep this verse exactly',durationMs:8000},{index:1,text:'[Chorus]\nChange this word',durationMs:8000}];
 const edits=[{index:0,lyrics:'Keep this verse exactly'},{index:1,lyrics:'Change that word'}];
 const model=modelFor(edits);
 assert.deepEqual(await generateLyrics({prompt:'Only replace this with that in the chorus. Leave the verse alone.',chunks},{model}),edits);
 const system=model.doGenerateCalls[0].prompt.find(message=>message.role==='system').content;
 assert.match(system,/preserve all other lyrics exactly/);
 assert.match(system,/Return unchanged lyrics for untouched supplied indices/);
});

test('lyric agent can describe vocals without putting descriptions in sung lyrics',async()=>{
 const edits=[{index:2,lyrics:'Old words',vocalStyle:'Warm alto'}];
 const model=modelFor(edits);
 assert.deepEqual(await generateLyrics({...request,prompt:'Keep lyrics, use a warm alto',chunks:[{...request.chunks[0],vocalStyle:'Bright tenor'}]},{model}),edits);
 assert.match(JSON.stringify(model.doGenerateCalls[0].prompt),/Bright tenor/);
 assert.match(JSON.stringify(model.doGenerateCalls[0].prompt),/never in sung lyrics/);
 await assert.rejects(generateLyrics(request,{model:modelFor([{...edits[0],vocalStyle:'x'.repeat(1001)}])}));
});
