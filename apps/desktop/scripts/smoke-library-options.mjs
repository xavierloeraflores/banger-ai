import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { app } from 'electron';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { wav } from '../../../packages/elevenlabs/test/fixtures.mjs';
import { enterStudio } from './smoke-startup.mjs';
const root = await mkdtemp(join(tmpdir(), 'banger-library-options-'));
app.setPath('userData', root);
app.once('will-quit', () => { void rm(root, { recursive: true, force: true }); });
const recordId = '12345678-1234-1234-1234-123456789abc';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1sAAAAASUVORK5CYII=';
await mkdir(join(root,'records'),{recursive:true});
await writeFile(join(root,'records',`${recordId}.json`),JSON.stringify({id:recordId,name:'Native record',context:{name:'Native record'},attempts:1,artwork:`data:image/png;base64,${png}`}));
for (const name of ['Solo gradient','Solo cover','Record one','Record two']) {
  const folder=join(root,'library',name);await mkdir(folder,{recursive:true});await writeFile(join(folder,`${name}.wav`),wav());
  if(name.startsWith('Record'))await writeFile(join(folder,`${name}.library.json`),JSON.stringify({record:{id:recordId,name:'Native record'}}));
  if(name==='Solo cover')await writeFile(join(folder,'cover.png'),Buffer.from(png,'base64'));
}
const timeout=setTimeout(()=>{console.error('Library options smoke timed out');app.exit(1);},120000);
app.on('browser-window-created',(_event,window)=>window.webContents.once('did-finish-load',async()=>{
  const evaluate=code=>window.webContents.executeJavaScript(code,true);
  const wait=async(code,label)=>{for(let i=0;i<400;i++){if(await evaluate(`Boolean(${code})`))return;await delay(25);}throw new Error(`Timed out: ${label}`);};
  const key=keyCode=>{window.webContents.sendInputEvent({type:'keyDown',keyCode});window.webContents.sendInputEvent({type:'keyUp',keyCode});};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function menu(name) {
    await evaluate(`document.querySelector(${JSON.stringify(`[aria-label="Options for ${name}"]`)}).focus()`);key('Space');
    await wait(`document.querySelector('.library-record-menu [role=menuitem]')`,'menu opened');
  }
  async function rename(name,next) {
    await menu(name);await click('.library-record-menu [role=menuitem]:first-child');
    await wait(`document.querySelector('.library-record-dialog[data-state="open"] input')===document.activeElement`,'rename focus');
    await evaluate(`(() => {const input=document.querySelector('.library-record-dialog[data-state="open"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(next)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('.library-record-dialog[data-state="open"] button[type=submit]');
    await wait(`document.querySelector(${JSON.stringify(`[aria-label="Options for ${next}"]`)})`,'name persisted');
  }
  try {
    await enterStudio(window);window.setContentSize(1200,900);window.show();window.focus();window.webContents.focus();
    await click('.app-sidebar-nav button[aria-label="Library"]');
    await wait(`document.querySelectorAll('.library-single').length===2`,'standalone cards');
    assert.equal(await evaluate("document.querySelectorAll('.library-record').length"),1);
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Play Solo gradient\"]').closest('ol')"),null);
    assert.ok(await evaluate("getComputedStyle(document.querySelector('[aria-label=\"Play Solo gradient\"] .library-art')).backgroundImage.includes('gradient')"));
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Play Solo gradient\"] .library-card-play').textContent"),'▶');
    assert.ok(await evaluate("document.querySelector('[aria-label=\"Play Solo cover\"] img')!==null"));
    await click('[aria-label="Play Solo gradient"]');await wait("!document.querySelector('.library-player audio').paused",'solo playback');
    await rename('Native record','New native name');
    assert.equal(JSON.parse(await readFile(join(root,'records',`${recordId}.json`),'utf8')).name,'New native name');
    await menu('New native name');key('Escape');
    await wait("document.activeElement?.getAttribute('aria-label')==='Options for New native name'",'menu returns focus');
    await menu('New native name');await click('.library-record-menu [role=menuitem]:last-child');
    await wait("document.querySelector('.library-record-notice')?.textContent.includes('key')",'missing key feedback');
    // Use real IndexedDB and the provider adapter, with HTTP responses supplied by this fixture.
    await evaluate(`new Promise(resolve=>{const r=indexedDB.open('banger-library',2);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['songs','records'],'readwrite');tx.objectStore('records').put({id:'browser-record',name:'Browser record',context:{name:'Browser record'},attempts:1,artwork:'data:image/png;base64,${png}'});for(const name of ['Browser one','Browser two','Browser solo'])tx.objectStore('songs').put({id:name,...(name!=='Browser solo'?{recordId:'browser-record'}:{}),name,wav:Uint8Array.from(atob(${JSON.stringify(wav().toString('base64'))}),c=>c.charCodeAt(0)).buffer,files:{}});tx.oncomplete=()=>{db.close();resolve()}}})`);
    await wait("document.querySelectorAll('.library-single').length===3 && document.querySelectorAll('.library-record').length===2",'browser singles and records');
    await evaluate(`(() => {sessionStorage.setItem('banger.ai-settings.v1',JSON.stringify({activeProvider:'meta',providers:{meta:{key:'fixture',model:'muse-wonder-1.0'}}}));const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle='#428aff';ctx.fillRect(0,0,2,2);window.newCover=canvas.toDataURL();const original=window.fetch;window.fetch=async (url,options)=>{if(String(url).startsWith('https://api.meta.ai/')){if(String(url).endsWith('/chat/completions'))return Response.json({id:'brief',object:'chat.completion',created:1,model:'muse-wonder-1.0',choices:[{index:0,message:{role:'assistant',content:'Blue morning'},finish_reason:'stop'}]});window.imageRequest=JSON.parse(options.body);return new Promise(resolve=>window.finishCover=()=>resolve(Response.json({data:[{b64_json:window.newCover.split(',')[1]}]})));}return original(url,options);};})()`);
    await menu('Browser record');await click('.library-record-menu [role=menuitem]:last-child');
    await wait('window.finishCover','generation started');
    assert.equal(await evaluate('window.imageRequest.n'),1);assert.equal(await evaluate('window.imageRequest.size'),'1024x1024');
    assert.ok(await evaluate(`document.querySelector('[aria-label="Record: Browser record"] img').src.endsWith('${png}')`),'old cover remains visible');
    await rename('Browser record','Name during generation');
    await evaluate('window.finishCover()');
    await wait("document.querySelector('[aria-label=\"Record: Name during generation\"] img').src===window.newCover",'new shared cover appears');
    assert.equal(await evaluate("document.querySelectorAll('[aria-label=\"Record: Name during generation\"] img').length"),1);
    await menu('Name during generation');await click('.library-record-menu [role=menuitem]:first-child');
    await wait("document.querySelector('.library-record-dialog[data-state=\"open\"]')",'dialog reopened');key('Escape');
    await wait("document.activeElement?.getAttribute('aria-label')==='Options for Name during generation'",'dialog returns focus');
    await delay(100);await writeFile('/tmp/banger-library-options.png',(await window.webContents.capturePage()).toPNG());
    window.setContentSize(430,900);await delay(100);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
    console.log('Library options smoke passed: standalone cards, fallback artwork, playback, keyboard menus, persistent native/browser rename, asynchronous replacement, missing-key feedback, focus return, and mobile layout.');
    clearTimeout(timeout);app.exit(0);
  } catch(error) {console.error(error);await writeFile('/tmp/banger-library-options-failure.png',(await window.webContents.capturePage()).toPNG());clearTimeout(timeout);app.exit(1);}
}));
await import('../dist/main.js');
