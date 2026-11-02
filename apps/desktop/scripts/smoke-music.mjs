import {Buffer} from 'node:buffer';
import assert from 'node:assert/strict';
import {app,BrowserWindow,dialog,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {serveApp} from '../dist/static-app.js';
import {createMusicStore} from '../dist/elevenlabs-music.js';
import {installMusicHandlers} from '../dist/elevenlabs-ipc.js';
import {fixtureProvider,wav,fixturePlan} from '../../../packages/elevenlabs/test/fixtures.mjs';
const cloud=process.argv.includes('--web');
app.on('window-all-closed',()=>{});
const root=await mkdtemp(join(tmpdir(),'banger-music-ui-'));app.setPath('userData',root);
const timer=setTimeout(()=>{console.error('Music smoke timed out');app.exit(1);},90000);
const projectId=randomUUID(),artifactId=randomUUID();const source='tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain .6; }';
// fixture.mp3 is the synthesized WAV from fixtures.mjs encoded with libmp3lame at 32 kbps.
const finalAudio=await readFile(new URL('../../../packages/elevenlabs/test/fixture.mp3',import.meta.url));
const generatedInputs=[];const provider=fixtureProvider(),generate=provider.generate;provider.generate=async(version,indices)=>{generatedInputs.push({version,indices});return {...await generate(version),audio:finalAudio};};
const store=createMusicStore(join(root,'music'),()=>provider);let uploaded,window,exitCode=0;
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
   assert.equal(request.headers.authorization,'Bearer fixture-token');
   if(url.pathname==='/api/projects')return json({projects:[{id:projectId,name:'Music project',revision:1}]});
   if(url.pathname===`/api/projects/${projectId}`)return json({projectId,revision:1,name:'Music project',files:url.searchParams.has('since')?[]:[{path:'song.banger',source}],deleted:[]});
   if(url.pathname.endsWith('/music'))return json({music:await store.list()});
   if(url.pathname.endsWith('/artifacts'))return request.method==='POST'?json({id:artifactId,pathname}):json({artifacts:[]});
   if(url.pathname==='/api/uploads'){
    const input=body();assert.equal(input.payload.pathname,pathname);assert.equal(JSON.parse(input.payload.clientPayload).artifactId,artifactId);
    const payload=Buffer.from(JSON.stringify({pathname,validUntil:Date.now()+600000,maximumSizeInBytes:104857600,allowedContentTypes:['audio/wav']})).toString('base64');
    return json({clientToken:'vercel_blob_client_fixture_'+Buffer.from('signature.'+payload).toString('base64')});
   }
   if(url.pathname.endsWith('/complete')){assert.deepEqual(uploaded,wav());return json({id:artifactId,status:'ready'});}
   if(url.pathname.endsWith('/jobs')){if(request.method==='GET')return json({jobs:(await store.operations()).map(job)});return json(job(await store.importWav(uploaded,'Uploaded song',body().idempotencyKey)),202);}
   if(url.pathname.endsWith('/resume'))return json({});
   if(url.pathname.endsWith('/actions')){const input=body();return json(job(await store.act(url.pathname.split('/')[3],input.action,input.idempotencyKey)),202);}
   if(url.pathname.endsWith('/versions')){const history=await store.versions(url.pathname.split('/')[3],url.searchParams.has('before')?Number(url.searchParams.get('before')):undefined);return json({...history,versions:history.versions.map(document=>({revision:document.version,document}))});}
   if(url.pathname.startsWith('/api/music/'))return json(await store.get(url.pathname.split('/')[3]));
   if(url.pathname.startsWith('/api/artifacts/')){const selected=(await store.list())[0];const history=await store.versions(selected.id);const version=[history.original,...history.versions].find(item=>item.audioId===url.pathname.split('/')[3]);assert.ok(version);const audio=await store.audio(selected.id,version.version);response.setHeader('Content-Type',audio.contentType);response.end(audio.bytes);return;}
   return json({error:'Unknown fixture route'},404);
  }catch(error){if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT,(await window.webContents.capturePage()).toPNG());console.error(error);return json({error:error.message},500);}
 });
 const web=createServer(async(request,response)=>{
  const result=await serveApp(new Request(`banger://app${request.url}`),resolve('../www/out'));
  const headers=Object.fromEntries(result.headers);headers['content-security-policy']=headers['content-security-policy'].replace("connect-src 'self'",`connect-src 'self' http://127.0.0.1:${api.address().port} https://vercel.com`);response.writeHead(result.status,headers);
  let content=Buffer.from(await result.arrayBuffer());
  // Buffer only the Blob fixture transport: Chromium streaming fetch requires HTTP/2.
  if(cloud&&request.url==='/')content=Buffer.from(content.toString().replace('<head>',`<head><script>(()=>{const original=window.fetch.bind(window);window.fetch=async(url,options)=>{if(String(url).startsWith('https://vercel.com/api/blob')){const init={...options};if(init.body instanceof ReadableStream){init.body=await new Response(init.body).arrayBuffer();delete init.duplex;}return original('http://127.0.0.1:${api.address().port}/blob'+new URL(url).search,init);}return original(url,options);};})();</script>`));
  response.end(content);
 });
 await Promise.all([new Promise(resolve=>api.listen(0,'127.0.0.1',resolve)),new Promise(resolve=>web.listen(0,'127.0.0.1',resolve))]);
 window=new BrowserWindow({width:1440,height:1080,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,...(!cloud?{preload:resolve('dist/preload.cjs')}:{})}});
 if(!cloud){
  installMusicHandlers(event=>{assert.equal(event.senderFrame,window.webContents.mainFrame);return window;},store);
  ipcMain.handle('banger:ai-load',()=>({activeProvider:null,providers:{}}));
  ipcMain.handle('banger:local-status',()=>({phase:'idle',selected:false}));
  ipcMain.handle('banger:chatgpt-status',()=>({accounts:[],models:[],connected:false}));
  await writeFile(join(root,'input.wav'),wav());dialog.showOpenDialog=async()=>({canceled:false,filePaths:[join(root,'input.wav')]});dialog.showSaveDialog=async()=>({canceled:false,filePath:join(root,'final.mp3')});
 }
 if(process.env.BANGER_MUSIC_DEBUG){
  window.webContents.on('console-message',event=>console.log('Browser:',event.message));
  window.webContents.session.webRequest.onErrorOccurred(details=>console.log('Network error',details.url,details.error));
  window.webContents.session.webRequest.onCompleted(details=>{if(details.url.includes('/blob'))console.log('Blob response',details.statusCode);});
 }
 const evaluate=code=>window.webContents.executeJavaScript(code,true);
 const wait=async expression=>{for(let i=0;i<400;i++){if(await evaluate(`Boolean(${expression})`))return;await delay(40);}throw new Error(`UI timeout: ${expression}; ${await evaluate("document.querySelector('.music-workshop')?.textContent")}`);};
 const click=async text=>{await wait(`[...document.querySelectorAll('button')].some(b=>(b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)})&&!b.disabled)`);return evaluate(`[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)})&&!b.disabled).click()`);};
 const fill=(selector,value)=>evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
 try{
  await window.loadURL(`http://127.0.0.1:${web.address().port}`);await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  if(cloud){
   await wait("document.querySelector('details.project-workspace input[type=url]')");await evaluate("document.querySelector('details.project-workspace').open=true");
   await fill('details.project-workspace input[type=url]',`http://127.0.0.1:${api.address().port}`);await fill('details.project-workspace input[type=password]','fixture-token');await click('Connect cloud projects');
   await wait("document.querySelector('details.project-workspace select')");await fill('details.project-workspace select',projectId);
  }
  await click('ElevenLabs');await wait("document.querySelector('#studio-tab-elevenlabs').getAttribute('aria-selected')==='true'");
  assert.equal(await evaluate("!!document.querySelector('.music-workshop .music-lyric-composer')"),true);
  if(cloud){await wait("document.querySelector('.music-workshop input[type=file]')");await evaluate(`(()=>{const file=new File([Uint8Array.from(atob(${JSON.stringify(wav().toString('base64'))}),c=>c.charCodeAt(0))],'input.wav',{type:'audio/wav'});const data=new DataTransfer();data.items.add(file);const input=document.querySelector('.music-workshop input[type=file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
  else await click('↑ Upload WAV');
  await wait("document.querySelectorAll('.music-chunk').length===2");
  const id=(await store.list())[0].id;assert.deepEqual((await store.get(id)).plan,fixturePlan);
  await fill('[aria-label="Lyrics for chunk 1"]','We write our own tomorrow');await click('Save lyrics');
  await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 2')");assert.equal(await evaluate("document.querySelector('[aria-label=\"Lyrics for chunk 1\"]').value"),'We write our own tomorrow');
  assert.deepEqual({...((await store.get(id)).plan.chunks[0]),text:fixturePlan.chunks[0].text},fixturePlan.chunks[0]);
  await fill('#music-lyric-prompt','A hopeful morning');await click('Generate lyrics for selected chunks');await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 3')");
  await click('Generate new variation');await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 4')");
  await click('Retry chunk 1');await wait("document.querySelector('.music-workshop').textContent.includes('Composition version 5')");
  await click('Play song');await wait("document.querySelector('.music-workshop audio')?.duration>7");
  await evaluate("(()=>{const audio=document.querySelector('.music-workshop audio');audio.muted=true;return audio.play();})()");await wait("document.querySelector('.music-workshop audio').currentTime>0");
  const download=cloud?new Promise((resolve,reject)=>window.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(join(root,'final.mp3'));item.once('done',(_event,state)=>state==='completed'?resolve():reject(new Error(state)));})):null;
  await click('↓ Download');if(download)await download;else for(let i=0;i<100;i++){try{await readFile(join(root,'final.mp3'));break;}catch{await delay(20);}}
  assert.deepEqual(await readFile(join(root,'final.mp3')),finalAudio);assert.deepEqual(provider.calls,{analyze:1,lyrics:1,generate:2});
  assert.equal(await evaluate("document.querySelectorAll('.music-chunk .producer-tag,.music-chunk details').length"),0);
  assert.equal(await evaluate("document.querySelectorAll('.music-timeline-chunks button').length"),2);
  await fill('[aria-label="Seek song"]','4.5');assert.ok(await evaluate("document.querySelector('.music-workshop audio').currentTime>=4"));
  await click('Pause song');await click('Play Original WAV');
  await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 1')");
  await wait("document.querySelector('.music-workshop audio').currentTime>0&&!document.querySelector('.music-workshop audio').paused");
  const original=await evaluate("fetch(document.querySelector('.music-workshop audio').src).then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(hash=>Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''))");assert.equal(original,createHash('sha256').update(wav()).digest('hex'));
  await click('Retry chunk 2');await wait("document.querySelector('.music-editor-heading').textContent.includes('Composition version 6')");
  assert.equal(generatedInputs.at(-1).version.songId,'original-song');assert.deepEqual(generatedInputs.at(-1).indices,[1]);assert.deepEqual(generatedInputs.at(-1).version.plan,fixturePlan);
  await click('Play song');await wait("document.querySelector('.music-workshop audio').currentTime>0");await click('Sequencer');await wait("document.querySelector('.music-workshop audio').paused");await click('ElevenLabs');
  // A newer server revision cannot silently erase a draft.
  await fill('[aria-label="Lyrics for chunk 1"]','Unsaved local draft');await store.act(id,{operation:'edit',baseVersion:6,edits:[{index:0,lyrics:'External edit'}]},randomUUID());
  await wait("document.querySelector('.music-workshop').textContent.includes('Your lyric draft is preserved')");assert.equal(await evaluate("document.querySelector('[aria-label=\"Lyrics for chunk 1\"]').value"),'Unsaved local draft');
  if(process.env.BANGER_MUSIC_SCREENSHOT){await evaluate("window.scrollTo(0,0);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");await writeFile(process.env.BANGER_MUSIC_SCREENSHOT,(await window.webContents.capturePage()).toPNG());}
  await wait("document.querySelectorAll('.music-timeline-chunks svg rect').length>100");
  await click('Preview chunk 1');await wait("!document.querySelector('.music-workshop audio').paused");
  await wait("document.querySelector('.music-workshop audio').paused&&document.querySelector('.music-workshop audio').currentTime>=4&&document.querySelector('.music-workshop audio').currentTime<5");
  window.setContentSize(390,844);await delay(200);
  assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),'Music tab fits a narrow viewport.');
  if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT.replace('.png','-mobile.png'),(await window.webContents.capturePage()).toPNG());
  console.log(`${cloud?'Cloud browser':'Desktop'} music smoke passed: WAV upload, extracted chunks, lyric edits, AI lyrics, full and selective generation, decoded playback, original-version switching, historical chunk retries, download, and preserved conflicting draft.`);
 }catch(error){if(process.env.BANGER_MUSIC_SCREENSHOT)await writeFile(process.env.BANGER_MUSIC_SCREENSHOT,(await window.webContents.capturePage()).toPNG());console.error(error);console.error('Fixture state:',{uploaded:uploaded?.length,operations:await store.operations()});exitCode=1;}
 finally{clearTimeout(timer);window.destroy();api.close();web.close();await rm(root,{recursive:true,force:true});app.exit(exitCode);}
}
void app.whenReady().then(run);
