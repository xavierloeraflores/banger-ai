import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { ProjectSession, openProject } from '../dist/index.js';

const source='tempo 120; track kick { sound "drums/kick"; rhythm "x . x ."; }';
const response = (parts, reason='stop') => ({stream:new ReadableStream({start(output){
  for(const part of parts)output.enqueue(part);
  output.enqueue({type:'finish',finishReason:{unified:reason,raw:reason},usage:{inputTokens:{total:10},outputTokens:{total:10}}});
  output.close();
}})});
const edit = tempo => response([{type:'tool-call',toolCallId:'edit',toolName:'edit_file',input:JSON.stringify({path:'song.banger',search:'tempo 120;',replacement:`tempo ${tempo};`})}],'tool-calls');
const answer = text => response([{type:'text-start',id:'answer'},{type:'text-delta',id:'answer',delta:text},{type:'text-end',id:'answer'}]);

test('project streams report real reads, validation, repairs and saves with a new ID on each run', async t=>{
  const root=await mkdtemp(join(tmpdir(),'banger-stream-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'song.banger'),source);
  const events=[];
  const model=new MockLanguageModelV4({doStream:[edit(900),edit(95),answer('Saved the slower beat.'),answer('Second reply.')]});
  const session=new ProjectSession({workspace:await openProject(root),selected:{model,name:'fixture'},onEvent:event=>events.push(event)});
  const result=await session.run('Slow the beat',{activeFile:'song.banger',requestId:'first'});
  assert.equal(result.status,'completed');
  assert.match(await readFile(join(root,'song.banger'),'utf8'),/tempo 95/);
  assert.equal(events.filter(e=>e.type==='file-changed').length,1);
  assert.ok(events.some(e=>e.message==='Reading project context'));
  assert.ok(events.some(e=>e.message==='Requesting a repair for rejected output'));
  assert.ok(events.some(e=>e.message==='Validating saved changes'));
  assert.ok(events.some(e=>e.type==='text-delta'&&e.text==='Saved the slower beat.'));
  assert.ok(events.every(e=>e.requestId==='first'));
  const split=events.length;
  await session.run('What changed?',{requestId:'second'});
  assert.ok(events.slice(split).every(e=>e.requestId==='second'));
});
