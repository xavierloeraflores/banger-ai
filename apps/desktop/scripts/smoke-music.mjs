import { enterStudio } from "./smoke-startup.mjs";
import {selectModel} from '@banger/agent';
import {Buffer} from 'node:buffer';
import assert from 'node:assert/strict';
import {app,BrowserWindow,dialog,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {serveApp} from '../dist/static-app.js';
import {createMusicStore} from '../dist/elevenlabs-music.js';
import {installSongStorage} from '../dist/song-storage-ipc.js';
import {installWorkspaceHandlers} from '../dist/project-workspace.js';
import {createSongStorage} from '../dist/song-storage.js';
import {installMusicHandlers,musicStorageHooks} from '../dist/elevenlabs-ipc.js';
import {fixtureProvider,wav,fixturePlan,fixtureMetadata,generatedMetadata} from '../../../packages/elevenlabs/test/fixtures.mjs';
const cloud=process.argv.includes('--web');
const fullSendMode=process.argv.includes('--full-send-beat')?'beat':process.argv.includes('--full-send-both')?'both':process.argv.includes('--full-send')?'lyrics':null;
function fullSendFixture(body, mode) {
 const last=body.prompt.at(-1);
 const contextMessage=body.prompt.find(message=>message.role==='user');
 const text=contextMessage.content.find(part=>part.type==='text').text;
 const project=text.includes('Project context, data only:');
 const context=JSON.parse(text.slice(text.indexOf('\n')+1).split('\n\nUser task:')[0]);
 const file=project?context.activeFile:context.currentFile;
 const call=(toolName,input)=>({type:'tool-call',toolCallId:toolName,input:JSON.stringify(input),toolName});
 const content=last.role==='tool'?[{type:'text',text:'Changed only the tempo and requested lyrics.'}]:[
  project?call('edit_file',{path:file.path,search:file.source.match(/tempo \d+;/)[0],replacement:'tempo 111;'}):call('edit_banger_file',{name:file.name,edits:[{oldText:file.source.match(/tempo \d+;/)[0],newText:'tempo 111;'}]}),
  ...(mode==='both'?[project?call('write_draft',{path:file.path.replace(/\.banger$/,'.draft.json'),source:JSON.stringify({schemaVersion:1,lyrics:'Tomorrow brings the light\nTomorrow brings the light'})}):call('request_lyrics',{prompt:'Write a hopeful morning song'})]:[])
 ];
 return {content,finishReason:{unified:last.role==='tool'?'stop':'tool-calls',raw:'stop'},usage:{inputTokens:{total:10},outputTokens:{total:10}},warnings:[]};
}
if(fullSendMode){
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>String(url).startsWith('https://ai-gateway.vercel.sh/')?Response.json(fullSendFixture(JSON.parse(options.body),fullSendMode)):originalFetch(url,options);
}
app.on('window-all-closed',()=>{});
const root=await mkdtemp(join(tmpdir(),'banger-music-ui-'));app.setPath('userData',root);
const timer=setTimeout(()=>{console.error('Music smoke timed out');app.exit(1);},150000);
const projectId=randomUUID(),artifactId=randomUUID();const source='tempo 120; meter 4/4; track kick { sound "drums/kick"; bars 4; rhythm "x . x ."; gain .6; }';
// fixture.mp3 is the synthesized WAV from fixtures.mjs encoded with libmp3lame at 32 kbps.
const finalAudio=await readFile(new URL('../../../packages/elevenlabs/test/fixture.mp3',import.meta.url));
const generatedInputs=[];const provider=fixtureProvider(),generate=provider.generate;provider.generate=async(version,indices)=>{generatedInputs.push({version,indices});return {...await generate(version),audio:finalAudio};};
const store=createMusicStore(join(root,'music'),()=>provider,musicStorageHooks(createSongStorage(root)));let uploaded,window,exitCode=0;
const pathname=`projects/${projectId}/audio/${artifactId}.wav`;
const jobPaths=new Map();
const job=operation=>({...operation,studioPath:jobPaths.get(operation.id),kind:'elevenlabs',activity:[],result:operation.status==='completed'?{musicId:operation.musicId,version:operation.resultVersion}:null});
async function run(){
 const api=createServer(async(request,response)=>{
  response.setHeader('Access-Control-Allow-Origin',request.headers.origin??'*');response.setHeader('Access-Control-Allow-Headers',request.headers['access-control-request-headers']??'*');response.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');response.setHeader('Content-Type','application/json');
  if(request.method==='OPTIONS'){response.end();return;}
  const url=new URL(request.url,'http://localhost');if(process.env.BANGER_MUSIC_DEBUG)console.log(request.method,url.pathname,request.headers['x-mpu-action']??'');const json=(value,status=200)=>{response.statusCode=status;response.end(JSON.stringify(value));};
  try{
   const chunks=[];for await(const part of request)chunks.push(part);const bytes=Buffer.concat(chunks);const body=()=>JSON.parse(bytes.toString());
   if(url.pathname.startsWith('/blob')){
    if(request.headers['x-mpu-action']==='create')assert.equal(request.headers['x-vercel-blob-access'],'private');
    if(request.headers['x-mpu-action']==='create')return json({uploadId:'fixture-upload',key:pathname});
    if(request.headers['x-mpu-action']==='upload'){uploaded=bytes;return json({etag:'fixture-etag',partNumber:1});}
    return json({url:`https://fixture.private.blob.vercel-storage.com/${pathname}`,pathname,contentType:'audio/wav',contentDisposition:'attachment'});
   }
   assert.equal(request.headers.authorization,undefined,'Browser API requests use the same-origin session, not a pasted bearer token.');
   if(url.pathname==='/api/session')return json({authenticated:true,signInEnabled:true,services:{storage:true}});
   if(url.pathname==='/api/projects')return json({projects:[{id:projectId,name:'Music project',revision:1}]});
   if(url.pathname===`/api/projects/${projectId}`)return json({projectId,revision:1,name:'Music project',files:url.searchParams.has('since')?[]:[{path:'song.banger',source},{path:'other.banger',source}],deleted:[]});
   if(url.pathname.endsWith('/music'))return json({music:await Promise.all((await store.list()).map(async item=>({...item,studioPath:(await store.get(item.id)).studioPath})))});
   if(url.pathname.endsWith('/artifacts'))return request.method==='POST'?json({id:artifactId,pathname}):json({artifacts:[]});
   if(url.pathname==='/api/uploads'){
    const input=body();assert.equal(input.payload.pathname,pathname);assert.equal(JSON.parse(input.payload.clientPayload).artifactId,artifactId);
    const payload=Buffer.from(JSON.stringify({pathname,validUntil:Date.now()+600000,maximumSizeInBytes:104857600,allowedContentTypes:['audio/wav']})).toString('base64');
    return json({clientToken:'vercel_blob_client_fixture_'+Buffer.from('signature.'+payload).toString('base64')});
   }
   if(url.pathname.endsWith('/complete')){assert.ok(uploaded?.length);return json({id:artifactId,status:'ready'});}
   if(url.pathname.endsWith('/jobs')){if(request.method==='GET')return json({jobs:(await store.operations()).map(job)});assert.equal(request.headers['x-banger-elevenlabs-key'],'fake-vocal-key');const input=body();jobPaths.set(input.idempotencyKey,input.input.studioPath);return json(job(await store.importWav(uploaded,input.input?.beat?.name??'Uploaded song',input.idempotencyKey,undefined,input.input?.beat,input.input.studioPath)),202);}
   if(url.pathname.endsWith('/resume'))return json({});
   if(url.pathname.endsWith('/actions')){const input=body();if(input.action.operation==='generate')assert.equal(request.headers['x-banger-elevenlabs-key'],'fake-vocal-key');else assert.equal(request.headers['x-banger-elevenlabs-key'],undefined);return json(job(await store.act(url.pathname.split('/')[3],input.action,input.idempotencyKey)),202);}
   if(url.pathname.endsWith('/versions')){const history=await store.versions(url.pathname.split('/')[3],url.searchParams.has('before')?Number(url.searchParams.get('before')):undefined);return json({...history,versions:history.versions.map(document=>({revision:document.version,document}))});}
   if(url.pathname.startsWith('/api/music/'))return json(await store.get(url.pathname.split('/')[3]));
   if(url.pathname.startsWith('/api/artifacts/')){const selected=(await store.list())[0];const history=await store.versions(selected.id);const version=[history.original,...history.versions].find(item=>item.audioId===url.pathname.split('/')[3]);assert.ok(version);const audio=await store.audio(selected.id,version.version);response.setHeader('Content-Type',audio.contentType);response.end(audio.bytes);return;}
   return json({error:'Unknown fixture route'},404);
  }catch(error){if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT,(await window.webContents.capturePage()).toPNG());console.error(error);return json({error:error.message},500);}
 });
 const web=createServer(async(request,response)=>{
  if(request.url.startsWith('/api/')){
    const parts=[];for await(const part of request)parts.push(part);
    const upstream=await fetch(`http://127.0.0.1:${api.address().port}${request.url}`,{method:request.method,headers:request.headers,...(!['GET','HEAD'].includes(request.method)?{body:Buffer.concat(parts)}:{})});
    response.writeHead(upstream.status,Object.fromEntries(upstream.headers));response.end(Buffer.from(await upstream.arrayBuffer()));return;
  }
  const result=await serveApp(new Request(`banger://app${request.url}`),resolve('../www/out'));
  const headers=Object.fromEntries(result.headers);headers['content-security-policy']=headers['content-security-policy'].replace("connect-src 'self'",`connect-src 'self' http://127.0.0.1:${api.address().port} https://vercel.com`);response.writeHead(result.status,headers);
  let content=Buffer.from(await result.arrayBuffer());
  // Buffer only the Blob fixture transport: Chromium streaming fetch requires HTTP/2.
  if(cloud&&request.url==='/')content=Buffer.from(content.toString().replace('<head>',`<head><script>(()=>{const original=window.fetch.bind(window);window.fetch=async(url,options)=>{if(String(url).startsWith('https://vercel.com/api/blob')){const init={...options};if(init.body instanceof ReadableStream){init.body=await new Response(init.body).arrayBuffer();delete init.duplex;}return original('http://127.0.0.1:${api.address().port}/blob'+new URL(url).search,init);}return original(url,options);};})();</script>`));
  response.end(content);
 });
 await Promise.all([new Promise(resolve=>api.listen(0,'127.0.0.1',resolve)),new Promise(resolve=>web.listen(0,'127.0.0.1',resolve))]);
 window=new BrowserWindow({show:false,width:1440,height:1080,webPreferences:{backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false,...(!cloud?{preload:resolve('dist/preload.cjs')}:{})}});
 if(!cloud){
  await mkdir(join(root,'library','Cover song'),{recursive:true});
  await writeFile(join(root,'library','Cover song','Cover song.wav'),wav());
  await writeFile(join(root,'library','Cover song','Cover song.banger'),source.replace('tempo 120','tempo 87'));
  await writeFile(join(root,'library','Cover song','cover.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII=','base64'));
  const senderWindow=event=>{assert.equal(event.senderFrame,window.webContents.mainFrame);return window;};
  const storage=installSongStorage(senderWindow);
  installWorkspaceHandlers({senderWindow,onOpen:(window,root)=>storage.setRoot(window,root),selectModel:async()=>{if(fullSendMode)return selectModel({provider:'vercel',model:'fixture',key:'fake-llm-key'});throw new Error('Music smoke must not request a project model');}});
  installMusicHandlers(event=>{assert.equal(event.senderFrame,window.webContents.mainFrame);return window;},store,storage);
  let vocalsConfigured=true;
  ipcMain.handle('banger:ai-load',()=>({activeProvider:'openai',providers:{openai:{model:'fixture',configured:true}},elevenLabsConfigured:vocalsConfigured}));
  ipcMain.handle('banger:elevenlabs-save',()=>{vocalsConfigured=true;});
  ipcMain.handle('banger:elevenlabs-remove',()=>{vocalsConfigured=false;});
  let failFit=process.argv.includes('--draft-failure');
  ipcMain.handle('banger:lyrics',(_event,request)=>{if(failFit&&request.chunks.length){failFit=false;return {ok:false,error:'Fixture fitting failure'};}return {ok:true,edits:(request.chunks.length?request.chunks:[{index:0}]).map(chunk=>({index:chunk.index,lyrics:request.prompt.includes('only the first chunk')&&chunk.index===0?'Morning brings the light':!request.chunks.length?'Tomorrow brings the light\nTomorrow brings the light':'Tomorrow brings the light'}))};});
  ipcMain.handle('banger:local-status',()=>({phase:'idle',selected:false}));
  ipcMain.handle('banger:chatgpt-status',()=>({accounts:[],models:[],connected:false}));
  await writeFile(join(root,'input.wav'),wav());dialog.showOpenDialog=async()=>({canceled:false,filePaths:[join(root,'input.wav')]});dialog.showSaveDialog=async()=>({canceled:false,filePath:join(root,'final.mp3')});
 }
 if(process.env.BANGER_MUSIC_DEBUG){
  window.webContents.on('console-message',event=>console.log('Browser:',event.message));
  window.webContents.session.webRequest.onErrorOccurred(details=>console.log('Network error',details.url,details.error));
  window.webContents.session.webRequest.onCompleted(details=>{if(details.url.includes('/blob'))console.log('Blob response',details.statusCode);});
 }
 window.webContents.session.on('will-download',(_event,item)=>item.setSavePath(join(root,'extra-export.wav')));
 const evaluate=code=>window.webContents.executeJavaScript(code,true).catch(error=>{throw new Error(`${error.message} Script: ${code}`);});
 const wait=async expression=>{for(let i=0;i<400;i++){if(await evaluate(`Boolean(${expression})`))return;await delay(40);}throw new Error(`UI timeout: ${expression}; ${await evaluate("JSON.stringify({active:document.activeElement?.outerHTML,dialogs:[...document.querySelectorAll('[role=dialog][data-state=open]')].map(e=>e.id),menus:[...document.querySelectorAll('[role=menu]')].map(e=>e.outerHTML)})")}`);};
 const click=async text=>{await wait(`[...document.querySelectorAll('button')].some(b=>(b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)})&&!b.disabled)`);return evaluate(`[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)})&&!b.disabled).click()`);};
 let chatReturn = 'Vocal Studio';
 const openChat = async () => {
  chatReturn = await evaluate("document.querySelector('.app-sidebar-link[aria-current=page]')?.getAttribute('aria-label')") || chatReturn;
  await evaluate("[...document.querySelectorAll('.app-sidebar-chat')].at(-1).click()");
 };
 const closeChat = () => click(chatReturn);
 const exportSong=async()=>{
  window.show();window.focus();window.webContents.focus();
  const key=keyCode=>{window.webContents.sendInputEvent({type:'keyDown',keyCode});window.webContents.sendInputEvent({type:'keyUp',keyCode});};
  const trigger='.producer-header .studio-export-menu > button';
  await wait(`document.querySelector('${trigger}') && !document.querySelector('${trigger}').disabled`);
  assert.equal(await evaluate("document.querySelectorAll('select[aria-label=\"Export song\"]').length"),0,'Export uses buttons in both studios');
  assert.ok(await evaluate(`(() => { const project=[...document.querySelectorAll('.producer-file-actions button')].find(b=>b.textContent==='Save'), button=document.querySelector('${trigger}'); const a=project.getBoundingClientRect(), b=button.getBoundingClientRect(); return b.left>a.left && Math.abs(a.top-b.top)<2; })()`),'Export sits beside Save');
  await evaluate(`document.querySelector('${trigger}').focus(); document.querySelector('${trigger}').click()`);
  await wait("document.activeElement?.textContent==='Export and download'");
  if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT.replace('.png',`-export-${await evaluate("document.querySelector('.producer').dataset.view")}.png`),(await window.webContents.capturePage()).toPNG());
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.studio-export-actions button')].map(item=>item.textContent)"),['Export and download','Export and save to library']);
  key('Tab');
  await wait("document.activeElement.textContent==='Export and save to library'");
  key('Escape');
  await wait(`document.activeElement===document.querySelector('${trigger}') && document.querySelector('.studio-export-dialog')?.getAttribute('data-state') !== 'open'`);
  await evaluate(`document.querySelector('${trigger}').focus(); document.querySelector('${trigger}').click()`);
  const [width,height]=window.getContentSize();
  window.setContentSize(390,844);await delay(100);
  await wait("(() => {const bounds=document.querySelector('.studio-export-dialog').getBoundingClientRect();return bounds.left>=15 && bounds.right<=document.documentElement.clientWidth-15;})()");
  if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT.replace('.png','-export-mobile.png'),(await window.webContents.capturePage()).toPNG());
  window.setContentSize(width,height);await delay(100);
  await click('Export and save to library');
  await evaluate("document.querySelector('[aria-label=\"Close export options\"]').click()");
 };
 const fill=(selector,value)=>evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
 const fillLyrics=async(value)=>{
   while(await evaluate("document.querySelectorAll('#music-chunk-0 .music-lyric-line').length>1")){
     await evaluate("[...document.querySelectorAll('#music-chunk-0 .music-lyric-actions button')].filter(b=>b.getAttribute('aria-label')?.startsWith('Remove ')).at(-1).click()");
   }
   await fill('[aria-label="Lyrics for chunk 1, line 1"]',value);
 };
 const chunkLines=index=>evaluate(`[...document.querySelectorAll('#music-chunk-${index} .music-lyric-line textarea')].map(input=>input.value)`);
 const dragLine=(source,target)=>evaluate(`(() => {
   const from=document.querySelector(${JSON.stringify(source)}),to=document.querySelector(${JSON.stringify(target)}),dataTransfer=new DataTransfer();
   from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));
   to.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer}));
   to.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));
   from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));
 })()`);
 try{
  await window.loadURL(`http://127.0.0.1:${web.address().port}`);await enterStudio(window);await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  if(cloud){
   await evaluate(`sessionStorage.setItem('banger.ai-settings.v1', JSON.stringify({activeProvider:'vercel',providers:{vercel:{model:'fixture',key:'fake-llm-key'}},elevenLabsKey:'fake-vocal-key'})); window.dispatchEvent(new Event('banger:ai-settings-changed'));
     const originalFetch=window.fetch;window.fetch=async(url,options)=>{
       if(String(url).startsWith('https://ai-gateway.vercel.sh/')){
         if(new Headers(options.headers).get('authorization')!=='Bearer fake-llm-key')throw new Error('Wrong LLM key');
         const body=JSON.parse(options.body);
         if(body.tools?.length)return Response.json((${fullSendFixture.toString()})(body,${JSON.stringify(fullSendMode)}));
         const input=JSON.parse(body.prompt.at(-1).content.find(part=>part.type==='text').text);
         return Response.json({content:[{type:'text',text:JSON.stringify((input.chunks.length?input.chunks:[{index:0}]).map(chunk=>({index:chunk.index,lyrics:input.prompt.includes('only the first chunk')&&chunk.index===0?'Morning brings the light':!input.chunks.length?'Tomorrow brings the light\\nTomorrow brings the light':'Tomorrow brings the light'})))}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:10},outputTokens:{total:10}},warnings:[]});
       }
       return originalFetch(url,options);
     }; undefined;`);
   await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");await wait("document.querySelector('details.project-workspace')");await evaluate("document.querySelector('details.project-workspace').open=true");
   await wait("document.querySelector('details.project-workspace select')");await click('Open Vocal Studio');await click('Beat Studio');
  }
  await click('Mixer');
  assert.equal(await evaluate("document.querySelectorAll('.producer-tabs [role=tab]').length"),4);
  await click('Vocal Studio');await wait("document.querySelector('.producer').dataset.view==='vocal'");
  assert.equal(await evaluate("document.querySelector('.producer-tabs').checkVisibility()"),false);
  assert.equal(await evaluate("document.querySelectorAll('.app-sidebar-nav button').length"),3);
  await click('Beat Studio');await wait("document.querySelector('#studio-tab-mixer').getAttribute('aria-selected')==='true'");
  assert.equal(await evaluate("document.querySelector('#studio-panel-mixer').checkVisibility()"),true);
  await click('Vocal Studio');
  assert.equal(await evaluate("!!document.querySelector('.music-workshop .music-lyric-composer')"),false);
  await wait("document.querySelectorAll('.music-empty .music-wav-actions button').length===1");
  assert.equal(await evaluate("document.querySelectorAll('.music-heading button').length"),0);
  assert.equal(await evaluate("document.querySelector('.music-song-title .library-song-tag')?.textContent"),'Instrumental');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT.replace('.png','-empty.png'),(await window.webContents.capturePage()).toPNG());
  if(fullSendMode){
    const originalSource=await evaluate("document.querySelector('#producer-source').value");
    await openChat();
    assert.equal(await evaluate("document.querySelectorAll('.ai-chat-permissions [role=checkbox]')[2].getAttribute('aria-checked') === 'true'"),false);
    await evaluate(`(() => { const wanted=[${fullSendMode!=='lyrics'},${fullSendMode!=='beat'},true]; [...document.querySelectorAll('.ai-chat-permissions [role=checkbox]')].forEach((input,index)=>{if((input.getAttribute('aria-checked') === 'true')!==wanted[index])input.click();}); })()`);
    await fill('#ai-chat-prompt',fullSendMode==='lyrics'?'Write a hopeful morning song':'Change only the tempo to 111'+(fullSendMode==='both'?' and write a hopeful morning song':''));
    await click('Send');
    await wait("document.querySelector('.ai-chat-transcript').textContent.includes('Produce and Add to Library complete') || document.querySelector('.ai-chat-footer').textContent.includes('Produce and Add to Library complete') || document.querySelector('.ai-chat-footer [role=alert]')");
    assert.equal(await evaluate("document.querySelector('.ai-chat-footer [role=alert]')?.textContent??''"),'');
    const expected=fullSendMode==='lyrics'?originalSource:originalSource.replace(/tempo \d+;/,'tempo 111;');
    assert.equal(await evaluate("document.querySelector('#producer-source').value"),expected);
    assert.deepEqual(provider.calls,{analyze:fullSendMode==='beat'?0:1,lyrics:0,generate:fullSendMode==='beat'?0:1});
    if(fullSendMode!=='beat'){
      const version=await store.get((await store.list())[0].id);
      assert.equal(version.version,3);
      assert.equal(version.beat.source,expected);
      assert.ok(generatedInputs[0].version.plan.chunks.every(chunk=>chunk.text.includes('Tomorrow brings the light')));
    }
    if(fullSendMode==='lyrics'){
      await closeChat();
      await fill('#vocal-style','Warm alto');await click('Apply to all chunks');await click('Save lyrics & style');
      await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 4')");
      await openChat();
      await fill('#ai-chat-prompt','Change only the first chunk to Morning brings the light. Leave the second chunk unchanged.');await click('Send');
      await wait("document.querySelectorAll('.ai-chat-turn .ai-chat-answer').length===2 || document.querySelector('.ai-chat-footer [role=alert]')");
      assert.equal(await evaluate("document.querySelector('.ai-chat-footer [role=alert]')?.textContent??''"),'');
      assert.equal(provider.calls.generate,2);
      assert.deepEqual(generatedInputs[1].version.plan.chunks.map(chunk=>chunk.vocalStyle),['Warm alto','Warm alto']);
      assert.ok(generatedInputs[1].version.plan.chunks[0].text.includes('Morning brings the light'));
      assert.ok(generatedInputs[1].version.plan.chunks[1].text.includes('Tomorrow brings the light'));
      assert.equal(await evaluate("document.querySelector('#producer-source').value"),originalSource);
    }
    await closeChat();await click('Library');
    await wait(`document.querySelectorAll('.library-card').length>=${cloud?1:2}`);
    console.log(`${cloud?'Browser':'Desktop'} Produce and Add to Library ${fullSendMode} passed: edited source, WAV, ${fullSendMode==='beat'?'no provider calls':'analysis, saved chunk lyrics, vocal generation'}, library.`);
    return;
  }
  if(process.argv.includes('--draft')){
    await openChat();await evaluate(`(() => { for (const input of document.querySelectorAll('.ai-chat-permissions [role=checkbox]')) { const checked = input.parentElement.textContent.includes('Edit lyrics'); if ((input.getAttribute('aria-checked') === 'true') !== checked) input.click(); } })()`);
    await fill('#ai-chat-prompt','Write a hopeful morning song');await click('Send');
    await wait("document.querySelector('.ai-chat-transcript').textContent.includes('.draft.json')");
    await closeChat();
    await wait("document.querySelector('[aria-label=\"Lyrics for draft, line 1\"]')?.value==='Tomorrow brings the light'");
    await fill('[aria-label="Lyrics for draft, line 1"]','Edited first line');
    await click('Move draft, line 1 down');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Lyrics for draft, line 2\"]').value"),'Edited first line');
    await click('Move draft, line 2 up');
    await fill('[aria-label="Lyrics for draft, line 1"]','Tomorrow brings the light');
    await click('Add line to draft');
    await fill('[aria-label="Lyrics for draft, line 3"]','Extra draft line');
    await click('Save draft lyrics');
    await wait("document.querySelector('.music-status').textContent.includes('Draft lyrics saved')");
    await delay(1700);
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Lyrics for draft, line 3\"]').value"),'Extra draft line');
    await click('Remove draft, line 3');await click('Save draft lyrics');
    await wait("!document.querySelector('[aria-label=\"Lyrics for draft, line 3\"]') && [...document.querySelectorAll('button')].find(b=>b.textContent==='Save draft lyrics').disabled");
    if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT.replace('.png','-draft.png'),(await window.webContents.capturePage()).toPNG());
  }
  assert.equal(await evaluate("[...document.querySelectorAll('.music-workshop button')].some(button=>button.textContent.includes('Upload WAV'))"),false,'Projects use the studio WAV instead of external uploads');
  assert.equal(await evaluate("document.querySelector('.music-workshop input[type=file]')"),null);
  await click('Use studio WAV');
  await wait("document.querySelectorAll('.music-chunk').length===2");
  if(process.argv.includes('--draft')){
    if(process.argv.includes('--draft-failure')){await wait("document.querySelector('.music-workshop').textContent.includes('Fixture fitting failure')");assert.ok(await evaluate("!!document.querySelector('.music-draft')"));await click('Retry fitting draft');}
    await wait("document.querySelector('.music-workshop').textContent.includes('Draft fitted and saved')");
    await wait("!document.querySelector('.music-draft')");
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Lyrics for chunk 1, line 1\"]').value"),'Tomorrow brings the light');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Generate new variation\"]').disabled"),false);
    const version=await store.get((await store.list())[0].id);
    assert.equal(version.version,2);assert.equal(provider.calls.generate,0);
    if(!cloud){const location=await store.location(version.id);await assert.rejects(readFile(join(location.root,`${location.name}.draft.json`)),{code:'ENOENT'});assert.equal(JSON.parse(await readFile(join(location.root,`${location.name}.lyric.json`),'utf8')).version,2);}
    console.log(`${cloud?'Browser':'Desktop'} draft smoke passed: floating chat draft, automatic chunk fitting, saved lyrics, draft removal, and generation ready.`);
    return;
  }
  assert.equal(await evaluate("document.querySelector('.music-empty')"),null);
  assert.equal(await evaluate("!!document.querySelector('[aria-controls=performance-stage]')"),true,'Studio vocals retain the associated beat for Band stage');
  assert.equal(await evaluate("document.querySelectorAll('.music-replace-wav button').length"),1);
  assert.equal(await evaluate("document.querySelectorAll('.music-heading button').length"),0);
  const id=(await store.list())[0].id;const originalWav=Buffer.from((await store.audio(id,1)).bytes);assert.equal(originalWav.subarray(0,4).toString(),'RIFF');assert.ok((await store.get(id)).beat);assert.deepEqual((await store.get(id)).plan,fixturePlan);
  if(process.argv.includes('--vocal-style')){
    const style='Warm, breathy alto, intimate delivery, restrained vibrato.';
    await fill('#vocal-style',style);await click('Apply to all chunks');
    assert.equal(provider.calls.generate,0);
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Generate new variation\"]').disabled"),true);
    await click('Save lyrics & style');await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 2')");
    await click('Reload composition');
    await wait(`document.querySelector('[aria-label="Vocal style for chunk 1"]').value===${JSON.stringify(style)}`);
    assert.deepEqual((await store.get(id)).plan.chunks.map(chunk=>chunk.vocalStyle),[style,style]);
    await wait("!document.querySelectorAll('.music-chunk-heading [role=checkbox]')[1].disabled");
    await evaluate("document.querySelectorAll('.music-chunk-heading [role=checkbox]')[1].click()");
    await wait("document.querySelectorAll('.music-chunk-heading [role=checkbox]')[1].getAttribute('aria-checked')==='false'");
    await fill('#vocal-style','Bright tenor');await click('Apply to selected chunks');await click('Save lyrics & style');
    await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 3')");
    assert.deepEqual((await store.get(id)).plan.chunks.map(chunk=>chunk.vocalStyle),['Bright tenor',style]);
    await fill('[aria-label="Vocal style for chunk 1"]','');await click('Save lyrics & style');
    await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 4')");
    assert.equal((await store.get(id)).plan.chunks[0].vocalStyle,undefined);
    assert.deepEqual((await store.get(id)).plan.chunks.map(chunk=>chunk.positiveStyles),fixturePlan.chunks.map(chunk=>chunk.positiveStyles));
    assert.deepEqual(provider.calls,{analyze:1,lyrics:0,generate:0});
    if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT,(await window.webContents.capturePage()).toPNG());
    await click('Use studio WAV');
    await wait(`document.querySelector('[aria-label="Vocal take"]').value!==${JSON.stringify(id)} && document.querySelector('.music-editor-heading').textContent.includes('Composition version 2')`);
    const reanalyzed=await store.get((await store.list())[0].id);
    assert.deepEqual(reanalyzed.plan.chunks.map(chunk=>chunk.vocalStyle),[undefined,style]);
    await click('Generate new variation');await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 3')");
    assert.deepEqual(generatedInputs.at(-1).version.plan.chunks.map(chunk=>chunk.vocalStyle),[undefined,style]);
    window.setContentSize(390,844);await delay(200);
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
    console.log(`${cloud?'Browser':'Desktop'} vocal styles passed: all/selected/clear, free saves, reload, reanalysis, generation.`);
    return;
  }
  if(!cloud){
   await wait("document.querySelector('.app-sidebar-song')");
   const originalPath=await evaluate("document.querySelector('.app-sidebar-song[aria-current]').dataset.songPath");
   await evaluate("document.querySelector('[aria-label=\"Add song\"]').click()");
   await fill('[aria-label="New song name"]','second');await click('Create New Song');
   await wait("document.querySelector('.app-sidebar-song[aria-current]').dataset.songPath==='second.banger'");
   await wait("document.querySelector('.music-empty h2')?.textContent==='No vocals yet.'");
   await delay(1700);
   assert.equal(await evaluate("document.querySelectorAll('.music-chunk').length"),0,'Polling never falls back to another song');
   assert.equal(await evaluate("document.querySelector('[aria-label=\"Vocal take\"]')"),null);
   await evaluate(`[...document.querySelectorAll('.app-sidebar-song')].find(button => button.dataset.songPath === ${JSON.stringify(originalPath)}).click()`);
   await wait("document.querySelectorAll('.music-chunk').length===2");
   assert.equal(await evaluate("document.querySelector('[aria-label=\"Vocal take\"]').value"),id);
  }
  if(cloud){
   await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");
   await fill('[aria-label="Cloud music file"]','other.banger');
   // Browsing a different cloud file cannot change either active editor.
   assert.equal(await evaluate(`document.querySelector('[aria-label="Vocal take"]').value`),id);
   await click('Load cloud file in studio');
   await wait("document.querySelector('.music-empty h2')?.textContent==='No vocals yet.'");
   await delay(1700);
   assert.equal(await evaluate("document.querySelectorAll('.music-chunk').length"),0);
   await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");await fill('[aria-label="Cloud music file"]','song.banger');await click('Load cloud file in studio');
   await wait("document.querySelectorAll('.music-chunk').length===2");
   assert.equal(await evaluate(`document.querySelector('[aria-label="Vocal take"]').value`),id);
  }
  // Rows retain order through drag, keyboard controls, cross-section moves and saves.
  await fillLyrics('FirstSecond');
  await evaluate(`(() => {const input=document.querySelector('[aria-label="Lyrics for chunk 1, line 1"]');input.focus();input.setSelectionRange(5,5);input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));})()`);
  await wait("document.activeElement?.getAttribute('aria-label')==='Lyrics for chunk 1, line 2'");
  assert.deepEqual(await chunkLines(0),['First','Second'],'Enter splits a line and focuses the next one');
  await fillLyrics('First line\nSecond line');
  await dragLine('[aria-label="Drag chunk 1, line 1"]','#music-chunk-0 .music-lyric-add');
  assert.deepEqual(await chunkLines(0),['Second line','First line']);
  await click('Move chunk 1, line 2 up');
  assert.deepEqual(await chunkLines(0),['First line','Second line']);
  const originalSecond=await chunkLines(1);
  await dragLine('[aria-label="Drag chunk 1, line 2"]','#music-chunk-1 .music-lyric-add');
  assert.deepEqual(await chunkLines(0),['First line']);
  assert.deepEqual(await chunkLines(1),[...originalSecond,'Second line']);
  await fill(`[aria-label="Move chunk 2, line ${originalSecond.length+1} to section"]`,'0');
  assert.deepEqual(await chunkLines(0),['First line','Second line']);
  assert.deepEqual(await chunkLines(1),originalSecond);
  if(process.argv.includes('--line-persistence')){
    await dragLine('[aria-label="Drag chunk 1, line 1"]','#music-chunk-1 .music-lyric-add');
    await dragLine('[aria-label="Drag chunk 1, line 1"]','#music-chunk-1 .music-lyric-add');
    assert.deepEqual(await chunkLines(0),[''],'Moving the last line leaves an editable empty section');
    await dragLine(`[aria-label="Drag chunk 2, line ${originalSecond.length+2}"]`,'#music-chunk-0 .music-lyric-add');
    assert.deepEqual(await chunkLines(0),['Second line'],'Dropping into an empty section replaces its placeholder');
    await wait("document.activeElement?.getAttribute('aria-label')==='Lyrics for chunk 1, line 1'");
    await click('Save lyrics & style');
    await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 2')");
    await click('Reload composition');
    await wait("!document.querySelector('[aria-label=\"Lyrics for chunk 1, line 1\"]').disabled");
    assert.deepEqual(await chunkLines(0),['Second line']);
    assert.deepEqual(await chunkLines(1),[...originalSecond,'First line']);
    const saved=await store.get(id);
    assert.equal(saved.plan.chunks[0].text,fixturePlan.chunks[0].text.match(/^\s*\[[^\]]+\]/)[0]+'\nSecond line');
    assert.ok(saved.plan.chunks[1].text.endsWith('First line'));
    assert.equal(provider.calls.generate,0,'Moving and saving lyrics does not generate audio');
    if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT,(await window.webContents.capturePage()).toPNG());
    window.setContentSize(390,844);await delay(200);
    assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),'Lyric rows fit a narrow viewport');
    if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT.replace('.png','-mobile.png'),(await window.webContents.capturePage()).toPNG());
    console.log(`${cloud?'Browser':'Desktop'} line persistence passed: reorder, cross-section drag, empty sections, save and reload.`);
    return;
  }
  await fillLyrics('a'.repeat(201));
  await wait("document.querySelector('.music-workshop').textContent.includes('Each lyric line can have up to 200 characters')");
  assert.equal((await chunkLines(0))[0],'First line','Overlong input is rejected without truncating lyrics');
  await fillLyrics('🎵'.repeat(200));
  assert.equal((await chunkLines(0))[0],'🎵'.repeat(200),'Character limit counts Unicode characters');
  for(const invalid of [Array(30).fill('words').join('\n'),'[Verse]\nwords']){
   await fillLyrics(invalid);
   await wait("document.querySelector('#music-lyric-help-0[role=alert]')");
   assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Save lyrics & style').disabled"),true);
   assert.equal((await store.get(id)).version,1);
  }
  await fillLyrics(Array(29).fill('a'.repeat(200)).join('\n'));
  await wait("!document.querySelector('#music-lyric-help-0[role=alert]')");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Save lyrics & style').disabled"),false);
  await dragLine('[aria-label="Drag chunk 2, line 1"]','#music-chunk-0 .music-lyric-add');
  assert.equal((await chunkLines(0)).length,29,'A full chunk rejects incoming lines');
  assert.deepEqual(await chunkLines(1),originalSecond,'Rejected moves preserve the source');
  if(!cloud){
   await evaluate('void(window.confirm=()=>false)');
   await evaluate("[...document.querySelectorAll('.app-sidebar-song')].find(button => button.dataset.songPath === 'second.banger').click()");
   assert.equal(await evaluate(`document.querySelector('[aria-label="Vocal take"]').value`),id,'Canceling a song switch preserves its lyric draft');
   assert.deepEqual(await chunkLines(0),Array(29).fill('a'.repeat(200)));
   await evaluate('void(window.confirm=()=>true)');
  }
  await fillLyrics('We write our own tomorrow');await click('Save lyrics & style');
  await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 2')");assert.equal(await evaluate("document.querySelector('[aria-label=\"Lyrics for chunk 1, line 1\"]').value"),'We write our own tomorrow');
  assert.deepEqual({...((await store.get(id)).plan.chunks[0]),text:fixturePlan.chunks[0].text},fixturePlan.chunks[0]);
  if (process.argv.includes('--export-only')) {
    await click('Generate new variation');
    await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 3')");
    const downloaded = cloud ? new Promise((resolve, reject) => window.webContents.session.once('will-download', (_event, item) => {
      item.setSavePath(join(root, 'final.mp3'));
      item.once('done', (_event, state) => state === 'completed' ? resolve() : reject(new Error(state)));
    })) : null;
    await exportSong();
    if (downloaded) await downloaded;
    await wait("document.querySelector('.music-status').textContent.includes('Exported and saved to library.')");
    assert.deepEqual(await readFile(join(root, 'final.mp3')), finalAudio);
    await click('Beat Studio');
    await exportSong();
    await wait("document.querySelector('.studio-export-status')?.textContent.includes('Exported and saved to library.')");
    console.log(`${cloud ? 'Browser' : 'Desktop'} export smoke passed: vocal and beat modals, keyboard navigation, Escape/focus return, narrow layout, real audio download and library save.`);
    return;
  }
  await evaluate(`(async()=>{if(window.bangerAI)await window.bangerAI.removeElevenLabs();else{const settings=JSON.parse(sessionStorage.getItem('banger.ai-settings.v1'));delete settings.elevenLabsKey;sessionStorage.setItem('banger.ai-settings.v1',JSON.stringify(settings));}window.dispatchEvent(new Event('banger:ai-settings-changed'));})()`);
  await wait("document.querySelector('[aria-label=\"Generate new variation\"]').disabled");
  await openChat();await evaluate(`(() => { for (const input of document.querySelectorAll('.ai-chat-permissions [role=checkbox]')) { const checked = input.parentElement.textContent.includes('Edit lyrics'); if ((input.getAttribute('aria-checked') === 'true') !== checked) input.click(); } })()`);await fill('#ai-chat-prompt','A hopeful morning');await click('Send');await wait("document.querySelector('.ai-chat-transcript').textContent.includes('Saved the chunk lyrics')");await closeChat();await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 3')");
  assert.equal(provider.calls.lyrics,0,'LLM lyrics must not call ElevenLabs');
  await evaluate(`(async()=>{if(window.bangerAI)await window.bangerAI.saveElevenLabs('fake-vocal-key');else{const settings=JSON.parse(sessionStorage.getItem('banger.ai-settings.v1'));settings.elevenLabsKey='fake-vocal-key';sessionStorage.setItem('banger.ai-settings.v1',JSON.stringify(settings));}window.dispatchEvent(new Event('banger:ai-settings-changed'));})()`);
  await wait("!document.querySelector('[aria-label=\"Generate new variation\"]').disabled");
  await click('Generate new variation');await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 4')");
  await click('Retry chunk 1');await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 5')");
  await click('Play song');await wait("document.querySelector('.music-workshop audio')?.duration>7");
  await evaluate("(()=>{const audio=document.querySelector('.music-workshop audio');audio.muted=true;return audio.play();})()");await wait("document.querySelector('.music-workshop audio').currentTime>0");
  const download=cloud?new Promise((resolve,reject)=>window.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(join(root,'final.mp3'));item.once('done',(_event,state)=>state==='completed'?resolve():reject(new Error(state)));})):null;
  await exportSong();if(download)await download;else for(let i=0;i<100;i++){try{await readFile(join(root,'final.mp3'));break;}catch{await delay(20);}}
  assert.deepEqual(await readFile(join(root,'final.mp3')),finalAudio);assert.deepEqual(provider.calls,{analyze:1,lyrics:0,generate:2});
  assert.equal(await evaluate("document.querySelectorAll('.music-chunk .producer-tag,.music-chunk details').length"),0);
  assert.equal(await evaluate("document.querySelectorAll('.music-timeline-chunks button').length"),2);
  await fill('[aria-label="Seek song"]','4.5');assert.ok(await evaluate("document.querySelector('.music-workshop audio').currentTime>=4"));
  await click('Pause song');await click('Play Original WAV');
  await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 1')");
  await wait("document.querySelector('.music-workshop audio').currentTime>0&&!document.querySelector('.music-workshop audio').paused");
  const original=await evaluate("fetch(document.querySelector('.music-workshop audio').src).then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(hash=>Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''))");assert.equal(original,createHash('sha256').update(originalWav).digest('hex'));
  await click('Retry chunk 2');await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 6')");
  assert.equal(generatedInputs.at(-1).version.songId,'original-song');assert.deepEqual(generatedInputs.at(-1).indices,[1]);assert.deepEqual(generatedInputs.at(-1).version.plan,fixturePlan);
  await click('Play song');await wait("document.querySelector('.music-workshop audio').currentTime>0");await click('Beat Studio');await wait("document.querySelector('.music-workshop audio').paused");await click('Vocal Studio');
  // A newer server revision cannot silently erase a draft.
  await fillLyrics('Unsaved local draft');await store.act(id,{operation:'edit',baseVersion:6,edits:[{index:0,lyrics:'External edit'}]},randomUUID());
  await wait("document.querySelector('.music-workshop').textContent.includes('Your lyric draft is preserved')");assert.equal(await evaluate("document.querySelector('[aria-label=\"Lyrics for chunk 1, line 1\"]').value"),'Unsaved local draft');
  if(process.env.BANGER_MUSIC_SCREENSHOT){await evaluate("window.scrollTo(0,0);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");await writeFile(process.env.BANGER_MUSIC_SCREENSHOT,(await window.webContents.capturePage()).toPNG());}
  await wait("document.querySelectorAll('.music-timeline-chunks svg rect').length>100");
  await click('Preview chunk 1');await wait("!document.querySelector('.music-workshop audio').paused");
  await wait("document.querySelector('.music-workshop audio').paused&&document.querySelector('.music-workshop audio').currentTime>=4&&document.querySelector('.music-workshop audio').currentTime<5");
  window.setContentSize(390,844);await delay(200);
  assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),'Vocal Studio fits a narrow viewport.');
  if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT.replace('.png','-mobile.png'),(await window.webContents.capturePage()).toPNG());
  {
   await evaluate('void(window.confirm=()=>true)');
   await click('Beat Studio');await click('Raw .banger');await fill('#producer-source',source.replace('tempo 120','tempo 60'));await click('Apply source');await click('Vocal Studio');
   await click('Beat Studio');assert.equal(await evaluate("document.querySelector('#studio-tab-source').getAttribute('aria-selected')"),'true');
   assert.ok((await evaluate("document.querySelector('#producer-source').value")).includes('tempo 60'));
   await click('Vocal Studio');
   await click('Use studio WAV');
   await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 1')");
   const imported=(await store.list()).find(song=>song.id!==id);assert.ok(imported,'Rendering the studio creates another song.');
   const rendered=await store.audio(imported.id,1);assert.equal(Buffer.from(rendered.bytes).subarray(0,4).toString(),'RIFF');
   assert.equal(provider.calls.analyze,2);
   assert.equal((await store.get(imported.id)).beat.source,source.replace('tempo 120','tempo 60'));
   await click('Beat Studio');
   await fill('#producer-source',source.replace('tempo 120','tempo 140'));
   await click('Apply source');
   await click('Vocal Studio');
   window.setContentSize(1440,1080); window.show(); window.focus();
   await click('Play song');
   await click('Band stage');
   await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount==='2' && document.querySelector('.performance-viewport canvas').dataset.singer==='true'");
   assert.ok(await evaluate("document.querySelector('.performance-transport').textContent.includes('60 BPM')"),'Vocal stage uses its original beat, not later studio edits');
   assert.equal(await evaluate("document.querySelector('.music-workshop audio').paused"),false,'Stage uses the existing vocal recording');
   await click('Stop');
   await wait("document.querySelector('.music-workshop audio').paused");
   await evaluate("document.querySelector('.performance-transport button').click()");
   await wait("document.querySelector('.performance-transport button').textContent==='Stop'");
   await click('Close band stage');
   await wait("!(document.querySelector('#performance-stage')?.getAttribute('data-state') === 'open')");
   assert.ok((await evaluate("document.querySelector('#producer-source').value")).includes('tempo 140'),'Stage preserves the studio draft');

   if(!cloud){
   const location=await store.location(imported.id);
   const saved=JSON.parse(await readFile(join(location.root,`${location.name}.lyric.json`),'utf8'));
   assert.deepEqual(saved.audioMetadata,fixtureMetadata);assert.equal(saved.audioVersion,1);
   const originalLocation=await store.location(id);
   const generated=JSON.parse(await readFile(join(originalLocation.root,'.banger','history',originalLocation.name,'lyrics','lyrics-v005.json'),'utf8'));
   assert.deepEqual(generated.audioMetadata,generatedMetadata);assert.equal(generated.audioVersion,5);
   const draft=JSON.parse(await readFile(join(originalLocation.root,'.banger','history',originalLocation.name,'lyrics','lyrics-v003.json'),'utf8'));
   assert.deepEqual(draft.audioMetadata,fixtureMetadata);assert.equal(draft.audioVersion,1);
   }
  }
  // Library playback must leave both editors intact and release audio on exit.
  const selectView = value => click({beat:'Beat Studio',vocal:'Vocal Studio',library:'Library'}[value]);
  await selectView('library');
  await wait("document.querySelectorAll('.library-card').length>=1");
  assert.ok(await evaluate("[...document.querySelectorAll('.library-song-tag')].some(tag=>tag.textContent==='Vocal')"),'Generated vocals are tagged vocal');
  const instrumentalsBefore = await evaluate("document.querySelectorAll('.library-song-tag[data-song-type=instrumental]').length");
  assert.equal(await evaluate("document.querySelector('[aria-controls=performance-stage]')?.disabled"),true,'Band stage stays disabled before library selection');
  await evaluate("document.querySelector('[aria-controls=performance-stage]').click()");
  assert.equal(await evaluate("!!document.querySelector('#performance-stage[open]')"),false,'Disabled library button cannot open a stale stage');
  assert.equal(await evaluate("document.querySelector('.producer-transport').checkVisibility()"),false);
  await evaluate("[...document.querySelectorAll('.library-card')].find(card=>!card.textContent.includes('Cover song')).click()");
  await wait("document.querySelector('.library-player audio').currentTime>0");
  assert.equal(await evaluate("document.querySelector('.music-workshop audio').paused"),true);
  await click('Pause library song');await wait("document.querySelector('.library-player audio').paused");
  await click('Play library song');await wait("!document.querySelector('.library-player audio').paused");
  if(!cloud){
   await click('Play Cover song');await wait("document.querySelector('.library-now-playing').textContent.includes('Cover song')&&!document.querySelector('.library-player audio').paused");
   await wait("document.querySelector('.library-card img').naturalWidth===1");
   await click('Band stage');
   await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount==='1'");
   assert.match(await evaluate("document.querySelector('.performance-transport').textContent"),/87 BPM/,'Saved audio opens its companion beat');
   assert.equal(await evaluate("document.querySelector('.library-player audio').paused"),false,'Library stage keeps the recording clock');
   await click('Close band stage');
   await wait("!(document.querySelector('#performance-stage')?.getAttribute('data-state') === 'open')");
  }
  // Export the associated vocal after changing Beat Studio, then open that saved beat.
  await selectView('vocal');
  await exportSong();
  await wait("document.querySelector('.music-status').textContent.includes('Exported and saved to library.')");
  await selectView('library');
  await wait("document.querySelectorAll('.library-card').length>=2");
  // Studio exports can share a display name. Select the take by its saved beat,
  // not the random UUID ordering of two identically named library folders.
  if (!cloud) await evaluate(`(async()=>{ const songs=await window.bangerLibrary.list(); for(let index=0;index<songs.length;index++){const saved=await window.bangerLibrary.read(songs[index].id);if(saved.lyrics?.beat?.source===${JSON.stringify(source.replace('tempo 120','tempo 60'))}){document.querySelectorAll('.library-card')[index].click();return;}}throw new Error('Exported vocal take missing from library');})()`);
  else await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('banger-library',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{const songs=await new Promise((resolve,reject)=>{const request=db.transaction('songs').objectStore('songs').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const index=songs.findIndex(song=>song.beat?.source===${JSON.stringify(source.replace('tempo 120','tempo 60'))});if(index<0)throw new Error('Exported vocal take missing from library');document.querySelectorAll('.library-card')[index].click();}finally{db.close();}})()`);
  await wait("document.querySelector('.library-player audio').currentTime>0 && !document.querySelector('.library-player button').disabled");
  assert.equal(await evaluate("document.querySelector('.library-card[aria-pressed=true] .library-song-tag').textContent"),'Vocal','Vocal export keeps its saved tag');
  assert.equal(await evaluate("document.querySelector('[aria-controls=performance-stage]').disabled"),false,'Selecting a library song enables Band stage');
  await click('Band stage');
  await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount==='2'");
  assert.ok(await evaluate("document.querySelector('.performance-transport').textContent.includes('60 BPM')"),'Library vocal selection replaces the previous stage target');
  await click('Close band stage');
  await wait("!(document.querySelector('#performance-stage')?.getAttribute('data-state') === 'open')");
  assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),'Library fits a narrow viewport.');
  if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT.replace('.png','-library-mobile.png'),(await window.webContents.capturePage()).toPNG());
  window.setContentSize(1440,1080);await delay(100);
  if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT.replace('.png','-library.png'),(await window.webContents.capturePage()).toPNG());
  await evaluate("void(window.libraryAudio=document.querySelector('.library-player audio'))");
  await selectView('beat');await wait("window.libraryAudio.paused");
  assert.equal(await evaluate("document.querySelector('.song-library')"),null);
  await click('Band stage');
  await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount==='1'");
  assert.ok(await evaluate("document.querySelector('.performance-transport').textContent.includes('140 BPM')"),'Beat Studio stage uses the current beat');
  await click('Close band stage');
  await wait("!(document.querySelector('#performance-stage')?.getAttribute('data-state') === 'open')");
  await exportSong();
  await wait("document.querySelector('.producer-header').textContent.includes('Exported and saved to library.')");
  await selectView('library');await wait("document.querySelectorAll('.library-card').length>=1");
  assert.equal(await evaluate("document.querySelectorAll('.library-song-tag[data-song-type=instrumental]').length"),instrumentalsBefore+1,'Beat export adds an instrumental tag despite saved lyrics');
  assert.equal(await evaluate("document.querySelector('[aria-controls=performance-stage]').disabled"),true,'Returning to the library requires a new selection');
  assert.equal(await evaluate("document.querySelector('.library-player audio').paused"),true);
  console.log(`${cloud?'Cloud browser':'Desktop'} music smoke passed: WAV upload, extracted chunks, lyric edits, AI lyrics, full and selective generation, decoded playback, original-version switching, historical chunk retries, download, and preserved conflicting draft.`);
 }catch(error){if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT,(await window.webContents.capturePage()).toPNG());console.error(error);console.error('Stage state:',await evaluate("JSON.stringify({stage:(document.querySelector('#performance-stage')?.getAttribute('data-state') === 'open'),overlay:document.querySelector('.performance-overlay')?.textContent,canvases:[...document.querySelectorAll('.performance-viewport canvas')].map(c=>({...c.dataset})),description:document.querySelector('#performance-description')?.textContent,selected:document.querySelector('.library-card[aria-pressed=true]')?.textContent,visibility:document.visibilityState})"));console.error('Fixture state:',{uploaded:uploaded?.length,operations:await store.operations()});exitCode=1;}
 finally{clearTimeout(timer);window.destroy();api.close();web.close();await rm(root,{recursive:true,force:true});app.exit(exitCode);}
}
void app.whenReady().then(run);
