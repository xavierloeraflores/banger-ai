import {Buffer} from 'node:buffer';
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

test('SDK upload sends multipart WAV and extracts the version 2.5 plan',async()=>{
 const {wav}=await import('./fixtures.mjs');let requests=0;
 const api=new ElevenMusic('fixture-key',{fetch:async(url,options)=>{
  requests++;assert.match(String(url),/music\/upload/);assert.equal(options.body.get('extract_composition_plan'),'music_v2_5');assert.equal(options.body.get('file').type,'audio/wav');assert.deepEqual(Buffer.from(await options.body.get('file').arrayBuffer()),wav());
  return globalThis.Response.json({song_id:'uploaded-song',composition_plan:{chunks:[{text:'[Verse]',duration_ms:8000,positive_styles:['piano']}]}});
 }});
 const result=await api.analyze(wav(),'original.wav');assert.equal(result.songId,'uploaded-song');assert.equal(result.plan.chunks[0].durationMs,8000);assert.equal(requests,1);
});
test('actual SDK multipart parsing retains song IDs and binary MP3; inpainting references old ranges',async()=>{
 let request;
 const audio=Buffer.from([73,68,51,0,255,128,13,10,0]);
 const wire={composition_plan:{chunks:[{text:'[Verse]\nNew words',duration_ms:4000,positive_styles:['piano']},{song_id:'original-song',range:{start_ms:4000,end_ms:10000}}]}};
 const api=new ElevenMusic('fixture-key',{fetch:async(_url,options)=>{
  request=JSON.parse(options.body);
  return new globalThis.Response(Buffer.concat([Buffer.from('--fixture\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify(wire)+'\r\n--fixture\r\nContent-Type: audio/mpeg\r\nContent-Disposition: attachment; filename="song.mp3"\r\n\r\n'),audio,Buffer.from('\r\n--fixture--\r\n')]),{headers:{'content-type':'multipart/mixed; boundary=fixture','song-id':'new-song'}});
 }});
 const result=await api.generate(version,[0]);
 assert.equal(request.model_id,'music_v2_5');assert.equal(request.store_for_inpainting,true);assert.deepEqual(request.composition_plan.chunks[1],{song_id:'original-song',range:{start_ms:4000,end_ms:10000}});
 assert.equal(result.songId,'new-song');assert.deepEqual(Buffer.from(result.audio),audio);assert.deepEqual(result.plan.chunks[1],plan.chunks[1]);assert.equal(result.plan.chunks[0].text,'[Verse]\nNew words');
});
test('WAV validation accepts metadata and rejects truncated or compressed files',async()=>{
 const {validateWav}=await import('../dist/index.js');const {wav}=await import('./fixtures.mjs');const bytes=wav();assert.equal(validateWav(bytes).durationMs,8000);
 const metadata=Buffer.concat([bytes.subarray(0,36),Buffer.from('JUNK\x02\0\0\0hi'),bytes.subarray(36)]);metadata.writeUInt32LE(metadata.length-8,4);assert.equal(validateWav(metadata).durationMs,8000);
 assert.throws(()=>validateWav(bytes.subarray(0,bytes.length-1)),/complete/);const compressed=Buffer.from(bytes);compressed.writeUInt16LE(6,20);assert.throws(()=>validateWav(compressed),/uncompressed/);
});
