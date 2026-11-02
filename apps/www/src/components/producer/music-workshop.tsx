'use client';
import './audio-worklet';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Button} from '@banger/shadcn';
import {renderWav} from '@banger/engine';
import {compileMusic} from '@banger/compiler';
import {chunkName,lyricsOf,type MusicVersion,type MusicOperation,type MusicAction} from '@banger/elevenlabs/protocol';
import {cloudMusic,desktopMusic,type MusicBackend,type CloudMusicContext} from '@/lib/elevenlabs';
const message=(error:unknown)=>error instanceof Error?error.message:'The music operation failed.';
export function MusicWorkshop({cloud,studioFile}:{cloud?:CloudMusicContext;studioFile:{name:string;source:string}}) {
  const [native,setNative]=useState<MusicBackend>();
  useEffect(()=>{queueMicrotask(()=>setNative(desktopMusic()));},[]);
  const backend=useMemo(()=>cloud?cloudMusic(cloud):native,[cloud,native]);
  const [songs,setSongs]=useState<{id:string;name:string;version:number}[]>([]);
  const [song,setSong]=useState<MusicVersion|null>(null);
  const [lyrics,setLyrics]=useState<string[]>([]);
  const [indices,setIndices]=useState<number[]>([]);
  const [jobs,setJobs]=useState<MusicOperation[]>([]);
  const [prompt,setPrompt]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [audio,setAudio]=useState('');
  const pending=useRef(false),epoch=useRef(0);
  const current=useRef({song,lyrics});
  const saving=useRef<{id:string;lyrics:string[]}|null>(null);
  const backendIdentity=useRef('');
  useEffect(()=>{current.current={song,lyrics};},[song,lyrics]);
  const dirty=Boolean(song&&song.plan.chunks.some((chunk,index)=>lyrics[index]!==lyricsOf(chunk.text)));
  const running=jobs.some(job=>['queued','running'].includes(job.status));
  function adopt(next:MusicVersion){setSong(next);setLyrics(next.plan.chunks.map(chunk=>lyricsOf(chunk.text)));setIndices(next.plan.chunks.map((_,index)=>index));setAudio('');}
  useEffect(()=>()=>{if(audio)URL.revokeObjectURL(audio);},[audio]);
  useEffect(()=>{
    if(!backend)return;
    const identity=cloud?`${cloud.url}:${cloud.projectId}:${cloud.token}`:'desktop';
    const changed=backendIdentity.current!==identity;backendIdentity.current=identity;
    let cancelled=false,polling=false;
    const poll=async()=>{
      if(polling||pending.current)return;polling=true;const generation=epoch.current;
      try{
        const [list,operations]=await Promise.all([backend.list(),backend.operations()]);
        if(cancelled||generation!==epoch.current||pending.current)return;
        setSongs(list);setJobs(operations);
        const before=current.current;const id=before.song?.id??list[0]?.id;
        if(id){
          const next=await backend.get(id);
          if(cancelled||generation!==epoch.current||pending.current)return;
          if(!before.song || next.version!==before.song.version){
            const saved=saving.current&&operations.some(job=>job.id===saving.current!.id&&job.status==='completed')&&JSON.stringify(before.lyrics)===JSON.stringify(saving.current.lyrics);
            if(!saved&&before.song?.plan.chunks.some((chunk,index)=>before.lyrics[index]!==lyricsOf(chunk.text)))setNotice('A newer composition is saved. Your lyric draft is preserved; reload to compare.');
            else {adopt(next);saving.current=null;}
          }
        }
      }catch(error){if(!cancelled)setNotice(message(error));}
      finally{polling=false;}
    };
    queueMicrotask(()=>{if(changed){current.current={song:null,lyrics:[]};setSong(null);setLyrics([]);setAudio('');}void poll();});
    const timer=setInterval(()=>void poll(),2000);return()=>{cancelled=true;clearInterval(timer);};
  },[backend,cloud]);
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  async function action(work:()=>Promise<void>){if(pending.current)return;pending.current=true;epoch.current++;setBusy(true);setNotice('');try{await work();}catch(error){setNotice(message(error));}finally{pending.current=false;setBusy(false);}}
  async function track(operation:MusicOperation|null){if(!operation)return;setJobs(previous=>[operation,...previous.filter(job=>job.id!==operation.id)]);setNotice('Request saved. Progress will update here.');}
  async function submit(input:MusicAction){if(!backend||!song)return;const operation=await backend.act(song.id,input,crypto.randomUUID());if(input.operation==='edit')saving.current={id:operation.id,lyrics:[...lyrics]};await track(operation);}
  function discard(){return !dirty||window.confirm('Discard the unsaved lyric draft?');}
  if(!backend)return null;
  return <details className="project-workspace producer-panel music-workshop"><summary>ElevenLabs song workshop</summary>
    <p>Upload a WAV or render the studio song, edit lyrics by chunk, then generate or replace selected chunks. Upload analysis and generation use your ElevenLabs credits.</p>
    <div className="project-workspace-actions">
      {backend.mode==='desktop'?<Button disabled={busy||running} onClick={()=>void action(async()=>track(await backend.upload()))}>Upload WAV to ElevenLabs</Button>:<label>Upload WAV<input type="file" accept=".wav,audio/wav" disabled={busy||running} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void action(async()=>{if(file.size>100*1024*1024)throw new Error('Choose a WAV up to 100 MiB.');await track(await backend.upload(file));});}}/></label>}
      <Button disabled={busy||running} onClick={()=>void action(async()=>{setNotice('Rendering the studio song...');const rendered=await renderWav(compileMusic(studioFile.source));await track(await backend.rendered(rendered.wav,studioFile.name.replace(/\.banger$/,'.wav')));})}>Use studio WAV</Button>
    </div>
    <label>Song<select value={song?.id??''} disabled={busy||running} onChange={event=>{const id=event.target.value;if(id&&discard())void action(async()=>adopt(await backend.get(id)));}}><option value="">Choose a song</option>{songs.map(song=><option key={song.id} value={song.id}>{song.name} · version {song.version}</option>)}</select></label>
    {song&&<>
      <p>Composition version {song.version} · Audio from version {song.audioVersion}{dirty?' · Unsaved lyrics':''}</p>
      <div className="project-workspace-actions"><Button disabled={busy} onClick={()=>void action(async()=>setAudio(await backend.audio(song)))}>Listen to song</Button><Button disabled={busy} onClick={()=>void action(()=>backend.save(song))}>Download final song</Button><Button disabled={busy} onClick={()=>{if(discard())void action(async()=>adopt(await backend.get(song.id)));}}>Reload composition</Button></div>
      {audio&&<audio controls src={audio} aria-label="ElevenLabs song preview"/>}
      <div className="music-chunks">{song.plan.chunks.map((chunk,index)=><section className="music-chunk" key={`${song.id}-${index}`}>
        <label><input type="checkbox" checked={indices.includes(index)} disabled={busy||running} onChange={event=>setIndices(value=>event.target.checked?[...value,index].sort((a,b)=>a-b):value.filter(item=>item!==index))}/>{chunkName(chunk.text,index)} · {(chunk.durationMs/1000).toFixed(1)}s</label>
        <p>{chunk.positiveStyles.join(' · ')}</p>
        <label>Lyrics for {chunkName(chunk.text,index)}<textarea aria-label={`Lyrics for chunk ${index+1}`} value={lyrics[index]??''} maxLength={6200} disabled={busy||running} onChange={event=>{epoch.current++;const value=event.target.value;setLyrics(previous=>previous.map((text,i)=>i===index?value:text));}}/></label>
        <details><summary>Composition properties</summary><pre>{JSON.stringify(Object.fromEntries(Object.entries(chunk).filter(([key])=>key!=='text')),null,2)}</pre></details>
        <Button disabled={busy||running||dirty} onClick={()=>void action(()=>submit({operation:'generate',baseVersion:song.version,indices:[index]}))}>Regenerate this chunk</Button>
      </section>)}</div>
      <div className="project-workspace-actions"><Button disabled={busy||running||!dirty} onClick={()=>void action(()=>submit({operation:'edit',baseVersion:song.version,edits:song.plan.chunks.flatMap((chunk,index)=>lyrics[index]===lyricsOf(chunk.text)?[]:[{index,lyrics:lyrics[index]??''}])}))}>Save lyrics</Button>
        <Button disabled={busy||running||dirty||!indices.length} onClick={()=>void action(()=>submit({operation:'generate',baseVersion:song.version,indices}))}>{indices.length===song.plan.chunks.length?'Generate new song':'Regenerate selected chunks'}</Button></div>
      <label>Optional AI lyric direction<input value={prompt} maxLength={2000} placeholder="A hopeful chorus about finding your way home" onChange={event=>setPrompt(event.target.value)}/></label>
      <Button disabled={busy||running||dirty||!prompt.trim()||!indices.length} onClick={()=>void action(()=>submit({operation:'lyrics',baseVersion:song.version,prompt,indices}))}>Generate lyrics for selected chunks</Button>
      <details><summary>Full composition plan</summary><pre>{JSON.stringify(song.plan,null,2)}</pre></details>
    </>}
    <ol aria-label="ElevenLabs operations">{jobs.slice(0,10).map(job=><li key={job.id}>{job.stage} <progress max={100} value={job.progress} aria-label="ElevenLabs progress"/> {job.progress}%{job.error&&<p>{job.error}</p>}</li>)}</ol>
    {notice&&<p role="status">{notice}</p>}
  </details>;
}
