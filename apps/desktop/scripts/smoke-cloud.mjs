import { enterStudio } from "./smoke-startup.mjs";
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serveApp } from '../dist/static-app.js';
const source='tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain .6; }';
let revision=1,saved=source;
const projectId='00000000-0000-4000-8000-000000000001';
const timer=setTimeout(()=>{console.error('Cloud smoke timed out');app.exit(1);},60000);
async function run() {
const directory=await mkdtemp(join(tmpdir(),'banger-cloud-ui-'));
const api=createServer(async(request,response)=>{
  response.setHeader('Access-Control-Allow-Origin',request.headers.origin ?? '*');
  response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, OPTIONS');
  response.setHeader('Content-Type','application/json');
  if(request.method==='OPTIONS'){response.end();return;}
  assert.equal(request.headers.authorization,undefined,'Browser API requests use the same-origin session, not a pasted bearer token.');
  const url=new URL(request.url,'http://localhost');
  const json=(body,status=200)=>{response.statusCode=status;response.end(JSON.stringify(body));};
  if(url.pathname==='/api/session'){json({authenticated:true,signInEnabled:true,services:{storage:true}});return;}
  if(url.pathname==='/api/projects'){json({projects:[{id:projectId,name:'Cloud fixture',revision}]});return;}
  if(url.pathname.endsWith('/music')){json({music:[]});return;}
  if(url.pathname.endsWith('/jobs')){json({jobs:[]});return;}
  if(url.pathname.endsWith('/artifacts')){json({artifacts:[]});return;}
  if(request.method==='PATCH'){
    let body='';for await(const chunk of request)body+=chunk;
    const input=JSON.parse(body);
    if(input.baseRevision!==revision){json({error:'Another edit was saved first.'},409);return;}
    saved=input.changes[0].source;revision++;json({revision});return;
  }
  json({projectId,name:'Cloud fixture',revision,files:Number(url.searchParams.get('since'))===revision?[]:[{path:'song.banger',source:saved}],deleted:[]});
});
const web=createServer(async(request,response)=>{
  if(request.url.startsWith('/api/')){
    const parts=[];for await(const part of request)parts.push(part);
    const upstream=await fetch(`http://127.0.0.1:${api.address().port}${request.url}`,{method:request.method,headers:request.headers,...(!['GET','HEAD'].includes(request.method)?{body:Buffer.concat(parts)}:{})});
    response.writeHead(upstream.status,Object.fromEntries(upstream.headers));response.end(Buffer.from(await upstream.arrayBuffer()));return;
  }
  const result=await serveApp(new Request(`banger://app${request.url}`),resolve('../www/out'));
  const headers=Object.fromEntries(result.headers);headers['content-security-policy']=headers['content-security-policy'].replace("connect-src 'self'",`connect-src 'self' http://127.0.0.1:${api.address().port}`);response.writeHead(result.status,headers);response.end(Buffer.from(await result.arrayBuffer()));
});
await Promise.all([new Promise(resolve=>api.listen(0,'127.0.0.1',resolve)),new Promise(resolve=>web.listen(0,'127.0.0.1',resolve))]);
const window=new BrowserWindow({width:1440,height:1080,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
window.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});
const evaluate=async code=>{try{return await window.webContents.executeJavaScript(code,true);}catch(error){console.error('Browser action failed:',code);throw error;}};
const wait=expression=>evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+15000;const poll=()=>{if(${expression})resolve();else if(Date.now()>end)reject(new Error('Timed out: '+${JSON.stringify(expression)}));else setTimeout(poll,50);};poll();})`);
const click=text=>evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(text)}).click()`);
const fill=(selector,value)=>evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
try {
  await window.loadURL(`http://127.0.0.1:${web.address().port}`);await enterStudio(window);
  console.log('Loaded cloud fixture');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await wait("document.querySelector('details.project-workspace')");
  await evaluate("window.confirm=()=>true;document.querySelector('details.project-workspace').open=true");
  assert.equal(await evaluate("document.querySelector('details.project-workspace input[type=url]')"),null);
  await wait("document.querySelector('details.project-workspace select')");

  await wait("document.querySelector('#cloud-source')?.value.includes('tempo 120')");
  await fill('#cloud-source',source.replace('120','100'));
  revision=2;saved=source.replace('120','90');
  await wait("document.querySelector('details.project-workspace').textContent.includes('Saved revision 2')");
  assert.match(await evaluate("document.querySelector('#cloud-source').value"),/tempo 100/,'Remote changes preserve the draft');
  if (process.env.BANGER_CLOUD_SCREENSHOT) {
    await evaluate("document.querySelector('details.project-workspace').scrollIntoView({block:'start',behavior:'instant'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await writeFile(process.env.BANGER_CLOUD_SCREENSHOT,(await window.webContents.capturePage()).toPNG());
  }
  await click('Save cloud file');
  await wait("document.querySelector('details.project-workspace').textContent.includes('Another edit was saved first')");
  assert.equal(revision,2);
  await click('Reload saved file');
  await wait("document.querySelector('#cloud-source').value.includes('tempo 90')");
  await fill('#cloud-source','invalid music');await click('Save cloud file');
  await wait("document.querySelector('details.project-workspace button').disabled===false");
  assert.equal(revision,2,'Invalid music cannot save');
  await click('Reload saved file');
  await wait("document.querySelector('#cloud-source').value.includes('tempo 90')");
  await click('Load cloud file in studio');
  await wait("document.querySelector('#producer-source').value.includes('tempo 90')");
  assert.ok(await evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent==='Upload WAV to cloud')"));
  const download=new Promise((resolve,reject)=>window.webContents.session.once('will-download',(_event,item)=>{const path=join(directory,item.getFilename());item.setSavePath(path);item.once('done',(_event,state)=>state==='completed'?resolve(path):reject(new Error(state)));}));
  await evaluate("document.querySelector('.studio-export').open=true");await click('Export WAV');console.log('Rendering WAV');
  const bytes=await readFile(await download);
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');assert.ok(bytes.length>44);assert.ok(bytes.subarray(44).some(value=>value!==0));
  console.log('Cloud browser smoke passed: connection, revision polling, preserved draft, 409 conflict, compile validation, studio binding and real WAV download.');
} catch(error){console.error(error);process.exitCode=1;}
finally{clearTimeout(timer);window.destroy();api.close();web.close();await rm(directory,{recursive:true,force:true});app.exit(process.exitCode ?? 0);}

}
void app.whenReady().then(run);
