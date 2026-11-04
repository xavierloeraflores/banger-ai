import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { compileMusic, FACTORY_PATCHES, INSTRUMENT_PATCHES } from '../packages/compiler/dist/index.js';
import { serveApp } from '../apps/desktop/dist/static-app.js';
import { enterStudio } from '../apps/desktop/scripts/smoke-startup.mjs';

const soundPatches=[...FACTORY_PATCHES,...Object.values(INSTRUMENT_PATCHES)];
const web=process.argv.includes('--web');
const timer=setTimeout(()=>{console.error('Preset smoke timed out');app.exit(1);},120000);
let server;
async function run(window) {
  try {
    const folder=await enterStudio(window);
    console.log('Preset smoke entered studio');
    const evaluate=async code=>{try{return await window.webContents.executeJavaScript(code,true);}catch(error){console.error('Failed browser script:',code);throw error;}};
    const wait=async code=>{for(let i=0;i<200;i++){if(await evaluate(code))return;await delay(25);}throw new Error('Timed out: '+code);};
    const click=async text=>{await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)} && !b.closest('[hidden]')).click()`);await delay(40);};
    const field=async(selector,value,kind='HTMLSelectElement')=>{
      await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el || el.matches(':disabled'))throw new Error('Control unavailable');Object.getOwnPropertyDescriptor(${kind}.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(${JSON.stringify(kind==='HTMLSelectElement'?'change':'input')},{bubbles:true}));})()`);
      await delay(40);
    };
    const source=()=>evaluate('document.querySelector("#producer-source").value');
    const program=async()=>compileMusic(await source());
    const apply=async text=>{await click('Raw .banger');await field('#producer-source',text,'HTMLTextAreaElement');await click('Apply source');await click('Sequencer');};
    await apply('tempo 120; track lead { instrument "synth/lead"; notes "C4 . E4 ."; lock 0 { cutoff 1700; } gain .5; }');
    await evaluate(`document.querySelector('[aria-label="Edit lead"]').click()`);
    await wait('Boolean(document.querySelector("#track-0-tab-sound"))');
    await evaluate('document.querySelector("#track-0-tab-sound").click()');
    const before=(await program()).tracks[0].steps;
    const selector='[aria-label="lead synth preset"]';
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelectorAll('optgroup').length`),5);
    for(const [name,patch] of Object.entries(INSTRUMENT_PATCHES)){
      // Begin with an override to prove source selection activates the recipe.
      await field(selector,'String Ensemble');
      await field('[aria-label="lead sound"]',name);
      const track=(await program()).tracks[0];
      assert.equal(track.source.name,name);
      assert.equal(track.synth,undefined);
      assert.equal(track.modular,undefined);
      assert.deepEqual(track.steps,before,'source selection preserves notes and locks');
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`),patch.name);
      assert.equal(Number(await evaluate(`document.querySelector('[aria-label="lead Decay"]').value`)),patch.config.decay);
      await field('[aria-label="lead Decay"]',.33,'HTMLInputElement');
      assert.deepEqual((await program()).tracks[0].synth,{...patch.config,decay:.33},'editing starts from the instrument recipe');
      await click('On');
      assert.equal((await program()).tracks[0].synth.enabled,false);
      await click('Off');
      assert.equal((await program()).tracks[0].synth.enabled,true);
      await field('[aria-label="lead parameter lock step"]','0');
      await field('[aria-label="lead Decay"]',.2,'HTMLInputElement');
      assert.equal((await program()).tracks[0].steps[0].locks.decay,.2);
      await evaluate(`document.querySelector('[aria-label="Remove Decay lock"]').click()`);
      await field('[aria-label="lead parameter lock step"]','-1');
      await click('Modular');await field('[aria-label="lead factory patch"]',patch.name);
      assert.deepEqual((await program()).tracks[0].modular.config,patch.config);
      await field('[aria-label="lead sound"]',name);
      assert.equal((await program()).tracks[0].modular,undefined,'source selection exits modular mode');
      await click('Preview');
      await wait('document.querySelector(".sound-status").textContent.includes("Preview playing")');
    }
    for(const patch of soundPatches){
      await field(selector,patch.name);
      const track=(await program()).tracks[0];
      assert.deepEqual(track.synth,patch.config,patch.name);
      assert.equal(track.modular,undefined);
      assert.deepEqual(track.steps,before,'preset preserves notes and locks');
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`),patch.name);
    }
    await field(selector,'String Ensemble');await click('Preview');
    await wait('document.querySelector(".sound-status").textContent.includes("Preview playing")');
    await wait('document.querySelector(".sound-design").textContent.includes("Playing…")');
    for(let i=0;i<100&&!window.webContents.isCurrentlyAudible();i++)await delay(10);
    assert.equal(window.webContents.isCurrentlyAudible(),true,'string preview produces audio');
    await field(selector,'Noise Riser');
    assert.equal(await evaluate('document.querySelector(".sound-design").textContent.includes("Playing…")'),false,'selecting a preset stops preview');
    await field('[aria-label="lead parameter lock step"]','0');
    await field('[aria-label="lead Filter sweep"]',-.5,'HTMLInputElement');
    assert.equal((await program()).tracks[0].steps[0].locks.filterSweep,-.5);
    await click('Clear step locks');await field('[aria-label="lead parameter lock step"]','-1');
    await click('Modular');await field('[aria-label="lead factory patch"]','Muted Synth Guitar');
    await field('[aria-label="lead patch name"]','My guitar','HTMLInputElement');await click('Save patch');
    const saved=await source();
    await click('Project');await click('Save .banger');
    await wait('document.querySelector(".project-file-identity p").textContent.startsWith("Saved")');
    const disk=web?await evaluate('(async()=>{const folder=await window.smokeProjectParent.getDirectoryHandle("Sample Project");return (await (await folder.getFileHandle("night-drive.banger")).getFile()).text();})()'):await readFile(join(folder,'night-drive.banger'),'utf8');
    assert.equal(disk,saved,'project save contains preset and patch library');
    await evaluate(`document.querySelector('[aria-label="Close project controls"]').click()`);
    await apply(disk);
    assert.equal((await program()).tracks[0].modular.name,'My guitar');
    assert.deepEqual((await program()).tracks[0].modular.config,INSTRUMENT_PATCHES['synth/muted-guitar'].config);
    await click('Clear patch');await field('[aria-label="lead saved patch"]','My guitar');
    assert.equal((await program()).tracks[0].modular.name,'My guitar');
    await click('Synth engine');await field(selector,'808 Bass');
    await evaluate('document.querySelector(".sound-design").scrollIntoView({block:"start"})');await delay(100);
    await writeFile(`/tmp/banger-presets-${web?'web':'desktop'}.png`,(await window.webContents.capturePage()).toPNG());
    console.log(`${web?'Web':'Desktop'} preset smoke passed: all ${soundPatches.length} presets, six native sources, recipe edits, on/off, locks, modular overrides, groups, note/lock preservation, preview cancellation, sweep locks, modular save/load and project disk save/reapply.`);
  }catch(error){console.error(error);process.exitCode=1;}
  finally{clearTimeout(timer);window.destroy();server?.close();app.exit(process.exitCode??0);}
}
if(web){
  void app.whenReady().then(async()=>{
  server=createServer(async(req,res)=>{const result=await serveApp(new Request(`banger://app${req.url}`),fileURLToPath(new URL('../apps/www/out',import.meta.url)));res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const window=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);await run(window);
  });
}else{
  app.on('browser-window-created',(_event,window)=>window.webContents.once('did-finish-load',()=>void run(window)));
  await import('../apps/desktop/dist/main.js');
}
