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
test('selective inpainting preserves untouched audio and forces xhigh original conditioning',()=>{
 const request=inpaintingPlan(version,[1]);
 assert.deepEqual(request.chunks[0],{songId:'original-song',range:{startMs:0,endMs:4000}});
 assert.deepEqual(request.chunks[1],{...plan.chunks[1],conditioningRef:{songId:'original-song',range:{startMs:4000,endMs:10000}},conditionStrength:'xhigh'});
 const first=inpaintingPlan(version,[0]);assert.deepEqual(first.chunks[1],{songId:'original-song',range:{startMs:4000,endMs:10000}});
 assert.throws(()=>inpaintingPlan(version,[0,0]));
});
test('all-chunk retries stay anchored to the upload and cap references at 30 seconds',()=>{
 const input={...version,songId:'generated-song',originalSongId:'uploaded-song',plan:{chunks:[
  {...plan.chunks[0],durationMs:45000,conditioningRef:{songId:'wrong-song',range:{startMs:0,endMs:4000}},conditionStrength:'low'},
  {...plan.chunks[1],durationMs:30000},
 ]}};
 const before=globalThis.structuredClone(input);
 const request=inpaintingPlan(input,[0,1]);
 assert.deepEqual(request.chunks.map(chunk=>chunk.conditioningRef),[
  {songId:'uploaded-song',range:{startMs:0,endMs:30000}},
  {songId:'uploaded-song',range:{startMs:45000,endMs:75000}},
 ]);
 assert.deepEqual(request.chunks.map(chunk=>chunk.conditionStrength),['xhigh','xhigh']);
 assert.deepEqual(request.chunks.map(chunk=>chunk.durationMs),[45000,30000]);
 assert.deepEqual(input,before);
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
  requests++;assert.match(String(url),/music\/upload/);assert.equal(options.body.get('extract_composition_plan'),'music_v2_5');assert.equal(options.body.get('with_timestamps'),'true');assert.equal(options.body.get('with_waveform_visual'),'true');assert.equal(options.body.get('file').type,'audio/wav');assert.deepEqual(Buffer.from(await options.body.get('file').arrayBuffer()),wav());
  return globalThis.Response.json({song_id:'uploaded-song',words_timestamps:[],waveform_visual:[-50,100,0],composition_plan:{chunks:[{text:'[Verse]',duration_ms:8000,positive_styles:['piano']}]}});
 }});
 const result=await api.analyze(wav(),'original.wav');assert.equal(result.songId,'uploaded-song');assert.equal(result.plan.chunks[0].durationMs,8000);assert.equal(requests,1);assert.deepEqual(result.audioMetadata,{wordsTimestamps:[],waveformVisual:[-50,100,0]});
});
test('actual SDK multipart parsing retains song IDs and binary MP3; inpainting references old ranges',async()=>{
 let request;
 const audio=Buffer.from([73,68,51,0,255,128,13,10,0]);
 const wire={words_timestamps:[{word:'New',start_ms:120,end_ms:500}],waveform_visual:[-900,600,0],composition_plan:{chunks:[{text:'[Verse]\nNew words',duration_ms:4000,positive_styles:['piano']},{song_id:'original-song',range:{start_ms:4000,end_ms:10000}}]}};
 const api=new ElevenMusic('fixture-key',{fetch:async(_url,options)=>{
  request=JSON.parse(options.body);
  return new globalThis.Response(Buffer.concat([Buffer.from('--fixture\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify(wire)+'\r\n--fixture\r\nContent-Type: audio/mpeg\r\nContent-Disposition: attachment; filename="song.mp3"\r\n\r\n'),audio,Buffer.from('\r\n--fixture--\r\n')]),{headers:{'content-type':'multipart/mixed; boundary=fixture','song-id':'new-song'}});
 }});
 const result=await api.generate(version,[0]);
 assert.equal(request.model_id,'music_v2_5');assert.equal(request.store_for_inpainting,true);assert.equal(request.with_timestamps,true);assert.equal(request.with_waveform_visual,true);assert.deepEqual(result.audioMetadata,{wordsTimestamps:[{word:'New',startMs:120,endMs:500}],waveformVisual:[-900,600,0]});assert.deepEqual(request.composition_plan.chunks[1],{song_id:'original-song',range:{start_ms:4000,end_ms:10000}});
 assert.equal(request.composition_plan.chunks[0].condition_strength,'xhigh');
 assert.deepEqual(request.composition_plan.chunks[0].conditioning_ref,{song_id:'original-song',range:{start_ms:0,end_ms:4000}});
 assert.equal(result.songId,'new-song');assert.deepEqual(Buffer.from(result.audio),audio);assert.deepEqual(result.plan.chunks[1],plan.chunks[1]);assert.equal(result.plan.chunks[0].text,'[Verse]\nNew words');
 await api.generate({...version,songId:result.songId,originalSongId:version.songId,plan:result.plan},[0]);
 assert.equal(request.composition_plan.chunks[0].condition_strength,'xhigh');
 assert.deepEqual(request.composition_plan.chunks[0].conditioning_ref,{song_id:'original-song',range:{start_ms:0,end_ms:4000}});
 assert.equal(request.composition_plan.chunks[1].song_id,'new-song');
});
test('WAV validation accepts metadata and rejects truncated or compressed files',async()=>{
 const {validateWav}=await import('../dist/index.js');const {wav}=await import('./fixtures.mjs');const bytes=wav();assert.equal(validateWav(bytes).durationMs,8000);
 const metadata=Buffer.concat([bytes.subarray(0,36),Buffer.from('JUNK\x02\0\0\0hi'),bytes.subarray(36)]);metadata.writeUInt32LE(metadata.length-8,4);assert.equal(validateWav(metadata).durationMs,8000);
 assert.throws(()=>validateWav(bytes.subarray(0,bytes.length-1)),/complete/);const layout=Buffer.from(bytes);layout.writeUInt32LE(1,28);assert.throws(()=>validateWav(layout),/layout/);const compressed=Buffer.from(bytes);compressed.writeUInt16LE(6,20);assert.throws(()=>validateWav(compressed),/uncompressed/);
});

test('extensible PCM WAVs retain compatibility with desktop audio exports',async()=>{
 const {validateWav}=await import('../dist/index.js');const {wav}=await import('./fixtures.mjs');const bytes=wav();
 const format=Buffer.alloc(48);format.write('fmt ');format.writeUInt32LE(40,4);bytes.copy(format,8,20,36);format.writeUInt16LE(65534,8);format.writeUInt16LE(22,24);format.writeUInt16LE(16,26);format.writeUInt32LE(4,28);Buffer.from('0100000000001000800000aa00389b71','hex').copy(format,32);
 const extended=Buffer.concat([bytes.subarray(0,12),format,bytes.subarray(36)]);extended.writeUInt32LE(extended.length-8,4);assert.equal(validateWav(extended).durationMs,8000);
 format.writeUInt32LE(6,32);const compressed=Buffer.concat([extended.subarray(0,12),format,bytes.subarray(36)]);assert.throws(()=>validateWav(compressed),/uncompressed/);
});
test('manual lyric edits work without constructing a credentialed provider',async()=>{
 const {performMusicAction}=await import('../dist/index.js');const next=await performMusicAction(()=>{throw new Error('Provider must not be called');},version,{operation:'edit',baseVersion:1,edits:[{index:0,lyrics:'New words'}]},'operation');assert.equal(next.version.version,2);assert.equal(next.version.audioVersion,1);
});

test('metadata follows audio through drafts, historical branches, and missing provider measurements',async()=>{
 const {performMusicAction,musicActionBase}=await import('../dist/index.js');
 const original={...version,audioMetadata:{wordsTimestamps:[{word:'Original',startMs:100,endMs:600}],waveformVisual:[1,2,3]}};
 const edit=await performMusicAction(()=>{throw new Error('No provider for drafts');},original,{operation:'edit',baseVersion:1,edits:[{index:0,lyrics:'Different words'}]},'edit');
 assert.deepEqual(edit.version.audioMetadata,original.audioMetadata);assert.equal(edit.version.audioVersion,1);
 const generated=await performMusicAction({generate:async()=>({songId:'new',plan,providerPlan:plan,audio:new Uint8Array([1])})},edit.version,{operation:'generate',baseVersion:2,indices:[0]},'generated');
 assert.equal(generated.version.audioMetadata,undefined,'Never label a new recording with old timings');
 const branch=musicActionBase(generated.version,original,{operation:'generate',baseVersion:3,sourceVersion:1,indices:[0]});
 assert.deepEqual(branch.audioMetadata,original.audioMetadata);assert.equal(branch.audioVersion,1);
});
