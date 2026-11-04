'use client';
import './audio-worklet';
import './music-workshop.css';
import {useEffect,useMemo,useRef,useState} from 'react';
import {KeyHint,LLM_KEY_HINT,VOCAL_KEY_HINT,useGenerationAccess} from './generation-access';
import {sendLyrics} from '@/lib/ai-chat';
import {prepareSong} from '@/lib/song-storage';
import {renderWav} from '@banger/engine';
import {compileMusic} from '@banger/compiler';
import {chunkName,lyricsOf,lyricEditError,MAX_CHUNK_TEXT_CHARACTERS,MAX_CHUNK_TEXT_LINES,MAX_CHUNK_LINE_CHARACTERS,type MusicVersion,type MusicOperation,type MusicAction,type MusicHistory} from '@banger/elevenlabs/protocol';
import {cloudMusic,desktopMusic,type MusicBackend,type CloudMusicContext} from '@/lib/elevenlabs';
import {clockTime,Waveform,useMusicAudio} from './music-audio';
const message=(error:unknown)=>error instanceof Error?error.message:'The music operation failed.';
const mergeHistory=(history:MusicHistory,previous:MusicVersion[]=[])=>[...new Map([...previous,history.original,...history.versions].map(version=>[version.version,version])).values()].sort((a,b)=>a.version-b.version);
const audioName=(version:MusicVersion)=>version.audioVersion===1?'Original WAV':`Variation · v${version.audioVersion}`;
type Pending={id:string;lyrics:string[];upload?:boolean};

export function MusicWorkshop({cloud,studioFile,active=true,onConnect,onBeatChange}:{cloud?:CloudMusicContext;studioFile:{name:string;source:string};active?:boolean;onConnect?():void;onBeatChange?(beat:NonNullable<MusicVersion["beat"]>|null):void}) {
  const {languageModel,vocals}=useGenerationAccess();
  const lyricRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>lyricRequest.current?.abort(),[cloud]);
  const [native,setNative]=useState<MusicBackend>();
  useEffect(()=>{queueMicrotask(()=>setNative(desktopMusic()));},[]);
  const backend=useMemo(()=>cloud?cloudMusic(cloud):native,[cloud,native]);
  const [songs,setSongs]=useState<{id:string;name:string;version:number}[]>([]);
  const [head,setHead]=useState<MusicVersion|null>(null),[song,setSong]=useState<MusicVersion|null>(null);
  useEffect(()=>{onBeatChange?.(song?.beat ?? null);},[song,onBeatChange]);
  const [history,setHistory]=useState<MusicVersion[]>([]),[nextBefore,setNextBefore]=useState<number>();
  const [lyrics,setLyrics]=useState<string[]>([]),[indices,setIndices]=useState<number[]>([]),[baseRevision,setBaseRevision]=useState(0);
  const [jobs,setJobs]=useState<MusicOperation[]>([]),[prompt,setPrompt]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [zoom,setZoom]=useState(1);
  const request=useRef(false),epoch=useRef(0),pending=useRef<Pending|null>(null),identity=useRef('');
  const autoplay=useRef<string|null>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const current=useRef({song,head,lyrics});useEffect(()=>{current.current={song,head,lyrics};},[song,head,lyrics]);
  const dirty=Boolean(song?.plan.chunks.some((chunk,index)=>lyrics[index]!==lyricsOf(chunk.text)));
  const running=jobs.some(job=>['queued','running'].includes(job.status));
  const blocked=busy||running;
  const {attach:attachAudio,...audio}=useMusicAudio(backend,song,active,history);
  const playSong=audio.play;
  useEffect(()=>{if(active&&audio.url&&!audio.loading&&audio.loadedId===song?.audioId&&autoplay.current===song?.audioId){autoplay.current=null;void playSong();}},[active,audio.url,audio.loadedId,audio.loading,song?.audioId,playSong]);
  function adopt(version:MusicVersion,latest=version){
    epoch.current++;current.current={song:version,head:latest,lyrics:version.plan.chunks.map(chunk=>lyricsOf(chunk.text))};
    setSong(version);setHead(latest);setLyrics(current.current.lyrics);setBaseRevision(latest.version);setIndices(version.plan.chunks.map((_,index)=>index));
  }
  async function load(id:string){if(!backend)return;const [latest,versions]=await Promise.all([backend.get(id),backend.versions(id)]);adopt(latest);setHistory(mergeHistory(versions));setNextBefore(versions.nextBefore);}
  useEffect(()=>{
    if(!backend)return;
    const key=cloud?`${cloud.url}:${cloud.projectId}:${cloud.token}`:'desktop',changed=identity.current!==key;identity.current=key;
    let cancelled=false,polling=false;
    const poll=async()=>{
      if(polling||request.current)return;polling=true;const ticket=epoch.current;
      try{
        const [list,operations]=await Promise.all([backend.list(),backend.operations()]);
        if(cancelled||ticket!==epoch.current||request.current)return;
        setSongs(list);setJobs(operations);
        const before=current.current,own=operations.find(job=>job.id===pending.current?.id),complete=own?.status==='completed';
        const id=complete&&pending.current?.upload?own.musicId:before.song?.id??list[0]?.id;
        if(id){
          const latest=await backend.get(id);
          if(cancelled||ticket!==epoch.current||request.current)return;
          if(latest.id!==before.head?.id||latest.version!==before.head?.version){
            const versions=await backend.versions(id);if(cancelled||ticket!==epoch.current||request.current)return;
            setHistory(mergeHistory(versions));setNextBefore(versions.nextBefore);setHead(latest);
            const hasDraft=before.song?.plan.chunks.some((chunk,index)=>before.lyrics[index]!==lyricsOf(chunk.text));
            const acknowledged=complete&&JSON.stringify(before.lyrics)===JSON.stringify(pending.current?.lyrics);
            if(hasDraft&&!acknowledged)setNotice('A newer composition is saved. Your lyric draft is preserved; reload to compare.');
            else if(!before.song||complete||before.song.version===before.head?.version){adopt(latest);if(complete)setNotice(own.resultVersion===1?'Your WAV is ready. Edit the lyrics or generate a first variation.':'Saved. Preview this variation or refine individual chunks.');}
            else setBaseRevision(latest.version);
          }
        }
        if(own&&['completed','failed','needs_review','conflict'].includes(own.status))pending.current=null;
      }catch(error){if(!cancelled)setNotice(message(error));}finally{polling=false;}
    };
    queueMicrotask(()=>{if(changed){epoch.current++;current.current={song:null,head:null,lyrics:[]};setSong(null);setHead(null);setLyrics([]);setSongs([]);setHistory([]);setJobs([]);pending.current=null;}void poll();});
    const timer=setInterval(()=>void poll(),1500);return()=>{cancelled=true;clearInterval(timer);};
  },[backend,cloud]);
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  async function action(work:()=>Promise<void>){if(request.current)return;request.current=true;epoch.current++;setBusy(true);setNotice('');try{await work();}catch(error){setNotice(message(error));}finally{request.current=false;setBusy(false);}}
  function track(operation:MusicOperation|null,upload=false){if(!operation)return;pending.current={id:operation.id,lyrics:[...lyrics],upload};setJobs(previous=>[operation,...previous.filter(job=>job.id!==operation.id)]);setNotice(upload?'Analyzing your WAV into chunks…':'Request saved. You can follow its progress here.');}
  async function submit(input:MusicAction){if(input.operation==='generate'&&!vocals)return;if(backend&&song)track(await backend.act(song.id,input,crypto.randomUUID()));}
  async function writeLyrics(){
    if(!languageModel||!song||!backend||blocked||dirty||!indices.length||!prompt.trim())return;
    const controller=new AbortController();lyricRequest.current=controller;
    await action(async()=>{
      try{
        const edits=await sendLyrics({prompt,chunks:indices.map(index=>({index,text:chunks[index]!.text,durationMs:chunks[index]!.durationMs}))},controller.signal);
        controller.signal.throwIfAborted();
        for(const edit of edits){const error=lyricEditError(chunks[edit.index]!.text,edit.lyrics);if(error)throw new Error(error);}
        await submit({operation:'edit',...actionBase,edits});
      }finally{lyricRequest.current=null;}
    });
  }
  function discard(){return !dirty||window.confirm('Discard the unsaved lyric draft?');}
  function select(version:MusicVersion){if(blocked||!head||!discard())return false;audio.pause();adopt(version,head);setNotice('');return true;}
  const actionBase={baseVersion:baseRevision,sourceVersion:song?.version};
  const chunks=song?.plan.chunks??[];
  const lyricErrors=chunks.map((chunk,index)=>lyrics[index]===lyricsOf(chunk.text)?undefined:lyricEditError(chunk.text,lyrics[index]??''));
  const invalidLyrics=lyricErrors.some(Boolean);
  const ranges=chunks.map((chunk,index)=>{const start=chunks.slice(0,index).reduce((sum,item)=>sum+item.durationMs/1000,0);return {index,start,end:start+chunk.durationMs/1000};});
  const start=ranges.at(-1)?.end??0;
  const currentChunk=ranges.find(range=>audio.position>=range.start&&audio.position<range.end)?.index??0;
  const duration=audio.duration||start;
  const recent=jobs[0];
  const editing=history.filter(item=>item.operation==='edit'||item.operation==='lyrics');
  const wavActions=<div className="music-wav-actions" aria-label="Add a WAV">
    <KeyHint reason={!vocals?VOCAL_KEY_HINT:undefined}><button disabled={blocked||!vocals} onClick={()=>{if(!vocals)return;if(!backend){onConnect?.();return;}if(!discard())return;if(backend.mode==='desktop')void action(async()=>track(await backend.upload(),true));else fileInput.current?.click();}}>↑ Upload WAV</button></KeyHint>
    <KeyHint reason={!vocals?VOCAL_KEY_HINT:undefined}><button disabled={blocked||!vocals} onClick={()=>{if(!vocals)return;if(!backend){onConnect?.();return;}if(discard())void action(async()=>{setNotice('Rendering the studio song…');const token=await prepareSong(studioFile.name,studioFile.source);const rendered=await renderWav(compileMusic(studioFile.source));track(await backend.rendered(rendered.wav,studioFile.name.replace(/\.banger$/,'.wav'),token,studioFile),true);});}}>Use studio WAV</button></KeyHint>
  </div>;
  return <section className="music-workshop" aria-label="Vocal Studio">
    {backend&&<input ref={fileInput} hidden type="file" accept=".wav,audio/wav" aria-label="Upload WAV" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file&&vocals&&discard())void action(async()=>{if(file.size>100*1024*1024)throw new Error('Choose a WAV up to 100 MiB.');track(await backend.upload(file),true);});}}/>}
    <header className="music-heading">
      <div><h1>{song?.name??'Make the next version.'}</h1></div>
      <div className="music-file-tools">
        {songs.length>0&&<select aria-label="Music project" value={song?.id??''} disabled={blocked} onChange={event=>{const id=event.target.value;if(discard())void action(()=>load(id));}}>{songs.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      </div>
    </header>
    <div className="music-body">
      <div className="music-center">
        <div className="music-editor-scroll">
          {song?<>
            <div className="music-editor-heading"><div><h2>Lyrics & chunks</h2><p>{audioName(song)} · Composition version {song.version}{dirty?' · Unsaved lyrics':''}</p></div><button disabled={blocked} onClick={()=>{if(discard())void action(()=>load(song.id));}}>Reload composition</button></div>
            {song.version!==head?.version&&<p className="music-branch-note">Viewing an earlier version. Your edits create a new version; this one stays saved.</p>}
            <div className="music-chunks">{chunks.map((chunk,index)=><article className={`music-chunk${indices.includes(index)?' is-selected':''}`} key={`${song.id}-${index}`} id={`music-chunk-${index}`} data-playing={audio.playing&&index===currentChunk}>
              <div className="music-chunk-heading"><label><input type="checkbox" checked={indices.includes(index)} disabled={blocked} onChange={event=>setIndices(value=>event.target.checked?[...value,index].sort((a,b)=>a-b):value.filter(item=>item!==index))}/><strong>{chunkName(chunk.text,index)}</strong></label><span>{clockTime(ranges[index]!.start)} – {clockTime(ranges[index]!.end)}</span>
                <button aria-label={`Preview chunk ${index+1}`} title="Preview this chunk" disabled={!audio.url||audio.loading} onClick={()=>{void audio.preview(ranges[index]!.start,ranges[index]!.end);}}>▷</button>
                <KeyHint reason={!vocals?VOCAL_KEY_HINT:undefined}><button disabled={!vocals||blocked||dirty} aria-label={`Retry chunk ${index+1}`} onClick={()=>void action(()=>submit({operation:'generate',...actionBase,indices:[index]}))}>↻ Retry</button></KeyHint>
              </div>
              <textarea aria-label={`Lyrics for chunk ${index+1}`} placeholder="Write lyrics for this chunk…" value={lyrics[index]??''} rows={Math.min(5,Math.max(2,(lyrics[index]??'').split('\n').length))} aria-invalid={Boolean(lyricErrors[index])} aria-describedby={`music-lyric-help-${index}`} disabled={blocked} onChange={event=>{epoch.current++;const value=event.target.value;setLyrics(previous=>previous.map((text,i)=>i===index?value:text));}}/>
              <p id={`music-lyric-help-${index}`} className="music-lyric-help" role={lyricErrors[index]?'alert':undefined}>{lyricErrors[index]??`Up to ${MAX_CHUNK_TEXT_LINES} lines, ${MAX_CHUNK_LINE_CHARACTERS} characters per line and ${MAX_CHUNK_TEXT_CHARACTERS.toLocaleString('en-US')} total, including the section label and retained directions.`}</p>
            </article>)}</div>
            <div className="music-refine-actions"><span>{indices.length} of {chunks.length} chunks selected</span><button disabled={blocked||!dirty||invalidLyrics} onClick={()=>void action(()=>submit({operation:'edit',...actionBase,edits:chunks.flatMap((chunk,index)=>lyrics[index]===lyricsOf(chunk.text)?[]:[{index,lyrics:lyrics[index]??''}])}))}>Save lyrics</button><KeyHint reason={!vocals?VOCAL_KEY_HINT:undefined}><button className="music-primary" aria-label={indices.length===chunks.length?'Generate new variation':'Regenerate selected chunks'} disabled={!vocals||blocked||dirty||!indices.length} onClick={()=>void action(()=>submit({operation:'generate',...actionBase,indices}))}>{indices.length===chunks.length?'Generate new variation':'Regenerate selected chunks'} <span aria-hidden="true">↗</span></button></KeyHint></div>
            <div className="music-replace-wav"><p>Start from another WAV</p>{wavActions}</div>
          </>:<div className="music-empty"><span className="music-empty-mark" aria-hidden="true">〰</span><h2>Your song, a new direction.</h2><p>Start with a WAV. Keep the original, write lyrics by chunk, and try new variations.</p>{wavActions}{!backend&&<p>Connect a cloud project to upload audio.</p>}</div>}
        </div>
        <form className="music-lyric-composer" onSubmit={event=>{event.preventDefault();void writeLyrics();}}>
          <label htmlFor="music-lyric-prompt">Generate lyrics <span>for {indices.length||'selected'} chunks</span></label>
          <textarea id="music-lyric-prompt" value={prompt} maxLength={2000} rows={2} disabled={!song||blocked} placeholder="Write a hopeful chorus about finding your way home…" onChange={event=>setPrompt(event.target.value)}/>
          <div><span>Lyrics only. Your music settings stay the same.</span><KeyHint reason={!languageModel?LLM_KEY_HINT:undefined}><button type="submit" className="music-primary" aria-label="Generate lyrics for selected chunks" disabled={!languageModel||!song||blocked||dirty||!prompt.trim()||!indices.length}>Generate lyrics ↑</button></KeyHint></div>
        </form>
        <div className="music-status" role="status">{notice||audio.error||(dirty?'Save your lyrics before generating audio.':null)}{recent&&<span className="music-job-progress">{recent.stage}<progress max={100} value={recent.progress} aria-label="Vocal Studio progress"/>{recent.error&&<span>{recent.error}</span>}</span>}</div>
      </div>
      <aside className="music-history" aria-label="Audio version history">
        <header><h2>History</h2><span>{history.filter(item=>item.operation==='generate').length} variations</span></header>
        <p className="music-history-help">Compare, preview, and refine any version.</p>
        {history.length===0?<div className="music-history-empty">Your original WAV will appear here, followed by each new variation.</div>:<ol>{history.map(version=>version.operation==='analyze'||version.operation==='generate'?<li key={version.version}>
          <div className={`music-history-card${song?.audioId===version.audioId?' is-current':''}`}>
            <button className="music-history-select" disabled={blocked} aria-label={`Select ${audioName(version)}`} aria-pressed={song?.audioId===version.audioId} onClick={()=>select(version)}><span>{audioName(version)}</span>{head?.audioId===version.audioId&&<small>latest</small>}<span className="music-history-date">{new Date(version.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</span></button>
            <div className="music-history-wave"><button aria-label={`Play ${audioName(version)}`} disabled={blocked||(!audio.url&&song?.audioId===version.audioId)} onClick={()=>{if(song?.audioId===version.audioId)void audio.toggle();else if(select(version))autoplay.current=version.audioId;}}>{song?.audioId===version.audioId&&audio.playing?'Ⅱ':'▶'}</button><button className="music-wave-select" disabled={blocked} aria-label={`View ${audioName(version)}`} onClick={()=>select(version)}><Waveform peaks={audio.waves[version.audioId]} progress={song?.audioId===version.audioId?audio.position/Math.max(1,duration):0}/></button></div>
          </div>
        </li>:<li key={version.version} className="music-history-edit"><button disabled={blocked} aria-current={song?.version===version.version?'true':undefined} onClick={()=>select(version)}>✎ {version.operation==='lyrics'?'AI lyrics generated':'Lyrics edited'}<span>v{version.version} ↗</span></button></li>)}</ol>}
        {nextBefore&&<button className="music-history-more" disabled={blocked} onClick={()=>void action(async()=>{if(!backend||!song)return;const next=await backend.versions(song.id,nextBefore);setHistory(previous=>mergeHistory(next,previous));setNextBefore(next.nextBefore);})}>Load earlier versions</button>}
        {editing.length>0&&<p className="music-history-help">Lyric edits keep the audio until you generate again.</p>}
      </aside>
    </div>
    <footer className="music-player" aria-label="Song player">
      <audio ref={attachAudio} src={audio.url||undefined} preload="metadata" aria-label="Vocal Studio song preview" onLoadedMetadata={event=>audio.setDuration(event.currentTarget.duration)} onTimeUpdate={event=>audio.updateTime(event.currentTarget)} onPlay={()=>audio.setPlaying(true)} onPause={()=>audio.setPlaying(false)} onEnded={()=>audio.setPlaying(false)} onError={()=>audio.setError('This audio could not be played. Try selecting it again.')}/>
      <div className="music-player-controls"><div className="music-player-view"><span>Timeline</span><button onClick={()=>setZoom(1)} disabled={!song}>Fit</button><label>Zoom<input aria-label="Timeline zoom" type="range" min={1} max={4} step={.25} value={zoom} onChange={event=>setZoom(Number(event.target.value))} disabled={!song}/></label><label className="music-volume">Volume<input aria-label="Preview volume" type="range" min={0} max={1} step={.05} value={audio.volume} onChange={event=>audio.setVolume(Number(event.target.value))}/></label></div>
        <div className="music-playback"><time>{clockTime(audio.position)}</time><button className="music-play" aria-label={audio.playing?'Pause song':'Play song'} disabled={!audio.url||audio.loading||!active} onClick={()=>void audio.toggle()}>{audio.playing?'Ⅱ':'▶'}</button><time>{clockTime(duration)}</time></div>
        <button disabled={!song||busy} onClick={()=>void action(async()=>{if(song&&backend)await backend.save(song);})}>↓ Download</button>
      </div>
      <div className="music-timeline-scroll"><div className="music-timeline" style={{width:`${zoom*100}%`}}>
        <div className="music-time-ruler">{Array.from({length:9},(_,index)=><span key={index}>{clockTime(duration*index/8)}</span>)}</div>
        <input className="music-seek" type="range" aria-label="Seek song" min={0} max={duration||1} step={.05} value={Math.min(audio.position,duration)} disabled={!audio.url} onChange={event=>audio.seek(Number(event.target.value))}/>
        <div className="music-timeline-chunks">{ranges.map(range=><button key={range.index} className={indices.includes(range.index)?'is-selected':''} aria-label={`Seek to ${chunkName(chunks[range.index]!.text,range.index)}`} style={{flex:chunks[range.index]!.durationMs}} onClick={()=>{audio.seek(range.start);setIndices([range.index]);document.getElementById(`music-chunk-${range.index}`)?.scrollIntoView({block:'nearest',behavior:'smooth'});}} disabled={!audio.url}><Waveform peaks={audio.waves[song!.audioId]?.slice(Math.floor(range.start/Math.max(1,start)*120),Math.max(1,Math.ceil(range.end/Math.max(1,start)*120)))}/><span>{chunkName(chunks[range.index]!.text,range.index)}</span></button>)}</div>
        {song&&<div className="music-playhead" style={{left:`${Math.min(100,audio.position/Math.max(1,duration)*100)}%`}}/>}
      </div></div>
    </footer>
  </section>;
}
