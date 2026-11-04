import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { projectRecord, createLibraryRecords } from '../dist/library-records.js';
import { createSongLibrary } from '../dist/song-library.js';
import { createSongStorage } from '../dist/song-storage.js';
import { wav } from '../../../packages/elevenlabs/test/fixtures.mjs';

test('concurrent nested songs keep one record and one asynchronous cover across restart and rename', async t => {
  const root = await mkdtemp(join(tmpdir(),'banger-records-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const project = join(root,'project'); await mkdir(project);
  const identities = await Promise.all(Array.from({length:8},()=>projectRecord(project,'The first creative prompt')));
  assert.equal(new Set(identities.map(item=>item.id)).size,1); assert.equal(identities[0].id.length,36);
  await projectRecord(project,'A later edit');
  let finish, calls = 0, context;
  const gate = new Promise(resolve=>{finish=resolve;});
  const records = createLibraryRecords(root, async value => { calls++; context=value; return gate; });
  const storage = createSongStorage(root,records), library = createSongLibrary(root,records);
  const first=await storage.prepare(project,'one/song.banger','tempo 90;');
  const second=await storage.prepare(project,'two/song.banger','tempo 100;');
  await Promise.all([storage.addToLibrary(first,wav(),'tempo 90;',{lyrics:'First words'}),storage.addToLibrary(second,wav(),'tempo 100;')]);
  const before = await library.list();
  assert.equal(before.length,2); assert.equal(new Set(before.map(song=>song.recordId)).size,1); assert.ok(before.every(song=>!song.artwork));
  assert.equal(calls,1); assert.equal(context.prompt,'The first creative prompt');
  finish('data:image/png;base64,aW1hZ2U='); await records.settled();
  const after = await createSongLibrary(root).list(); assert.ok(after.every(song=>song.artwork==='data:image/png;base64,aW1hZ2U='));
  assert.deepEqual((await library.read(before[0].id)).bytes,wav());
  await rename(project,join(root,'renamed')); assert.equal((await projectRecord(join(root,'renamed'))).id,identities[0].id);
  await mkdir(join(root,'another')); assert.notEqual((await projectRecord(join(root,'another'))).id,identities[0].id);
});
test('artwork failures do not block songs and generation retries and IDs are capped',async t=>{
  const root=await mkdtemp(join(tmpdir(),'banger-record-retry-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const identity=await projectRecord(root);let calls=0;
  const records=createLibraryRecords(root,async()=>{calls++;throw new Error('Provider unavailable');});
  await records.ensure(identity,{name:'Record'});await records.settled();
  for(let i=0;i<6;i++){await records.get(identity.id);await records.settled();}
  assert.equal(calls,3);assert.equal((await records.get(identity.id)).artwork,undefined);
  await assert.rejects(records.get('../outside'),/Invalid record ID/);
  await writeFile(join(root,'.banger','record.json'),JSON.stringify({id:'a'.repeat(10000),name:'bad'}));
  await assert.rejects(projectRecord(root),/Invalid record metadata/);
});

test('record edits persist through generation, keep the old cover, and reject duplicate regeneration', async t => {
  const root = await mkdtemp(join(tmpdir(),'banger-record-options-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const identity = await projectRecord(root);
  const old = 'data:image/png;base64,b2xk', replacement = 'data:image/png;base64,bmV3';
  let resolve, calls = 0;
  const records = createLibraryRecords(root, async () => ++calls === 1 ? old : new Promise(done => { resolve = done; }));
  await records.ensure(identity,{name:'Initial'}); await records.settled();
  await records.rename(identity.id,'  Renamed  ');
  await records.regenerate(identity.id);
  for(let i=0;i<100 && !resolve;i++)await new Promise(done=>setTimeout(done,5));
  await assert.rejects(records.regenerate(identity.id), /already/);
  assert.equal((await records.get(identity.id)).artwork,old);
  await records.rename(identity.id,'Changed while generating');
  resolve(replacement); await records.settled();
  const saved = await createLibraryRecords(root).get(identity.id);
  assert.equal(saved.name,'Changed while generating'); assert.equal(saved.artwork,replacement); assert.equal(saved.regenerating,false); assert.equal(calls,2);
  for(const name of ['', ' '.repeat(10), 'x'.repeat(161)]) await assert.rejects(records.rename(identity.id,name),/name/);
  const noKey = createLibraryRecords(root,async()=>undefined,async()=>false);
  await assert.rejects(noKey.regenerate(identity.id),/key/);
  assert.equal((await noKey.get(identity.id)).artwork,replacement);
  const failing = createLibraryRecords(root,async()=>{throw new Error('provider');});
  await failing.regenerate(identity.id); await failing.settled();
  for(let i=0;i<4;i++){await failing.get(identity.id);await failing.settled();}
  assert.equal((await failing.get(identity.id)).artwork,replacement);
  assert.equal((await failing.get(identity.id)).attempts,3);
});
