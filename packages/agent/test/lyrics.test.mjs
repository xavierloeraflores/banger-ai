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
