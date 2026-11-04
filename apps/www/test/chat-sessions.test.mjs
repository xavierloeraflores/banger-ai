import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const compiled = ts.transpileModule(await readFile(new URL('../src/lib/chat-sessions.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function sessions() {
  const values = new Map(); let account = 'one'; const exports = {};
  vm.runInNewContext(compiled, {exports, localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)}, require:()=>({browserStorageKey:key=>`${key}:${account}`})});
  return {...exports, values, account: value => { account = value; }};
}
const fixture = {id:'chat',title:'Make a beat',status:'running',blocksSwitch:true,snapshot:{source:'draft',appliedSource:'applied',savedSource:'saved',fileName:'song.banger',folder:{id:'project',name:'Project',paths:['song.banger']},workspaceFile:{path:'song.banger',source:'saved'},cloudBinding:{token:'secret'}},history:{prompt:'Make a beat',turns:[],permissions:{beat:true,lyrics:false},fullSend:false,targetFile:null}};
test('chat persistence scopes accounts, keeps drafts, excludes credentials, and marks interrupted runs', () => {
  const store = sessions(); store.writeChats([fixture]);
  assert.equal([...store.values.values()][0].includes('secret'), false);
  const [restored] = store.readChats();
  assert.equal(restored.snapshot.source, 'draft'); assert.equal(restored.snapshot.savedSource, 'saved');
  assert.equal(restored.status, 'error'); assert.equal(restored.blocksSwitch, false);
  assert.match(restored.history.error, /interrupted/);
  store.account('two'); assert.equal(store.readChats().length, 0);
  store.account('one'); assert.equal(store.readChats().length, 1);
});
test('malformed storage cannot crash chat rendering', () => {
  const store = sessions();
  store.values.set('banger.project-chats.v1:one','not json'); assert.equal(store.readChats().length, 0);
  store.values.set('banger.project-chats.v1:one',JSON.stringify([{...fixture,history:{...fixture.history,turns:[{prompt:'bad',reply:{text:'reply',model:'model',files:[null]}}]}}]));
  assert.equal(store.readChats().length, 0);
});

test('record song permissions persist per chat, including an empty selection', () => {
  const store = sessions();
  const permissions = { beat: true, lyrics: true, songs: ['song.banger'], allowNewSongs: false };
  store.writeChats([{ ...fixture, history: { ...fixture.history, permissions } }, { ...fixture, id: 'empty', history: { ...fixture.history, permissions: { ...permissions, songs: [] } } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(store.readChats().map(chat => chat.history.permissions))), [permissions, { ...permissions, songs: [] }]);
  store.writeChats([{ ...fixture, history: { ...fixture.history, permissions: { ...permissions, songs: 'song.banger' } } }]);
  assert.equal(store.readChats().length, 0);
});

test('activity survives reopen and older turns remain readable; interrupted streams stop without files', () => {
  const store = sessions();
  const old = {prompt:'Old question', revision:0, reply:{text:'Old reply',model:'fixture',files:[]},activity:['Saved song.banger']};
  const live = {...old,run:{requestId:'first',startedAt:100,status:'running',activity:[{message:'Requesting generation',at:200}]},reply:{...old.reply,text:'Partial reply'}};
  store.writeChats([{...fixture,history:{...fixture.history,turns:[old,live]}}]);
  const turns = store.readChats()[0].history.turns;
  assert.equal(turns[0].activity[0], 'Saved song.banger');
  assert.equal(turns[0].run, undefined);
  assert.equal(turns[1].run.status, 'stopped');
  assert.equal(turns[1].run.endedAt, 200);
  assert.equal(turns[1].reply.text, 'Partial reply');
  assert.equal(turns[1].run.activity[0].message, 'Requesting generation');
  const completed = {...live,run:{...live.run,status:'completed',endedAt:500}};
  store.writeChats([{...fixture,status:'done',history:{...fixture.history,turns:[completed]}}]);
  assert.equal(store.readChats()[0].history.turns[0].run.endedAt,500);
  store.writeChats([{...fixture,history:{...fixture.history,turns:[{...live,run:{...live.run,activity:[null]}}]}}]);
  assert.equal(store.readChats().length,0);
});
