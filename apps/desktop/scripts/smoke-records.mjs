import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { app } from 'electron';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { wav as shortWav } from '../../../packages/elevenlabs/test/fixtures.mjs';
function wav() { const short=shortWav(), bytes=Buffer.concat([short,short.subarray(44),short.subarray(44),short.subarray(44)]);bytes.writeUInt32LE(bytes.length-8,4);bytes.writeUInt32LE(bytes.length-44,40);return bytes; }
import { enterStudio } from './smoke-startup.mjs';
const profile=await mkdtemp(join(tmpdir(),'banger-records-smoke-'));
app.setPath('userData',profile);app.once('will-quit',()=>{void rm(profile,{recursive:true,force:true});});
const id='12345678-1234-1234-1234-123456789abc', name='After midnight';
await mkdir(join(profile,'records'),{recursive:true});
const record={id,name,context:{name},attempts:0};
await writeFile(join(profile,'records',`${id}.json`),JSON.stringify(record));
for(const song of ['First light','Open skies']){
 const folder=join(profile,'library',song);await mkdir(folder,{recursive:true});
 await writeFile(join(folder,`${song}.wav`),wav(20));
 await writeFile(join(folder,`${song}.library.json`),JSON.stringify({songType:'instrumental',record:{id,name}}));
}
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1sAAAAASUVORK5CYII=';
const timeout=setTimeout(()=>{console.error('Record smoke timed out');app.exit(1);},90000);
app.on('browser-window-created',(_event,window)=>window.webContents.once('did-finish-load',async()=>{
 const evaluate=code=>window.webContents.executeJavaScript(code,true);
 const wait=async(code,label)=>{for(let i=0;i<400;i++){if(await evaluate(`Boolean(${code})`))return;await delay(30);}throw new Error(`Timed out: ${label}`);};
 try{
  await enterStudio(window);window.setContentSize(1200,900);window.show();
  await evaluate(`document.querySelector('.app-sidebar-nav button[aria-label="Library"]').click()`);
  await wait(`document.querySelectorAll('.library-card').length===2`,'two songs');
  assert.equal(await evaluate(`document.querySelectorAll('.library-record').length`),1);
  assert.equal(await evaluate(`document.querySelectorAll('.library-art img').length`),0);
  await evaluate(`document.querySelector('[aria-label="Play First light"]').click()`);
  await wait(`document.querySelector('.library-player audio').currentTime>0`,'playback');
  await evaluate(`window.events=[];for(const type of ['pause','emptied'])document.querySelector('.library-player audio').addEventListener(type,()=>window.events.push(type))`);
  await writeFile(join(profile,'records',`${id}.json`),JSON.stringify({...record,artwork:png}));
  await wait(`document.querySelectorAll('.library-art img').length===1`,'cover arrives automatically');
  assert.deepEqual(await evaluate('window.events'),[]);
  assert.equal(await evaluate(`document.querySelector('.library-art').offsetWidth===document.querySelector('.library-art').offsetHeight`),true);
  await evaluate(`document.querySelector('[aria-label="Play Open skies"]').click()`);
  await wait(`document.querySelector('.library-now-playing strong').textContent==='Open skies'`,'second song');
  // Exercise browser records through their actual IndexedDB schema and refresh path.
  await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('banger-library',2);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['songs','records'],'readwrite');tx.objectStore('records').put({id:'browser-record',name:'Browser record',attempts:3,context:{name:'Browser record'}});for(const name of ['Browser one','Browser two'])tx.objectStore('songs').put({id:name,recordId:'browser-record',name,wav:Uint8Array.from(atob(${JSON.stringify(wav(20).toString('base64'))}),c=>c.charCodeAt(0)).buffer,files:{}});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}})`);
  await wait(`document.querySelectorAll('.library-record').length===2 && document.querySelectorAll('.library-card').length===4`,'browser record grouping');
  await evaluate(`new Promise(resolve=>{const r=indexedDB.open('banger-library',2);r.onsuccess=()=>{const db=r.result,tx=db.transaction('records','readwrite');tx.objectStore('records').put({id:'browser-record',name:'Browser record',attempts:1,context:{name:'Browser record'},artwork:${JSON.stringify(png)}});tx.oncomplete=()=>{db.close();resolve()}}})`);
  await wait(`document.querySelectorAll('.library-art img').length===2`,'browser cover arrives');
  await wait(`[...document.querySelectorAll('.library-art img')].every(image=>image.complete && image.naturalWidth>0)`,'images decoded');
  await delay(100);
  await writeFile('/tmp/banger-records.png',(await window.webContents.capturePage()).toPNG());
  window.setContentSize(430,900);
  await delay(100);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'));
  console.log('Record smoke passed: native and browser grouping, shared square artwork, automatic refresh, uninterrupted playback, and mobile layout.');clearTimeout(timeout);app.exit(0);
 }catch(error){console.error(error);await writeFile('/tmp/banger-records-failure.png',(await window.webContents.capturePage()).toPNG());clearTimeout(timeout);app.exit(1);}
}));
await import('../dist/main.js');
