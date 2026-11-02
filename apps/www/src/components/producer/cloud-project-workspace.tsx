'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {MusicWorkshop} from './music-workshop';
import {compileMusic} from '@banger/compiler';
import {Button} from '@banger/shadcn';
import {audioUrl,cloudRequest,mergeCloudDelta,type CloudBinding,type CloudConnection,type CloudJob,type CloudSnapshot} from '@/lib/cloud-projects';
type Artifact={id:string;kind:string;revision:number;status:string};
const message=(error:unknown)=>error instanceof Error ? error.message : 'The cloud operation failed.';
export function CloudProjectWorkspace({studioFile,onLoad,onDisconnect}:{studioFile:{name:string;source:string};onLoad(file:{name:string;source:string},binding:CloudBinding):void;onDisconnect():void}) {
  const [available,setAvailable]=useState(false);
  useEffect(()=>{queueMicrotask(()=>setAvailable(!window.bangerWorkspace));},[]);
  const [url,setUrl]=useState(process.env.NEXT_PUBLIC_BANGER_API_URL ?? 'http://localhost:3001');
  const [token,setToken]=useState('');
  const [connection,setConnection]=useState<CloudConnection|null>(null);
  const [projects,setProjects]=useState<{id:string;name:string;revision:number}[]>([]);
  const [snapshot,setSnapshot]=useState<CloudSnapshot|null>(null);
  const [path,setPath]=useState('');
  const [source,setSource]=useState('');
  const [draftBase,setDraftBase]=useState<number|null>(null);
  const [prompt,setPrompt]=useState('');
  const [jobs,setJobs]=useState<CloudJob[]>([]);
  const [artifacts,setArtifacts]=useState<Artifact[]>([]);
  const [playing,setPlaying]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const pending=useRef(false);
  const current=useRef({snapshot,path,source,draftBase});
  const generation=useRef(0);
  const pollBusy=useRef(false);
  useEffect(()=>{current.current={snapshot,path,source,draftBase};},[snapshot,path,source,draftBase]);
  const projectId=snapshot?.projectId;
  const revision=snapshot?.revision;
  const cloudMusicContext=useMemo(()=>connection&&projectId&&revision!==undefined?{...connection,projectId,revision}:undefined,[connection,projectId,revision]);
  const file=snapshot?.files.find(file=>file.path===path);
  const dirty=draftBase !== null;
  useEffect(()=>()=>{if(playing) URL.revokeObjectURL(playing);},[playing]);
  useEffect(()=>{
    if(!dirty) return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  useEffect(()=>{
    if(!connection || !projectId) return;
    let cancelled=false;
    async function poll() {
      if(pollBusy.current || pending.current) return;
      pollBusy.current=true;
      const epoch=generation.current;
      try {
        const [delta,jobList,audioList]=await Promise.all([
          cloudRequest<CloudSnapshot>(connection!,`/projects/${projectId}?since=${current.current.snapshot?.revision ?? 0}`),
          cloudRequest<{jobs:CloudJob[]}>(connection!,`/projects/${projectId}/jobs`),
          cloudRequest<{artifacts:Artifact[]}>(connection!,`/projects/${projectId}/artifacts`),
        ]);
        if(cancelled || epoch !== generation.current || pending.current) return;
        const before=current.current;
        if(!before.snapshot || before.snapshot.projectId !== projectId) return;
        const next=mergeCloudDelta(before.snapshot,delta);
        setSnapshot(next);setJobs(jobList.jobs);setArtifacts(audioList.artifacts);
        if(before.draftBase === null) {
          const selected=next.files.find(file=>file.path===before.path);
          if(selected) setSource(selected.source);
          else {setPath(next.files[0]?.path ?? '');setSource(next.files[0]?.source ?? '');}
        } else if(delta.revision !== before.snapshot.revision) setNotice('The saved project changed. Your draft is preserved. Review the saved revision before merging.');
        for(const job of jobList.jobs.filter(job=>['queued','running'].includes(job.status))) await cloudRequest(connection!,`/jobs/${job.id}/resume`,'POST',{});
      } catch(error) {if(!cancelled) setNotice(message(error));}
      finally {pollBusy.current=false;}
    }
    void poll(); const timer=window.setInterval(()=>void poll(),5000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[connection,projectId]); // The ref supplies the latest revision without restarting the poller.
  async function action(work:()=>Promise<void>) {
    if(pending.current)return; pending.current=true;generation.current++;setBusy(true);setNotice('');
    try {await work();} catch(error){setNotice(message(error));} finally{pending.current=false;setBusy(false);}
  }
  function adopt(next:CloudSnapshot){setSnapshot(next);setPath(next.files[0]?.path ?? '');setSource(next.files[0]?.source ?? '');setDraftBase(null);setJobs([]);setArtifacts([]);setPlaying('');}
  function discard(){return !dirty || window.confirm('Discard the unsaved cloud workspace draft?');}
  async function refreshProjects(active:CloudConnection){setProjects((await cloudRequest<{projects:typeof projects}>(active,'/projects')).projects);}
  if(!available) return null;
  return <details className="project-workspace producer-panel"><summary>Cloud projects</summary>
    {!connection ? <form onSubmit={event=>{event.preventDefault();void action(async()=>{
      const parsed=new URL(url);if(parsed.protocol !== 'https:' && !(['localhost','127.0.0.1'].includes(parsed.hostname)&&parsed.protocol==='http:'))throw new Error('Use HTTPS for the cloud backend.');
      const next={url:parsed.origin,token:token.trim()};await refreshProjects(next);setConnection(next);setToken('');
    });}}>
      <label>Backend URL<input type="url" value={url} onChange={event=>setUrl(event.target.value)} required /></label>
      <label>Cloud access token<input type="password" autoComplete="off" value={token} onChange={event=>setToken(event.target.value)} required /></label>
      <Button type="submit" disabled={busy}>Connect cloud projects</Button>
    </form> : <>
      <div className="project-workspace-actions"><Button disabled={busy} onClick={()=>void action(()=>refreshProjects(connection))}>Refresh projects</Button>
        <Button disabled={busy} onClick={()=>{if(!discard())return;generation.current++;setConnection(null);setSnapshot(null);setPlaying('');setDraftBase(null);onDisconnect();}}>Disconnect</Button>
        <Button disabled={busy} onClick={()=>{if(!discard())return;void action(async()=>{
          compileMusic(studioFile.source);
          const name=studioFile.name.replace(/\.banger$/,'');
          const created=await cloudRequest<{projectId:string}>(connection,'/projects','POST',{name,files:[{path:studioFile.name.replace(/[^a-zA-Z0-9_.-]/g,'_').replace(/^\.+/,'') || 'song.banger',source:studioFile.source}]});
          adopt(await cloudRequest(connection,`/projects/${created.projectId}`));await refreshProjects(connection);
        });}}>Create project from studio</Button>
      </div>
      <label>Project<select value={snapshot?.projectId ?? ''} disabled={busy} onChange={event=>{const project=event.target.value;if(project&&discard())void action(async()=>adopt(await cloudRequest(connection,`/projects/${project}`)));}}>
        <option value="">Choose project</option>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>
      {snapshot && <>
        <MusicWorkshop cloud={cloudMusicContext} studioFile={studioFile}/>
        <p>Saved revision {snapshot.revision}{dirty ? ` · Draft based on revision ${draftBase}` : ''}</p>
        <label>Cloud music file<select disabled={busy} value={path} onChange={event=>{const next=snapshot.files.find(file=>file.path===event.target.value);if(next&&discard()){generation.current++;setPath(next.path);setSource(next.source);setDraftBase(null);}}}>
          <option value="" disabled>Choose a file</option>{snapshot.files.map(file=><option key={file.path}>{file.path}</option>)}
        </select></label>
        {path && <>
          <label htmlFor="cloud-source">{path}{dirty ? ' · Unsaved draft' : ''}</label>
          <textarea id="cloud-source" value={source} spellCheck={false} disabled={busy} onChange={event=>{generation.current++;setDraftBase(value=>value ?? snapshot.revision);setSource(event.target.value);}} />
          <div className="project-workspace-actions">
            <Button disabled={busy} onClick={()=>{if(discard()){setSource(studioFile.source);setDraftBase(snapshot.revision);}}}>Use studio edits in this file</Button>
            <Button disabled={!dirty || busy} onClick={()=>void action(async()=>{
              compileMusic(source);await cloudRequest(connection,`/projects/${snapshot.projectId}`,'PATCH',{baseRevision:draftBase,changes:[{path,source}]});
              const next=await cloudRequest<CloudSnapshot>(connection,`/projects/${snapshot.projectId}`);setSnapshot(next);setSource(next.files.find(file=>file.path===path)?.source ?? '');setDraftBase(null);setNotice('Project revision saved.');
            })}>Save cloud file</Button>
            <Button disabled={busy} onClick={()=>{if(discard())void action(async()=>{const next=await cloudRequest<CloudSnapshot>(connection,`/projects/${snapshot.projectId}`);setSnapshot(next);setSource(next.files.find(file=>file.path===path)?.source ?? '');setDraftBase(null);});}}>Reload saved file</Button>
            <Button disabled={busy || !dirty || draftBase===snapshot.revision} onClick={()=>{if(window.confirm('Use the latest revision as the base for this draft? Review and merge the saved changes first.'))setDraftBase(snapshot.revision);}}>Use latest revision as draft base</Button>
            <Button disabled={busy || dirty} onClick={()=>{compileMusic(source);onLoad({name:path.split('/').pop()!,source},{...connection,projectId:snapshot.projectId,revision:snapshot.revision,path,source});}}>Load cloud file in studio</Button>
          </div>
          {dirty && <details><summary>Compare saved source at revision {snapshot.revision}</summary><pre>{file?.source ?? "This file was deleted in the saved revision."}</pre></details>}
        </>}
        <form onSubmit={event=>{event.preventDefault();void action(async()=>{await cloudRequest(connection,`/projects/${snapshot.projectId}/jobs`,'POST',{kind:'agent',idempotencyKey:crypto.randomUUID(),input:{baseRevision:snapshot.revision,prompt,...(path?{activeFile:path}:{})}});setNotice('Agent task queued. You can leave this page and return to its progress.');});}}>
          <label>Cloud agent task<textarea value={prompt} maxLength={16000} onChange={event=>setPrompt(event.target.value)} /></label>
          <Button type="submit" disabled={busy || dirty || !prompt.trim()}>Run cloud agent</Button>
        </form>
        <ul aria-label="Cloud jobs">{jobs.map(job=><li key={job.id}>
          {job.kind === 'agent' ? 'Project agent' : 'ElevenLabs'}: {job.status === 'awaiting_provider' ? 'ElevenLabs configuration required' : job.stage} <progress max={100} value={job.progress} aria-label={`${job.kind} progress`} /> {job.progress}%
          {job.error && <p>{job.error}</p>}
          {job.activity.length>0 && <details><summary>Agent activity</summary><ol>{job.activity.map((entry,index)=><li key={index}>{entry}</li>)}</ol></details>}
          {job.result?.candidateAvailable && <Button disabled={busy} onClick={()=>{if(!discard())return;void action(async()=>{
            const candidate=await cloudRequest<{files:{path:string;source:string}[]}>(connection,`/jobs/${job.id}/candidate`);
            const blob=new Blob([JSON.stringify(candidate,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='agent-candidate.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),60000);
            setNotice('Downloaded the agent candidate files for comparison. The saved revision is unchanged.');
          });}}>Download conflicting agent files</Button>}
          {job.status==='awaiting_provider' && <Button disabled={busy} onClick={()=>void action(async()=>{await cloudRequest(connection,`/jobs/${job.id}/resume`,'POST',{});setNotice('Checking provider availability.');})}>Retry after configuring ElevenLabs</Button>}
        </li>)}</ul>
        <ul aria-label="Cloud audio">{artifacts.map(artifact=><li key={artifact.id}>{artifact.kind} · revision {artifact.revision} · {artifact.status}
          {artifact.status==='ready' && <><Button disabled={busy} onClick={()=>void action(async()=>setPlaying(await audioUrl(connection,artifact.id)))}>Listen</Button>
            <Button disabled={busy} onClick={()=>void action(async()=>{const link=document.createElement('a');link.href=await audioUrl(connection,artifact.id);link.download=`${artifact.id}.${artifact.kind==='wav'?'wav':'audio'}`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),60000);})}>Download audio</Button>
            {artifact.kind==='wav' && <Button disabled={busy} onClick={()=>void action(async()=>{await cloudRequest(connection,`/projects/${snapshot.projectId}/jobs`,'POST',{kind:'elevenlabs',idempotencyKey:crypto.randomUUID(),input:{artifactId:artifact.id}});setNotice('WAV submitted for composition analysis. Open the ElevenLabs song workshop to edit its lyrics.');})}>Submit to ElevenLabs</Button>}
          </>}
        </li>)}</ul>
        {playing && <audio controls src={playing} aria-label="Cloud audio preview" />}
      </>}
    </>}
    {notice && <p role="status">{notice}</p>}
  </details>;
}
