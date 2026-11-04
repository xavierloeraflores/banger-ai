import { enterStudio } from "./smoke-startup.mjs";
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
app.on('window-all-closed',()=>{});
const root=await mkdtemp(join(tmpdir(),'banger-music-ui-'));app.setPath('userData',root);
const timer=setTimeout(()=>{console.error('Music smoke timed out');app.exit(1);},150000);
const projectId=randomUUID(),artifactId=randomUUID();const source='tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain .6; }';
// fixture.mp3 is the synthesized WAV from fixtures.mjs encoded with libmp3lame at 32 kbps.
const finalAudio=await readFile(new URL('../../../packages/elevenlabs/test/fixture.mp3',import.meta.url));
const generatedInputs=[];const provider=fixtureProvider(),generate=provider.generate;provider.generate=async(version,indices)=>{generatedInputs.push({version,indices});return {...await generate(version),audio:finalAudio};};
const store=createMusicStore(join(root,'music'),()=>provider,musicStorageHooks(createSongStorage(root)));let uploaded,window,exitCode=0;
const pathname=`projects/${projectId}/audio/${artifactId}.wav`;
const job=operation=>({...operation,kind:'elevenlabs',activity:[],result:operation.status==='completed'?{musicId:operation.musicId,version:operation.resultVersion}:null});
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
   if(url.pathname===`/api/projects/${projectId}`)return json({projectId,revision:1,name:'Music project',files:url.searchParams.has('since')?[]:[{path:'song.banger',source}],deleted:[]});
   if(url.pathname.endsWith('/music'))return json({music:await store.list()});
   if(url.pathname.endsWith('/artifacts'))return request.method==='POST'?json({id:artifactId,pathname}):json({artifacts:[]});
   if(url.pathname==='/api/uploads'){
    const input=body();assert.equal(input.payload.pathname,pathname);assert.equal(JSON.parse(input.payload.clientPayload).artifactId,artifactId);
    const payload=Buffer.from(JSON.stringify({pathname,validUntil:Date.now()+600000,maximumSizeInBytes:104857600,allowedContentTypes:['audio/wav']})).toString('base64');
    return json({clientToken:'vercel_blob_client_fixture_'+Buffer.from('signature.'+payload).toString('base64')});
   }
   if(url.pathname.endsWith('/complete')){assert.ok(uploaded?.length);return json({id:artifactId,status:'ready'});}
   if(url.pathname.endsWith('/jobs')){if(request.method==='GET')return json({jobs:(await store.operations()).map(job)});assert.equal(request.headers['x-banger-elevenlabs-key'],'fake-vocal-key');return json(job(await store.importWav(uploaded,body().input?.beat?.name??'Uploaded song',body().idempotencyKey,undefined,body().input?.beat)),202);}
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
  installWorkspaceHandlers({senderWindow,onOpen:(window,root)=>storage.setRoot(window,root),selectModel:async()=>{throw new Error('Music smoke must not request a project model');}});
  installMusicHandlers(event=>{assert.equal(event.senderFrame,window.webContents.mainFrame);return window;},store,storage);
  let vocalsConfigured=true;
  ipcMain.handle('banger:ai-load',()=>({activeProvider:'openai',providers:{openai:{model:'fixture',configured:true}},elevenLabsConfigured:vocalsConfigured}));
  ipcMain.handle('banger:elevenlabs-save',()=>{vocalsConfigured=true;});
  ipcMain.handle('banger:elevenlabs-remove',()=>{vocalsConfigured=false;});
  ipcMain.handle('banger:lyrics',(_event,request)=>({ok:true,edits:request.chunks.map(chunk=>({index:chunk.index,lyrics:'Tomorrow brings the light'}))}));
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
 const wait=async expression=>{for(let i=0;i<400;i++){if(await evaluate(`Boolean(${expression})`))return;await delay(40);}throw new Error(`UI timeout: ${expression}; ${await evaluate("document.querySelector('.music-workshop')?.textContent")}`);};
 const click=async text=>{await wait(`[...document.querySelectorAll('button')].some(b=>(b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)})&&!b.disabled)`);return evaluate(`[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)})&&!b.disabled).click()`);};
 const fill=(selector,value)=>evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
 try{
  await window.loadURL(`http://127.0.0.1:${web.address().port}`);await enterStudio(window);await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  if(cloud){
   await evaluate(`sessionStorage.setItem('banger.ai-settings.v1', JSON.stringify({activeProvider:'vercel',providers:{vercel:{model:'fixture',key:'fake-llm-key'}},elevenLabsKey:'fake-vocal-key'})); window.dispatchEvent(new Event('banger:ai-settings-changed'));
     const originalFetch=window.fetch;window.fetch=async(url,options)=>{
       if(String(url).startsWith('https://ai-gateway.vercel.sh/')){
         if(new Headers(options.headers).get('authorization')!=='Bearer fake-llm-key')throw new Error('Wrong LLM key');
         const input=JSON.parse(JSON.parse(options.body).prompt.at(-1).content.find(part=>part.type==='text').text);
         return Response.json({content:[{type:'text',text:JSON.stringify(input.chunks.map(chunk=>({index:chunk.index,lyrics:'Tomorrow brings the light'})))}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:10},outputTokens:{total:10}},warnings:[]});
       }
       return originalFetch(url,options);
     }; undefined;`);
   await wait("document.querySelector('details.project-workspace')");await evaluate("document.querySelector('details.project-workspace').open=true");
   await wait("document.querySelector('details.project-workspace select')");
  }
  await click('Mixer');
  assert.equal(await evaluate("document.querySelectorAll('.producer-tabs [role=tab]').length"),4);
  await evaluate(`(() => { const select = document.querySelector('[aria-label="View"]'); select.value = 'vocal'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);await wait("document.querySelector('.producer').dataset.view==='vocal'");
  assert.equal(await evaluate("document.querySelector('.producer-tabs').checkVisibility()"),false);
  assert.equal(await evaluate("document.querySelector('[aria-label=\"View\"]').options.length===3"),true);
  await evaluate(`(() => { const select = document.querySelector('[aria-label="View"]'); select.value = 'beat'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);await wait("document.querySelector('#studio-tab-mixer').getAttribute('aria-selected')==='true'");
  assert.equal(await evaluate("document.querySelector('#studio-panel-mixer').checkVisibility()"),true);
  await evaluate(`(() => { const select = document.querySelector('[aria-label="View"]'); select.value = 'vocal'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.equal(await evaluate("!!document.querySelector('.music-workshop .music-lyric-composer')"),true);
  await wait("document.querySelectorAll('.music-empty .music-wav-actions button').length===2");
  assert.equal(await evaluate("document.querySelectorAll('.music-heading button').length"),0);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT.replace('.png','-empty.png'),(await window.webContents.capturePage()).toPNG());
  if(cloud){await wait("document.querySelector('.music-workshop input[type=file]')");await evaluate(`(()=>{const file=new File([Uint8Array.from(atob(${JSON.stringify(wav().toString('base64'))}),c=>c.charCodeAt(0))],'input.wav',{type:'audio/wav'});const data=new DataTransfer();data.items.add(file);const input=document.querySelector('.music-workshop input[type=file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
  else await click('↑ Upload WAV');
  await wait("document.querySelectorAll('.music-chunk').length===2");
  assert.equal(await evaluate("document.querySelector('.music-empty')"),null);
  assert.equal(await evaluate("!!document.querySelector('[aria-controls=performance-stage]')"),false,'Uploaded vocals without a beat hide Band stage');
  assert.equal(await evaluate("document.querySelectorAll('.music-replace-wav button').length"),2);
  assert.equal(await evaluate("document.querySelectorAll('.music-heading button').length"),0);
  const id=(await store.list())[0].id;assert.deepEqual((await store.get(id)).plan,fixturePlan);
  // Invalid drafts stay editable and never enable a save in either backend.
  const lyricSelector='[aria-label="Lyrics for chunk 1"]';
  for(const invalid of ['a'.repeat(201),Array(30).fill('words').join('\n'),'[Verse]\nwords']){
   await fill(lyricSelector,invalid);
   await wait("document.querySelector('[aria-label=\"Lyrics for chunk 1\"]').getAttribute('aria-invalid')==='true'");
   assert.ok(await evaluate("document.querySelector('#music-lyric-help-0[role=alert]').textContent.length>0"));
   assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Save lyrics').disabled"),true);
   assert.equal((await store.get(id)).version,1);
  }
  await fill(lyricSelector,Array(29).fill('a'.repeat(200)).join('\n'));
  await wait("document.querySelector('[aria-label=\"Lyrics for chunk 1\"]').getAttribute('aria-invalid')==='false'");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Save lyrics').disabled"),false);
  await fill('[aria-label="Lyrics for chunk 1"]','We write our own tomorrow');await click('Save lyrics');
  await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 2')");assert.equal(await evaluate("document.querySelector('[aria-label=\"Lyrics for chunk 1\"]').value"),'We write our own tomorrow');
  assert.deepEqual({...((await store.get(id)).plan.chunks[0]),text:fixturePlan.chunks[0].text},fixturePlan.chunks[0]);
  await evaluate(`(async()=>{if(window.bangerAI)await window.bangerAI.removeElevenLabs();else{const settings=JSON.parse(sessionStorage.getItem('banger.ai-settings.v1'));delete settings.elevenLabsKey;sessionStorage.setItem('banger.ai-settings.v1',JSON.stringify(settings));}window.dispatchEvent(new Event('banger:ai-settings-changed'));})()`);
  await wait("document.querySelector('[aria-label=\"Generate new variation\"]').disabled");
  await fill('#music-lyric-prompt','A hopeful morning');await click('Generate lyrics for selected chunks');await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 3')");
  assert.equal(provider.calls.lyrics,0,'LLM lyrics must not call ElevenLabs');
  await evaluate(`(async()=>{if(window.bangerAI)await window.bangerAI.saveElevenLabs('fake-vocal-key');else{const settings=JSON.parse(sessionStorage.getItem('banger.ai-settings.v1'));settings.elevenLabsKey='fake-vocal-key';sessionStorage.setItem('banger.ai-settings.v1',JSON.stringify(settings));}window.dispatchEvent(new Event('banger:ai-settings-changed'));})()`);
  await wait("!document.querySelector('[aria-label=\"Generate new variation\"]').disabled");
  await click('Generate new variation');await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 4')");
  await click('Retry chunk 1');await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 5')");
  await click('Play song');await wait("document.querySelector('.music-workshop audio')?.duration>7");
  await evaluate("(()=>{const audio=document.querySelector('.music-workshop audio');audio.muted=true;return audio.play();})()");await wait("document.querySelector('.music-workshop audio').currentTime>0");
  const download=cloud?new Promise((resolve,reject)=>window.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(join(root,'final.mp3'));item.once('done',(_event,state)=>state==='completed'?resolve():reject(new Error(state)));})):null;
  await fill('.music-workshop [aria-label="Export song"]','library');if(download)await download;else for(let i=0;i<100;i++){try{await readFile(join(root,'final.mp3'));break;}catch{await delay(20);}}
  assert.deepEqual(await readFile(join(root,'final.mp3')),finalAudio);assert.deepEqual(provider.calls,{analyze:1,lyrics:0,generate:2});
  assert.equal(await evaluate("document.querySelectorAll('.music-chunk .producer-tag,.music-chunk details').length"),0);
  assert.equal(await evaluate("document.querySelectorAll('.music-timeline-chunks button').length"),2);
  await fill('[aria-label="Seek song"]','4.5');assert.ok(await evaluate("document.querySelector('.music-workshop audio').currentTime>=4"));
  await click('Pause song');await click('Play Original WAV');
  await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 1')");
  await wait("document.querySelector('.music-workshop audio').currentTime>0&&!document.querySelector('.music-workshop audio').paused");
  const original=await evaluate("fetch(document.querySelector('.music-workshop audio').src).then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(hash=>Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''))");assert.equal(original,createHash('sha256').update(wav()).digest('hex'));
  await click('Retry chunk 2');await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 6')");
  assert.equal(generatedInputs.at(-1).version.songId,'original-song');assert.deepEqual(generatedInputs.at(-1).indices,[1]);assert.deepEqual(generatedInputs.at(-1).version.plan,fixturePlan);
  await click('Play song');await wait("document.querySelector('.music-workshop audio').currentTime>0");await evaluate(`(() => { const select = document.querySelector('[aria-label="View"]'); select.value = 'beat'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);await wait("document.querySelector('.music-workshop audio').paused");await evaluate(`(() => { const select = document.querySelector('[aria-label="View"]'); select.value = 'vocal'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  // A newer server revision cannot silently erase a draft.
  await fill('[aria-label="Lyrics for chunk 1"]','Unsaved local draft');await store.act(id,{operation:'edit',baseVersion:6,edits:[{index:0,lyrics:'External edit'}]},randomUUID());
  await wait("document.querySelector('.music-workshop').textContent.includes('Your lyric draft is preserved')");assert.equal(await evaluate("document.querySelector('[aria-label=\"Lyrics for chunk 1\"]').value"),'Unsaved local draft');
  if(process.env.BANGER_MUSIC_SCREENSHOT){await evaluate("window.scrollTo(0,0);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");await writeFile(process.env.BANGER_MUSIC_SCREENSHOT,(await window.webContents.capturePage()).toPNG());}
  await wait("document.querySelectorAll('.music-timeline-chunks svg rect').length>100");
  await click('Preview chunk 1');await wait("!document.querySelector('.music-workshop audio').paused");
  await wait("document.querySelector('.music-workshop audio').paused&&document.querySelector('.music-workshop audio').currentTime>=4&&document.querySelector('.music-workshop audio').currentTime<5");
  window.setContentSize(390,844);await delay(200);
  assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),'Vocal Studio fits a narrow viewport.');
  if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT.replace('.png','-mobile.png'),(await window.webContents.capturePage()).toPNG());
  {
   await evaluate('void(window.confirm=()=>true)');
   await evaluate(`(() => { const select = document.querySelector('[aria-label="View"]'); select.value = 'beat'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);await click('Raw .banger');await fill('#producer-source',source.replace('tempo 120','tempo 60'));await click('Apply source');await evaluate(`(() => { const select = document.querySelector('[aria-label="View"]'); select.value = 'vocal'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
   await evaluate(`(() => { const select = document.querySelector('[aria-label="View"]'); select.value = 'beat'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);assert.equal(await evaluate("document.querySelector('#studio-tab-source').getAttribute('aria-selected')"),'true');
   assert.ok((await evaluate("document.querySelector('#producer-source').value")).includes('tempo 60'));
   await evaluate(`(() => { const select = document.querySelector('[aria-label="View"]'); select.value = 'vocal'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
   await click('Use studio WAV');
   await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 1')");
   const imported=(await store.list()).find(song=>song.id!==id);assert.ok(imported,'Rendering the studio creates another song.');
   const rendered=await store.audio(imported.id,1);assert.equal(Buffer.from(rendered.bytes).subarray(0,4).toString(),'RIFF');
   assert.equal(provider.calls.analyze,2);
   assert.equal((await store.get(imported.id)).beat.source,source.replace('tempo 120','tempo 60'));
   await fill('[aria-label="View"]','beat');
   await fill('#producer-source',source.replace('tempo 120','tempo 140'));
   await click('Apply source');
   await fill('[aria-label="View"]','vocal');
   window.setContentSize(1440,1080);
   await click('Play song');
   await click('Band stage');
   await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount==='1'");
   assert.ok(await evaluate("document.querySelector('.performance-transport').textContent.includes('60 BPM')"),'Vocal stage uses its original beat, not later studio edits');
   await wait("document.querySelector('.music-workshop audio').paused");
   await click('Play band');
   await wait("document.querySelector('.performance-live').textContent==='LIVE'");
   await click('Close band stage');
   await wait("!document.querySelector('#performance-stage')?.open");
   assert.ok((await evaluate("document.querySelector('#producer-source').value")).includes('tempo 140'),'Stage preserves the studio draft');

   if(!cloud){
   const location=await store.location(imported.id);
   const saved=JSON.parse(await readFile(join(location.root,`${location.name}.lyrics.json`),'utf8'));
   assert.deepEqual(saved.audioMetadata,fixtureMetadata);assert.equal(saved.audioVersion,1);
   const originalLocation=await store.location(id);
   const generated=JSON.parse(await readFile(join(originalLocation.root,'.banger','history',originalLocation.name,'lyrics','lyrics-v005.json'),'utf8'));
   assert.deepEqual(generated.audioMetadata,generatedMetadata);assert.equal(generated.audioVersion,5);
   const draft=JSON.parse(await readFile(join(originalLocation.root,'.banger','history',originalLocation.name,'lyrics','lyrics-v003.json'),'utf8'));
   assert.deepEqual(draft.audioMetadata,fixtureMetadata);assert.equal(draft.audioVersion,1);
   }
  }
  // Library playback must leave both editors intact and release audio on exit.
  const selectView = value => fill('[aria-label="View"]',value);
  await selectView('library');
  await wait("document.querySelectorAll('.library-card').length>=1");
  assert.equal(await evaluate("!!document.querySelector('[aria-controls=performance-stage]')"),false,'No stale stage target before library selection');
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
   assert.equal(await evaluate("document.querySelector('.library-player audio').paused"),true);
   await click('Close band stage');
   await wait("!document.querySelector('#performance-stage')?.open");
  }
  // Export the associated vocal after changing Beat Studio, then open that saved beat.
  await selectView('vocal');
  await fill('.music-workshop [aria-label="Export song"]','library');
  await wait("document.querySelector('.music-status').textContent.includes('Exported and saved to library.')");
  await selectView('library');
  await wait("document.querySelectorAll('.library-card').length>=2");
  await evaluate("[...document.querySelectorAll('.library-card')].find(card=>!card.textContent.includes('Cover song')&&!card.textContent.includes('input')&&!card.textContent.includes('Uploaded song')).click()");
  await wait("document.querySelector('.library-player audio').currentTime>0 && !document.querySelector('.library-player button').disabled");
  await click('Band stage');
  await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount==='1'");
  assert.ok(await evaluate("document.querySelector('.performance-transport').textContent.includes('60 BPM')"),'Library vocal selection replaces the previous stage target');
  await click('Close band stage');
  await wait("!document.querySelector('#performance-stage')?.open");
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
  await wait("!document.querySelector('#performance-stage')?.open");
  await fill('.producer-transport [aria-label="Export song"]','library');
  await wait("document.querySelector('.producer-transport').textContent.includes('Exported and saved to library.')");
  await selectView('library');await wait("document.querySelectorAll('.library-card').length>=1");
  assert.equal(await evaluate("document.querySelector('.library-player audio').paused"),true);
  console.log(`${cloud?'Cloud browser':'Desktop'} music smoke passed: WAV upload, extracted chunks, lyric edits, AI lyrics, full and selective generation, decoded playback, original-version switching, historical chunk retries, download, and preserved conflicting draft.`);
 }catch(error){if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT,(await window.webContents.capturePage()).toPNG());console.error(error);console.error('Fixture state:',{uploaded:uploaded?.length,operations:await store.operations()});exitCode=1;}
 finally{clearTimeout(timer);window.destroy();api.close();web.close();await rm(root,{recursive:true,force:true});app.exit(exitCode);}
}
void app.whenReady().then(run);
