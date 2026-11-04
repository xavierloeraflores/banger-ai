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
 const styledVersion={...version,plan:applyLyrics(plan,[{index:0,vocalStyle:'Warm alto'}])};
 const result=await api.generate(styledVersion,[0]);
 assert.deepEqual(request.composition_plan.chunks[0].positive_styles,['piano','quiet','Warm alto']);
 assert.equal(request.composition_plan.chunks[0].vocal_style,undefined);
 assert.equal(result.plan.chunks[0].vocalStyle,'Warm alto');
 assert.deepEqual(result.plan.chunks[0].positiveStyles,['piano','quiet']);
 assert.equal(request.model_id,'music_v2_5');assert.equal(request.store_for_inpainting,true);assert.equal(request.with_timestamps,true);assert.equal(request.with_waveform_visual,true);assert.deepEqual(result.audioMetadata,{wordsTimestamps:[{word:'New',startMs:120,endMs:500}],waveformVisual:[-900,600,0]});assert.deepEqual(request.composition_plan.chunks[1],{song_id:'original-song',range:{start_ms:4000,end_ms:10000}});
 assert.equal(request.composition_plan.chunks[0].condition_strength,'xhigh');
 assert.deepEqual(request.composition_plan.chunks[0].conditioning_ref,{song_id:'original-song',range:{start_ms:0,end_ms:4000}});
 assert.equal(result.songId,'new-song');assert.deepEqual(Buffer.from(result.audio),audio);assert.deepEqual(result.plan.chunks[1],plan.chunks[1]);assert.equal(result.plan.chunks[0].text,'[Verse]\nNew words');
 await api.generate({...version,songId:result.songId,originalSongId:version.songId,plan:result.plan},[0]);
 assert.equal(request.composition_plan.chunks[0].condition_strength,'xhigh');
 assert.deepEqual(request.composition_plan.chunks[0].conditioning_ref,{song_id:'original-song',range:{start_ms:0,end_ms:4000}});
 assert.equal(request.composition_plan.chunks[1].song_id,'new-song');
 assert.deepEqual(request.composition_plan.chunks[0].positive_styles,['piano','quiet','Warm alto']);
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

test('vocal descriptions are replaceable metadata and project into applicable provider chunks only', async()=>{
 const {performMusicAction,musicActionSchema,vocalStyleEdits}=await import('../dist/index.js');
 const original={...plan,chunks:plan.chunks.map(chunk=>({...chunk,text:chunk.text+'\n{intimate}'}))};
 const styled=applyLyrics(original,[{index:0,vocalStyle:'Warm, breathy alto'}]);
 assert.deepEqual(styled.chunks[0],{...original.chunks[0],vocalStyle:'Warm, breathy alto'});
 assert.deepEqual(styled.chunks[1],original.chunks[1]);
 let next=await performMusicAction(()=>{throw new Error('No paid requests');},{...version,plan:styled},musicActionSchema.parse({operation:'edit',baseVersion:1,edits:[{index:0,vocalStyle:'Restrained vibrato'}]}),'style');
 assert.equal(next.version.audioId,version.audioId);
 assert.equal(next.version.version,2);
 assert.deepEqual(next.version.plan.chunks[0].positiveStyles,plan.chunks[0].positiveStyles);
 const request=inpaintingPlan(next.version,[0]);
 assert.deepEqual(request.chunks[0].positiveStyles,['piano','quiet','Restrained vibrato']);
 assert.equal('vocalStyle' in request.chunks[0],false);
 assert.equal(request.chunks[0].text,original.chunks[0].text);
 assert.equal(request.chunks[0].conditionStrength,'xhigh');
 assert.deepEqual(request.chunks[1],{songId:version.songId,range:{startMs:4000,endMs:10000}});
 assert.equal(applyLyrics(next.version.plan,[{index:0,lyrics:'New words'}]).chunks[0].vocalStyle,'Restrained vibrato');
 const cleared=applyLyrics(next.version.plan,[{index:0,vocalStyle:''}]);
 assert.deepEqual(cleared,original);
 const same=applyLyrics(original,[{index:0,vocalStyle:'piano'}]);
 assert.deepEqual(inpaintingPlan({...version,plan:same},[0]).chunks[0].positiveStyles,['piano','quiet']);
 assert.deepEqual(applyLyrics(same,[{index:0,vocalStyle:''}]),original);
 assert.throws(()=>musicActionSchema.parse({operation:'edit',baseVersion:1,edits:[{index:0,vocalStyle:'x'.repeat(1001)}]}));
 assert.throws(()=>musicActionSchema.parse({operation:'edit',baseVersion:1,edits:[{index:0}]}));
 const split={chunks:[{...plan.chunks[0],durationMs:3000},{...plan.chunks[0],durationMs:3000},{...plan.chunks[0],durationMs:4000}]};
 assert.deepEqual(vocalStyleEdits(styled,split).map(edit=>edit.vocalStyle),['Warm, breathy alto','','']);
 const all=applyLyrics(original,[{index:0,vocalStyle:'alto'},{index:1,vocalStyle:'alto'}]);
 assert.deepEqual(vocalStyleEdits(all,split).map(edit=>edit.vocalStyle),['alto','alto','alto']);
});

test('SDK lyric proposals preserve descriptions and send them separately from sung words',async()=>{
 const styled=applyLyrics(plan,[{index:0,vocalStyle:'Breathy alto'}]);let request;
 const api=new ElevenMusic('fixture',{fetch:async(_url,options)=>{request=JSON.parse(options.body);return Response.json({chunks:plan.chunks.map(chunk=>({text:chunk.text,duration_ms:chunk.durationMs,positive_styles:['wrong']}))});}});
 const result=await api.lyrics(styled,'Change a word',[0]);
 assert.equal(result.chunks[0].vocalStyle,'Breathy alto');
 assert.deepEqual(result.chunks[0].positiveStyles,plan.chunks[0].positiveStyles);
 assert.deepEqual(request.source_composition_plan.chunks[0].positive_styles,['piano','quiet','Breathy alto']);
 assert.equal(request.source_composition_plan.chunks[0].text,plan.chunks[0].text);
});
