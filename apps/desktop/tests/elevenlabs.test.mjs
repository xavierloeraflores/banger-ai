import {Buffer} from 'node:buffer';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMusicStore} from '../dist/elevenlabs-music.js';
import {MusicProviderError} from '@banger/elevenlabs';
import {fixtureProvider,fixturePlan,wav} from '../../../packages/elevenlabs/test/fixtures.mjs';
const done=async(store,id)=>{for(let i=0;i<100;i++){const op=await store.operation(id);if(!['queued','running'].includes(op.status))return op;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Operation timed out');};
test('desktop upload, lyric edit, AI lyrics, generation, selected regeneration and persisted download',async()=>{
 const root=await mkdtemp(join(tmpdir(),'banger-music-'));const provider=fixtureProvider();let store=createMusicStore(root,()=>provider);
 const generateAudio=provider.generate;provider.generate=async version=>{assert.equal(version.originalSongId,'original-song');return generateAudio(version);};
 try{
  const upload=await store.importWav(wav(),'song.wav',randomUUID());assert.equal((await done(store,upload.id)).status,'completed');
  let song=await store.get(upload.musicId);assert.deepEqual(song.plan,fixturePlan);assert.deepEqual(Buffer.from((await store.audio(song.id)).bytes),wav());
  const input={operation:'edit',baseVersion:1,edits:[{index:0,lyrics:'Our own lyrics'}]},key=randomUUID();
  const edit=await store.act(song.id,input,key);assert.equal((await done(store,edit.id)).status,'completed');song=await store.get(song.id);
  assert.equal(song.version,2);assert.equal(song.audioVersion,1);assert.deepEqual({...song.plan.chunks[0],text:fixturePlan.chunks[0].text},fixturePlan.chunks[0]);assert.equal(provider.calls.generate,0);
  assert.equal((await store.act(song.id,input,key)).id,edit.id);await assert.rejects(store.act(song.id,{...input,baseVersion:2},key),/different task/);
  await assert.rejects(store.act(song.id,input,randomUUID()),/changed/);
  const lyrics=await store.act(song.id,{operation:'lyrics',baseVersion:2,indices:[1],prompt:'hope'},randomUUID());assert.equal((await done(store,lyrics.id)).status,'completed');
  const generate=await store.act(song.id,{operation:'generate',baseVersion:3,indices:[0,1]},randomUUID());assert.equal((await done(store,generate.id)).status,'completed');
  // Existing songs predate originalSongId; recover their upload reference from version 1.
  const legacy=await store.get(song.id);delete legacy.originalSongId;await writeFile(join(root,`music-${song.id}.json`),JSON.stringify(legacy));
  const regen=await store.act(song.id,{operation:'generate',baseVersion:4,indices:[1]},randomUUID());assert.equal((await done(store,regen.id)).status,'completed');
  store=createMusicStore(root,()=>provider);song=await store.get(song.id);assert.equal(song.version,5);assert.equal(song.audioVersion,5);assert.equal(song.songId,'generated-2');assert.equal((await store.list())[0].version,5);
  assert.equal(song.originalSongId,'original-song');
  assert.deepEqual(Buffer.from((await store.audio(song.id)).bytes),Buffer.from('ID3fixture-audio'));assert.deepEqual(Buffer.from((await store.audio(song.id,1)).bytes),wav());
  assert.deepEqual(provider.calls,{analyze:1,lyrics:1,generate:2});
  // Simulate interruption after the durable result and pointer, before job completion/catalog.
  const path=join(root,`operation-${regen.id}.json`),record=JSON.parse(await readFile(path,'utf8'));record.status='running';await writeFile(path,JSON.stringify(record));await writeFile(join(root,'catalog.json'),'[]');
  assert.equal((await store.recover(regen.id)).status,'completed');assert.equal((await store.list())[0].version,5);assert.equal(provider.calls.generate,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('interrupted paid requests are retained for review and never repeated by recovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'banger-music-'));let calls=0;const provider={...fixtureProvider(),async analyze(){calls++;throw new MusicProviderError('Response lost',true);}};
 try{const store=createMusicStore(root,()=>provider),key=randomUUID();const job=await store.importWav(wav(),'song.wav',key);assert.equal((await done(store,job.id)).status,'needs_review');assert.equal((await store.recover(job.id)).status,'needs_review');await store.importWav(wav(),'song.wav',key);assert.equal(calls,1);await assert.rejects(store.importWav(wav(),'different.wav',key),/different task/);assert.deepEqual(await store.list(),[]);}
 finally{await rm(root,{recursive:true,force:true});}
});

test('history keeps original audio and branches selected versions behind the current revision fence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'banger-music-history-'));const provider=fixtureProvider();let generatedBase;
 const originalGenerate=provider.generate;provider.generate=async version=>{generatedBase=version;return originalGenerate(version);};
 const store=createMusicStore(root,()=>provider);
 try{
  const upload=await store.importWav(wav(),'original.wav',randomUUID());await done(store,upload.id);const id=upload.musicId;
  const edit=await store.act(id,{operation:'edit',baseVersion:1,edits:[{index:0,lyrics:'Changed'}]},randomUUID());await done(store,edit.id);
  const generation=await store.act(id,{operation:'generate',baseVersion:2,indices:[0,1]},randomUUID());await done(store,generation.id);
  const branch=await store.act(id,{operation:'generate',baseVersion:3,sourceVersion:1,indices:[1]},randomUUID());await done(store,branch.id);
  assert.equal(generatedBase.songId,'original-song');assert.deepEqual(generatedBase.plan,fixturePlan);assert.equal((await store.get(id)).parentVersion,1);
  const history=await store.versions(id);assert.deepEqual(history.versions.map(item=>item.version),[4,3,2,1]);assert.equal(history.original.audioType,'audio/wav');
  assert.deepEqual((await store.versions(id,3)).versions.map(item=>item.version),[2,1]);assert.deepEqual(Buffer.from((await store.audio(id,1)).bytes),wav());
  await assert.rejects(store.act(id,{operation:'generate',baseVersion:3,sourceVersion:1,indices:[0]},randomUUID()),/changed/);
  await assert.rejects(store.act(id,{operation:'generate',baseVersion:4,sourceVersion:999,indices:[0]},randomUUID()));
 }finally{await rm(root,{recursive:true,force:true});}
});
