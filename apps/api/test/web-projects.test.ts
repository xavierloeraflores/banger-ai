import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { selectModel } from '@banger/agent';
import { createProject, projectFiles, saveChanges } from '../src/server/projects';
import { runWebTask } from '../src/server/web-task';
import { readSongDraft, saveSongDraft } from '../src/server/song-drafts';
import { db } from '../src/server/db';

const source = 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain .6; }';
const credentials = { provider: 'openai' as const, model: 'fixture', key: 'not-a-real-key' };
function model(tool: string, args: unknown, before?: () => Promise<void>, inspect?: (body: string) => void) {
  let calls = 0;
  return selectModel(credentials, async (_url, init) => {
    inspect?.(String(init?.body));
    if (!calls && before) await before();
    const action = calls++ === 0;
    return Response.json({ id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message: action ? { role: 'assistant', content: null, tool_calls: [{ id: `call_${calls}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: 'Fixture task finished.' }, finish_reason: action ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
}
test('account projects persist without Blob, run desktop file tools and preserve conflicting edits', { skip: !process.env.DATABASE_URL }, async t => {
  t.after(() => db().end());
  const user = `projects-${randomUUID()}`;
  const created = await createProject(user, 'Web project', [{ path: 'song.banger', source }]);
  const project = created.projectId;
  assert.equal((await projectFiles(user, project)).files[0]?.source, source);
  await assert.rejects(projectFiles('stranger', project), /access denied/);
  const thread = randomUUID();
  const input = { thread, baseRevision: 1, prompt: 'Change only the tempo', activeFile: 'song.banger', credentials };
  const changed = await runWebTask(user, project, input, new AbortController().signal, model('edit_file', { path: 'song.banger', search: 'tempo 120', replacement: 'tempo 124' }));
  assert.equal(changed.reply.status, 'completed');
  assert.deepEqual(changed.reply.changedPaths, ['song.banger']);
  assert.equal((await projectFiles(user, project)).files[0]?.source, source.replace('120', '124'));
  assert.ok(changed.events.some(event => event.type === 'file-changed'));
  let sawHistory = false;
  const draft = { schemaVersion: 1, lyrics: 'Keep the light\nThrough the night', vocalStyle: 'Warm alto' };
  const lyric = await runWebTask(user, project, { ...input, baseRevision: 2, prompt: 'Write draft lyrics', permissions: { beat: false, lyrics: true } }, new AbortController().signal, model('write_draft', { path: 'song.draft.json', source: JSON.stringify(draft) }, undefined, body => { sawHistory ||= body.includes('Fixture task finished.'); }));
  assert.equal(lyric.reply.status, 'completed');
  assert.equal(sawHistory, true);
  assert.deepEqual(await readSongDraft(user, project, 'song.banger'), draft);
  await assert.rejects(saveSongDraft(user, project, 'song.banger', { ...draft, lyrics: 'stale' }, null), /draft changed/);
  const musicId=randomUUID(),artifact=randomUUID();
  const document={id:musicId,studioPath:'song.banger',version:1,name:'Song',songId:'original',plan:{chunks:[{text:'[Verse]\nKeep the light',durationMs:4000,positiveStyles:['piano']}]},audioId:artifact,audioType:'audio/wav',audioVersion:1,createdAt:new Date().toISOString(),operation:'analyze'};
  await db().query("INSERT INTO artifacts(id,project_id,revision,user_id,kind,pathname,content_type,size,status) VALUES($1,$2,2,$3,'wav',$4,'audio/wav',7,'ready')",[artifact,project,user,`fixture/${artifact}`]);
  await db().query('INSERT INTO music_sessions(id,project_id,source_artifact_id,revision,current_version) VALUES($1,$2,$3,1,$4)',[musicId,project,artifact,document]);
  await db().query('INSERT INTO music_versions(music_id,revision,document_path,document) VALUES($1,1,$2,$3)',[musicId,`fixture/${musicId}`,document]);
  for(const [index,style] of ['Breathy alto',undefined,''].entries()) {
    const current=(await db().query('SELECT current_version FROM music_sessions WHERE id=$1',[musicId])).rows[0].current_version;
    const proposed=structuredClone(current);
    if(style===undefined){delete proposed.plan.chunks[0].vocalStyle;proposed.plan.chunks[0].text='[Verse]\nThrough the night';}
    else proposed.plan.chunks[0].vocalStyle=style;
    let step=0;
    const selected=selectModel(credentials,async()=>{
      const tool=step++===0?{name:'read_lyrics',arguments:JSON.stringify({path:'song.lyric.json'})}:step===2?{name:'write_lyrics',arguments:JSON.stringify({path:'song.lyric.json',source:JSON.stringify(proposed)})}:null;
      return Response.json({id:'fixture',object:'chat.completion',created:1,model:'fixture',choices:[{index:0,message:tool?{role:'assistant',content:null,tool_calls:[{id:`call_${step}`,type:'function',function:tool}]}:{role:'assistant',content:'Saved.'},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
    });
    const result=await runWebTask(user,project,{...input,thread:randomUUID(),baseRevision:2,prompt:'Edit the requested lyrics or vocal style',permissions:{beat:false,lyrics:true}},new AbortController().signal,selected);
    assert.equal(result.reply.status,'completed');
    const saved=(await db().query('SELECT current_version FROM music_sessions WHERE id=$1',[musicId])).rows[0].current_version;
    assert.equal(saved.version,index+2);assert.equal(saved.audioId,artifact);
    assert.equal(saved.plan.chunks[0].vocalStyle,index===2?undefined:'Breathy alto');
    assert.deepEqual(saved.plan.chunks[0].positiveStyles,['piano']);
  }
  const other = await createProject(user, 'Other project', [{ path: 'song.banger', source }]);
  assert.equal(await readSongDraft(user, other.projectId, 'song.banger'), null);
  const conflict = await runWebTask(user, project, { ...input, thread: randomUUID(), baseRevision: 2 }, new AbortController().signal, model('edit_file', { path: 'song.banger', search: 'tempo 124', replacement: 'tempo 128' }, async () => { await saveChanges(user, project, 2, [{ path: 'song.banger', source: source.replace('120', '130') }]); }));
  assert.equal(conflict.reply.status, 'incomplete');
  assert.deepEqual(conflict.reply.changedPaths, []);
  assert.equal((await projectFiles(user, project)).files[0]?.source, source.replace('120', '130'));
  const escaped = await runWebTask(user, project, { ...input, thread: randomUUID(), baseRevision: 3 }, new AbortController().signal, model('write_file', { path: '../escape.banger', source }));
  assert.equal(escaped.reply.status, 'incomplete');
  assert.deepEqual(escaped.reply.changedPaths, []);
  assert.equal((await projectFiles(user, project)).files.length, 1);
  const cancellation = new AbortController();
  const stopped = await runWebTask(user, project, { ...input, thread: randomUUID(), baseRevision: 3 }, cancellation.signal, model('edit_file', {path:'song.banger',search:'tempo 130',replacement:'tempo 132'}), event => { if(event.type==='tool-result'&&event.ok)cancellation.abort(); });
  assert.equal(stopped.reply.status,'incomplete');
  assert.deepEqual(stopped.reply.changedPaths,['song.banger']);
  assert.equal((await projectFiles(user,project)).files[0]?.source,source.replace('120','132'));

});
