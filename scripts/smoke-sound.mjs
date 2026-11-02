import { app, BrowserWindow } from 'electron';
import { writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { compileMusic } from '../packages/compiler/dist/index.js';
const timer=setTimeout(()=>{console.error('Sound UI smoke timed out');app.exit(1);},120000);
let window;
async function runTest() {
try {
  await app.whenReady();
  window=new BrowserWindow({show:false,width:1600,height:1200,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  window.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});
  await window.loadURL(process.env.BANGER_UI_URL??'http://127.0.0.1:3017');
  const run=async code=>{try{return await window.webContents.executeJavaScript(code);}catch(error){console.error('Failed script:',code);throw error;}};

  const wait=async condition=>{for(let i=0;i<100;i++){if(await run(condition))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+condition);};
  await wait(`Boolean(document.querySelector('[aria-controls="track-editor-0"]'))`);
  await run(`document.querySelector('[aria-controls="track-editor-0"]').click()`);
  await wait(`!document.querySelector('#track-editor-0').hidden`);
  await run(`window.__savedSound = null; window.bangerProjects = {saveProject:async(source,name)=>{window.__savedSound={source,name};return {name};},openProject:async()=>window.__savedSound};window.confirm=()=>true;window.prompt=()=> 'Smoke patch';void 0;`);
  const button=async text=>run(`[...document.querySelectorAll('#track-editor-0 .sound-design button')].find(button=>button.textContent===${JSON.stringify(text)}).click()`);
  const select=async(label,value)=>{await run(`(()=>{const input=document.querySelector('[aria-label='+JSON.stringify(${JSON.stringify(label)})+']');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,100));};
  const range=async(label,value)=>{await run(`(()=>{const input=document.querySelector('[aria-label='+JSON.stringify(${JSON.stringify(label)})+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,100));};
  await button('Off'); // Existing source is replaced by editable synth.
  await wait(`document.querySelector('#producer-source').value.includes('synth {')`);
  await range('kick Cutoff',840);await range('kick FM amount',.4);
  await select('kick parameter lock step','0');await range('kick Cutoff',260);
  await wait(`document.querySelector('#producer-source').value.includes('lock 0 { cutoff 260; }')`);
  assert.equal(await run(`document.querySelector('[aria-label="Remove Cutoff lock"]').getAttribute('aria-pressed')`),'true');
  await run(`document.querySelector('#track-editor-0 .sound-design').scrollIntoView({block:'start'})`);
  await writeFile('/tmp/banger-features-synth.png',(await window.webContents.capturePage()).toPNG());
  await button('Preview');await wait(`document.querySelector('#track-editor-0 .sound-status').textContent.includes('Preview playing')`);
  await button('On');
  await wait(`![...document.querySelectorAll('#track-editor-0 .sound-design button')].some(button=>button.textContent==='Playing…')`);
  await select('kick synth preset','init');await wait(`document.querySelector('#producer-source').value.includes('cutoff 1800;')`);
  await button('Modular');await wait(`document.querySelector('#producer-source').value.includes('modular "";')`);
  await button('Start patching');await wait(`document.querySelector('#producer-source').value.includes('modular "Init Saw"')`);
  await select('kick factory patch','FM Bell');await button('Save patch');await wait(`document.querySelector('#producer-source').value.includes('patch "Smoke patch"')`);
  await button('Preview note');await wait(`document.querySelector('#track-editor-0 .sound-status').textContent.includes('Preview playing')`);
  await button('Clear patch');await wait(`document.querySelector('#track-editor-0 .sound-status').textContent.includes('silent')`);
  await run(`document.querySelector('#track-editor-0 .sound-design').scrollIntoView({block:'start'})`);
  await writeFile('/tmp/banger-features-modular.png',(await window.webContents.capturePage()).toPNG());
  await select('kick saved patch','Smoke patch');await wait(`document.querySelector('#producer-source').value.includes('modular "Smoke patch"')`);
  await run(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Save .banger').click()`);
  await wait(`Boolean(window.__savedSound)`);
  const saved=await run('window.__savedSound');await writeFile('/tmp/banger-sound-smoke.banger',saved.source);
  const disk=await readFile('/tmp/banger-sound-smoke.banger','utf8');const program=compileMusic(disk);
  assert.equal(program.tracks[0].modular.name,'Smoke patch');assert.equal(program.tracks[0].patchLibrary.length,1);assert.equal(program.tracks[0].steps[0].locks.cutoff,260);
  await button('Clear patch');
  await run(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Open').click()`);
  await wait(`document.querySelector('#producer-source').value.includes('modular "Smoke patch"')`);
  console.log('Sound UI smoke passed: editable controls, step locks, Init, preview/stop, modular start/factory/save/load/clear, disk save and reopen.');
  clearTimeout(timer);app.exit(0);
}catch(error){console.error(error);clearTimeout(timer);app.exit(1);}

}
void runTest();
