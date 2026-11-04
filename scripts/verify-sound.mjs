import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = new URL('../',import.meta.url);
const server=createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script type="importmap">{"imports":{"@banger/compiler":"/packages/compiler/dist/index.js"}}</script>');return;}
  if(!/^\/packages\/(engine|compiler)\/dist\/[a-z-]+\.js$/.test(req.url)){res.writeHead(404);res.end();return;}
  try{res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL(req.url.slice(1),root)));}catch{res.writeHead(404);res.end();}
});
const timeout=setTimeout(()=>{console.error('Sound verification timed out');app.exit(1);},120000);
async function runTest() {
try {
  await app.whenReady();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await window.loadURL(`http://127.0.0.1:${server.address().port}`);
  const report=await window.webContents.executeJavaScript(`(async()=>{
    const c=await import('/packages/compiler/dist/index.js'),e=await import('/packages/engine/dist/index.js');
    const assert=(value,message)=>{if(!value)throw new Error(message);};
    const base=()=>({tempo:120,meter:{numerator:4,denominator:4},tracks:[{name:'voice',source:{kind:'instrument',name:'synth/lead'},steps:[{kind:'note',midi:48},null,{kind:'note',midi:55},null],gain:.5,synth:{...c.INIT_SYNTH,attack:.005,decay:.1,release:.05,lfo1Depth:0,glide:0}}]});
    const energy=b=>b.getChannelData(0).reduce((sum,value)=>{assert(Number.isFinite(value),'nonfinite audio');return sum+value*value;},0)/b.length;
    const render=async p=>(await e.renderWav(c.compileMusic(c.serializeMusic(p)),{sampleRate:22050}));
    const reference=await render(base());assert(energy(reference.buffer)>1e-6,'synth silent');assert(new TextDecoder().decode(reference.wav.slice(0,4))==='RIFF','export missing WAV');
    const changes={tone:.2,filterSweep:1,filterDecay:.05,osc1:'square',osc2:'sawtooth',mix:.95,drive:.7,fm:.8,fmRatio:3,detune:80,sub:1,noise:.7,voices:4,unisonDetune:80,spread:0,filterType:'highpass',cutoff:400,resonance:12,filterEnv:-.8,velocityFilter:.9,lfo1Wave:'square',lfo1Rate:12,lfo1Depth:.9,lfo1Target:'pitch',lfo2Wave:'square',lfo2Rate:12,lfo2Depth:.9,lfo2Target:'pitch',attack:.3,decay:.6,sustain:.1,release:.5,glide:.4,pitchEnv:24,pitchDecay:.6,volume:.15};
    const deltas={};
    for(const [key,value] of Object.entries(changes)){
      const p=base();p.tracks[0].synth[key]=value;
      if(key.startsWith('lfo')){p.tracks[0].synth.lfo1Depth=.6;p.tracks[0].synth.lfo2Depth=.6;}
      if(key==='fmRatio')p.tracks[0].synth.fm=.5;
      if(key==='pitchDecay')p.tracks[0].synth.pitchEnv=24;
      if(['unisonDetune','spread'].includes(key))p.tracks[0].synth.voices=3;
      const before=base();for(const coupled of ['fm','voices','lfo1Depth','lfo2Depth','pitchEnv'])if(coupled!==key)before.tracks[0].synth[coupled]=p.tracks[0].synth[coupled];
      const a=(await render(before)).buffer.getChannelData(0),b=(await render(p)).buffer.getChannelData(0);let delta=0;for(let i=0;i<Math.min(a.length,b.length);i++)delta+=Math.abs(a[i]-b[i]);assert(delta>1e-4,key+' did not change audio');deltas[key]=delta;
    }
    const metal=base(),white=base();metal.tracks[0].synth.noise=white.tracks[0].synth.noise=.8;metal.tracks[0].synth.noiseType='metal';assert(energy((await render(metal)).buffer)!==energy((await render(white)).buffer),'noise type unchanged');
    const disabled=base();disabled.tracks[0].synth.enabled=false;assert(energy((await render(disabled)).buffer)===0,'disabled synth audible');
    const empty=base();empty.tracks[0].modular=null;assert(energy((await render(empty)).buffer)===0,'empty modular audible');
    const locked=base();locked.tracks[0].steps[0].locks={cutoff:100,drive:.8,release:.02};const saved=c.compileMusic(c.serializeMusic(locked));assert(saved.tracks[0].steps[0].locks.cutoff===100,'lock not persisted');assert(saved.tracks[0].synth.cutoff===1800,'lock leaked into track');
    const a=reference.buffer.getChannelData(0),b=(await render(locked)).buffer.getChannelData(0);let secondDelta=0;for(let i=22050;i<33075;i++)secondDelta+=Math.abs(a[i]-b[i]);assert(secondDelta<.0001,'lock leaked into following note');
    const long=base();long.tracks[0].steps=[null,null,null,{kind:'note',midi:48}];long.tracks[0].steps[3].locks={release:3};const tail=await render(long);assert(tail.tailSeconds>=3,'locked release tail clipped');
    const glide=base();glide.tracks[0].synth.glide=.4;const first=await render(glide),second=await render(glide);assert(energy(first.buffer)===energy(second.buffer),'glide depends on prior session');
    const pitch=base();pitch.tracks[0].automation=[{target:'pitch',points:[{beat:0,value:12}]}];assert(energy((await render(pitch)).buffer)!==energy(reference.buffer),'pitch automation bypassed');
    const factories={};for(const patch of c.FACTORY_PATCHES){const p=base();p.tracks[0].modular=patch;const result=await render(p);factories[patch.name]=energy(result.buffer);assert(factories[patch.name]>1e-9,patch.name+' silent');}
    const presets={}, demos=[];
    const stats=(buffer,start=0,end=buffer.duration)=>{
      let power=0,difference=0,peak=0,count=0;
      for(let ch=0;ch<buffer.numberOfChannels;ch++){
        const data=buffer.getChannelData(ch);
        for(let i=Math.floor(start*buffer.sampleRate);i<Math.min(data.length,Math.floor(end*buffer.sampleRate));i++){
          assert(Number.isFinite(data[i]),'nonfinite preset audio');power+=data[i]**2;peak=Math.max(peak,Math.abs(data[i]));count++;
          if(i>0)difference+=(data[i]-data[i-1])**2;
        }
      }
      return {rms:Math.sqrt(power/Math.max(1,count)),peak,brightness:difference/Math.max(1e-20,power)};
    };
    for(const name of ['Synth Brass','Flute Lead','Chiptune Lead','String Ensemble','Kalimba Pluck','Noise Riser']){
      const patch=c.FACTORY_PATCHES.find(p=>p.name===name),p=base();
      p.tracks[0].synth=patch.config;p.tracks[0].steps=[];p.tracks[0].pianoRoll=[{midi:60,start:0,duration:4,velocity:1}];
      const result=await render(p),all=stats(result.buffer),early=stats(result.buffer,.02,.1),late=stats(result.buffer,1.5,1.9);
      assert(all.rms>1e-4 && all.peak<.99,name+' silent or clipped');
      if(name==='String Ensemble')assert(stats(result.buffer,.7,1).rms>early.rms*3,'strings do not swell');
      if(name==='Kalimba Pluck')assert(late.rms<early.rms*.001,'kalimba keeps sustaining');
      if(name==='Noise Riser'){assert(late.rms>early.rms*3,'riser does not swell');assert(late.brightness>early.brightness*2,'riser does not brighten');}
      assert(stats(result.buffer,2+patch.config.release+.01).peak<1e-6,name+' release does not end');
      presets[name]={...all,early,late};demos.push({name,wav:Array.from(new Uint8Array(result.wav))});
      p.tracks[0].pianoRoll=[60,64,67].map(midi=>({midi,start:0,duration:4,velocity:.8}));
      assert(stats((await render(p)).buffer).peak<.99,name+' chord clips');
    }
    for(const [source,patch] of Object.entries(c.INSTRUMENT_PATCHES)){
      const p=c.compileMusic('tempo 120; track voice { instrument "'+source+'"; piano { note "'+(source==='synth/808-bass'||source==='synth/impact'?'C2':'C4')+'" start 0 duration 4 velocity .8; } gain .5; }');
      const result=await render(p),all=stats(result.buffer),early=stats(result.buffer,.02,.08),late=stats(result.buffer,1,1.3);
      assert(all.rms>1e-4 && all.peak<.99,source+' silent or clipped');
      if(source==='synth/808-bass')assert(late.rms>early.rms*.2,'808 does not sustain');
      if(['synth/marimba','synth/woodblock','synth/muted-guitar'].includes(source))assert(late.rms<early.rms*.001,source+' does not decay');
      if(source==='synth/downlifter'){
        assert(late.rms<early.rms*.5,'downlifter does not fade');
        assert(late.brightness<early.brightness*.5,'downlifter does not darken');
      }
      if(source==='synth/impact')assert(late.rms<early.rms*.01,'impact does not decay');
      assert(stats(result.buffer,2+patch.config.release+.01).peak<1e-6,source+' release does not end');
      presets[patch.name]={...all,early,late};demos.push({name:patch.name,wav:Array.from(new Uint8Array(result.wav))});
      // Native source defaults and explicit synth patches must render identically.
      const explicit=structuredClone(p);explicit.tracks[0].source.name='synth/lead';explicit.tracks[0].synth=patch.config;
      const other=(await render(explicit)).buffer.getChannelData(0),native=result.buffer.getChannelData(0);
      assert(native.every((value,i)=>Math.abs(value-other[i])<1e-7),source+' bypasses recipe rendering');
      p.tracks[0].pianoRoll=[60,64,67].map(midi=>({midi,start:0,duration:.5,velocity:.8}));
      assert(stats((await render(p)).buffer).peak<.99,source+' chord clips');
    }
    const requested={};
    for(const [name,register] of [['Music Box',[60,72,84,96]],['Clavinet',[48,60,72]],['808 Bass',[24,36,48]]]){
      const patch=[...c.FACTORY_PATCHES,...Object.values(c.INSTRUMENT_PATCHES)].find(p=>p.name===name);
      const metrics=[];
      for(const midi of register){
        let quiet;
        for(const velocity of [.25,1]){
          const p=base();p.tracks[0].synth=patch.config;p.tracks[0].steps=[];
          p.tracks[0].pianoRoll=[{midi,start:0,duration:4,velocity}];
          const result=await render(p),all=stats(result.buffer),early=stats(result.buffer,.01,.08),late=stats(result.buffer,1.8,1.95);
          assert(all.peak<.65 && all.rms>1e-5,name+' register silent or unbalanced at '+midi);
          assert(late.peak<1e-6,name+' held note fails to decay at '+midi);
          assert(stats(result.buffer,2+patch.config.release+.01).peak<1e-6,name+' ending leaks');
          for(let channel=0;channel<result.buffer.numberOfChannels;channel++)assert(Math.abs(result.buffer.getChannelData(channel)[0])<1e-6,name+' attack starts with discontinuity');
          if(velocity===.25)quiet=early.rms;else assert(early.rms>quiet*2,name+' velocity response lost');
          if(name==='808 Bass'){
            const data=result.buffer.getChannelData(0),rate=result.buffer.sampleRate,freq=440*2**((midi-69)/12);
            const magnitude=f=>{let re=0,im=0;const start=Math.floor(rate*.15),end=Math.floor(rate*.65);for(let i=start;i<end;i++){const w=.5-.5*Math.cos(2*Math.PI*(i-start)/(end-start));re+=data[i]*w*Math.cos(2*Math.PI*f*i/rate);im+=data[i]*w*Math.sin(2*Math.PI*f*i/rate);}return re*re+im*im;};
            assert(magnitude(freq)>magnitude(freq*2**(1/12))*1.15 && magnitude(freq)>magnitude(freq*2**(-1/12))*1.15,'808 loses played pitch at '+midi);
          }
          metrics.push({midi,velocity,...all});
          if(midi===register[1]&&velocity===1)demos.push({name,wav:Array.from(new Uint8Array(result.wav))});
        }
      }
      const short=base();short.tracks[0].synth=patch.config;short.tracks[0].steps=[];
      short.tracks[0].pianoRoll=[{midi:register[1],start:0,duration:.125,velocity:1}];
      assert(stats((await render(short)).buffer,.0625+patch.config.release+.01).peak<1e-6,name+' short gate clicks or leaks');
      short.tracks[0].pianoRoll=[0,4,7,11].map(offset=>({midi:register[1]+offset,start:0,duration:.5,velocity:1}));
      short.tracks[0].gain=1;
      assert(stats((await render(short)).buffer).peak<.99,name+' full-velocity chord clips');
      const locked=base();locked.tracks[0].synth=patch.config;
      locked.tracks[0].steps[0].locks={decay:.1,cutoff:600,volume:.15};
      const unlocked=structuredClone(locked);delete unlocked.tracks[0].steps[0].locks;
      const a=(await render(locked)).buffer.getChannelData(0),b=(await render(unlocked)).buffer.getChannelData(0);
      assert(a.slice(0,4000).some((value,i)=>Math.abs(value-b[i])>.0001),name+' locks have no effect');
      assert(a.slice(22050,33075).every((value,i)=>Math.abs(value-b[i+22050])<1e-7),name+' locks leak to following note');
      requested[name]=metrics;
    }
    const silent=base();silent.tracks[0].synth={...c.INIT_SYNTH,tone:0,noise:0};assert(energy((await render(silent)).buffer)===0,'oscillator level zero still has tone');
    return {controlChanges:Object.keys(deltas),factories,presets,requested,demos,lockIsolation:true,disabledSilence:true,emptyPatchSilence:true,releaseTail:tail.tailSeconds,saveReopen:true,wavBytes:reference.wav.byteLength};
  })()`);
  const demoDirectory=join(tmpdir(),'banger-preset-demos');await mkdir(demoDirectory,{recursive:true});
  for(const demo of report.demos)await writeFile(join(demoDirectory,demo.name.toLowerCase().replaceAll(' ','-')+'.wav'),new Uint8Array(demo.wav));
  delete report.demos;report.demoDirectory=demoDirectory;
  console.log(JSON.stringify(report,null,2));clearTimeout(timeout);server.close();app.exit(0);
}catch(error){console.error(error);clearTimeout(timeout);server.close();app.exit(1);}

}
void runTest();
