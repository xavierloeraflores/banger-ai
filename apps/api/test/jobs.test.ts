import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {db} from '../src/server/db';
import {createProject} from '../src/server/projects';
import {enqueue,claim,checkpoint} from '../src/server/jobs';
import {runElevenStep, boundedAudio} from '../src/server/elevenlabs';
const source=await readFile(new URL('../../../examples/night-drive.banger',import.meta.url),'utf8');
test('bounded audio reader rejects oversized provider results',async()=>{
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(12));controller.close();}});
  await assert.rejects(boundedAudio(stream,10),/exceeds/);
});
test('durable job idempotency, exclusive claims and fenced checkpoints', {skip:!process.env.DATABASE_URL},async t=>{
  const previousEleven=process.env.ELEVENLABS_API_KEY; delete process.env.ELEVENLABS_API_KEY;
  t.after(()=>{ if(previousEleven===undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY=previousEleven; });
  const store={async write(){},async text(){return source;}};
  const user=`test-${randomUUID()}`;
  const project=await createProject(user,'Jobs',[{path:'song.banger',source}],store);
  const key=randomUUID(),input={baseRevision:1,prompt:'Make drums softer',activeFile:'song.banger'};
  const first=await enqueue(user,project.projectId,'agent',key,input);
  const again=await enqueue(user,project.projectId,'agent',key,input);
  assert.equal(first.id,again.id);
  await assert.rejects(enqueue(user,project.projectId,'agent',key,{...input,prompt:'Other task'}),/different task/);
  const claims=await Promise.all([claim(first.id),claim(first.id)]);
  assert.equal(claims.filter(Boolean).length,1);
  const job=claims.find(Boolean)!;
  await checkpoint(job,'editing',25,{started:true});
  await assert.rejects(checkpoint(job,'completed',100,{},'completed'),/lease expired/);
  await db().query("UPDATE jobs SET available_at=now() WHERE id=$1",[job.id]);
  const resumed=await claim(job.id);
  assert.equal(resumed?.checkpoint.started,true);
  assert.notEqual(resumed?.lease_token,job.lease_token);
  await checkpoint(resumed!,'completed',100,{},'completed');
  assert.equal(await claim(job.id),undefined);
  const pending=await db().query("INSERT INTO jobs(id,project_id,user_id,kind,idempotency_key,input) VALUES($1,$2,$3,'elevenlabs',$4,$5) RETURNING id",[randomUUID(),project.projectId,user,randomUUID(),{artifactId:randomUUID()}]);
  const audioJob=await claim(pending.rows[0].id);
  await runElevenStep(audioJob!);
  const waiting=(await db().query('SELECT status,progress FROM jobs WHERE id=$1',[audioJob!.id])).rows[0];
  assert.equal(waiting.status,'awaiting_provider');assert.equal(waiting.progress,0);
  assert.equal(await claim(audioJob!.id),undefined);
  // A request using a personal key must never fall back to the server account.
  const byok=await db().query("INSERT INTO jobs(id,project_id,user_id,kind,idempotency_key,input) VALUES($1,$2,$3,'elevenlabs',$4,$5) RETURNING id",[randomUUID(),project.projectId,user,randomUUID(),{artifactId:randomUUID(),clientKeyRequired:true}]);
  const byokJob=(await claim(byok.rows[0].id))!;
  const previous=process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY='server-key-must-not-be-used';
  try { await runElevenStep(byokJob); }
  finally { if(previous===undefined)delete process.env.ELEVENLABS_API_KEY;else process.env.ELEVENLABS_API_KEY=previous; }
  const byokWaiting=(await db().query('SELECT status,error,input FROM jobs WHERE id=$1',[byokJob.id])).rows[0];
  assert.equal(byokWaiting.status,'awaiting_provider');
  assert.match(byokWaiting.error,/Settings/);
  assert.equal(JSON.stringify(byokWaiting).includes('server-key-must-not-be-used'),false);

});
after(async()=>{await db().end();});
