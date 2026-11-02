import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLyrics,inpaintingPlan,ElevenMusic} from '../dist/index.js';
const plan={customProperty:{keep:true},chunks:[{text:'[Verse]\nOriginal words',durationMs:4000,positiveStyles:['piano','quiet'],negativeStyles:['drums'],contextAdherence:'high',custom:123},{text:'[Chorus]\nOriginal chorus',durationMs:6000,positiveStyles:['strings'],conditionStrength:'high'}]};
const version={id:'local',version:1,name:'Test',songId:'original-song',plan,audioId:'audio',audioType:'audio/wav',audioVersion:1,operation:'analyze',createdAt:new Date().toISOString()};
test('lyric edits preserve every non-text composition property and untouched chunks',()=>{
 const next=applyLyrics(plan,[{index:0,lyrics:'Brand new words'}]);
 assert.equal(next.chunks[0].text,'[Verse]\nBrand new words');
 assert.deepEqual({...next.chunks[0],text:plan.chunks[0].text},plan.chunks[0]);
 assert.deepEqual(next.chunks[1],plan.chunks[1]);assert.deepEqual(next.customProperty,plan.customProperty);
 assert.equal(plan.chunks[0].text,'[Verse]\nOriginal words');
 assert.throws(()=>applyLyrics(plan,[{index:8,lyrics:'x'}]));
});
test('selective inpainting keeps exact original ranges and selected properties',()=>{
 const request=inpaintingPlan(version,[1]);
 assert.deepEqual(request.chunks[0],{songId:'original-song',range:{startMs:0,endMs:4000}});
 assert.deepEqual(request.chunks[1],plan.chunks[1]);
 const first=inpaintingPlan(version,[0]);assert.deepEqual(first.chunks[1],{songId:'original-song',range:{startMs:4000,endMs:10000}});
 assert.throws(()=>inpaintingPlan(version,[0,0]));
});
test('SDK lyric generation ignores provider attempts to alter musical properties',async()=>{
 const api=new ElevenMusic('fixture-key',{fetch:async()=>globalThis.Response.json({chunks:[{text:'[Changed]\nNew verse',duration_ms:3000,positive_styles:['metal']},{text:'[Chorus]\nOther lyrics',duration_ms:3000,positive_styles:['loud']}]})});
 const result=await api.lyrics(plan,'about a sunny day',[0]);
 assert.equal(result.chunks[0].text,'[Verse]\nNew verse');
 assert.deepEqual({...result.chunks[0],text:plan.chunks[0].text},plan.chunks[0]);assert.deepEqual(result.chunks[1],plan.chunks[1]);
});
