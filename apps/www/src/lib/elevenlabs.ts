import './song-storage';
import {aiSettingsBridge,browserElevenLabsKey} from './ai-providers';
import type { MusicVersion, MusicOperation, MusicAction, MusicHistory } from '@banger/elevenlabs/protocol';
import {audioUrl,cloudRequest,uploadWav,type CloudConnection} from './cloud-projects';
type MusicSummary={id:string;name:string;version:number};
export type MusicBackend={
  mode:'desktop'|'cloud';list():Promise<MusicSummary[]>;get(id:string):Promise<MusicVersion>;versions(id:string,before?:number):Promise<MusicHistory>;
  upload(file?:File):Promise<MusicOperation|null>;rendered(wav:ArrayBuffer,name:string,token?:string):Promise<MusicOperation>;
  act(id:string,action:MusicAction,key:string):Promise<MusicOperation>;operations():Promise<MusicOperation[]>;
  audio(version:MusicVersion):Promise<string>;save(version:MusicVersion):Promise<void>;
};
type NativeMusic={list():Promise<MusicSummary[]>;get(id:string):Promise<MusicVersion>;versions(id:string,before?:number):Promise<MusicHistory>;importWav(key:string):Promise<MusicOperation|null>;rendered(bytes:Uint8Array,name:string,key:string,token?:string):Promise<MusicOperation>;act:MusicBackend['act'];operations():Promise<MusicOperation[]>;operation(id:string):Promise<MusicOperation>;audio(id:string,version:number):Promise<{bytes:Uint8Array;contentType:string}>;save(id:string,version:number):Promise<boolean>};
declare global{interface Window{bangerMusic?:NativeMusic}}
export function desktopMusic():MusicBackend|undefined {
  const native=window.bangerMusic;if(!native)return;
  return {mode:'desktop',list:()=>native.list(),get:id=>native.get(id),versions:(id,before)=>native.versions(id,before),upload:()=>native.importWav(crypto.randomUUID()),rendered:(wav,name,token)=>native.rendered(new Uint8Array(wav),name,crypto.randomUUID(),token),act:(...args)=>native.act(...args),operations:async()=>{
    const operations=await native.operations();return Promise.all(operations.map(operation=>['queued','running','needs_review','failed'].includes(operation.status)?native.operation(operation.id):operation));
  },audio:async version=>{const audio=await native.audio(version.id,version.version);return URL.createObjectURL(new Blob([new Uint8Array(audio.bytes)],{type:audio.contentType}));},save:async version=>{await native.save(version.id,version.version);}};
}
export type CloudMusicContext=CloudConnection&{projectId:string;revision:number};
type Job={id:string;kind:string;status:string;stage:string;progress:number;error?:string;result?:{musicId?:string;version?:number}};
function operation(job:Job):MusicOperation{return {id:job.id,musicId:job.result?.musicId??'',status:job.status as MusicOperation['status'],stage:job.stage,progress:job.progress,error:job.error,resultVersion:job.result?.version};}
export async function cloudVocalRequest<T>(connection:CloudConnection,path:string,data:unknown):Promise<T>{
  const key=browserElevenLabsKey();
  if(!key)throw new Error('Add an ElevenLabs API key in Settings to generate vocals.');
  const url=new URL(connection.url||window.location.origin);
  if(url.username||url.password||url.search||url.hash||(url.protocol!=='https:'&&!(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.protocol==='http:')))throw new Error('Connect to your cloud server over HTTPS.');
  return cloudRequest<T>(connection,path,'POST',data,{'X-Banger-ElevenLabs-Key':key});
}
export function cloudMusic(connection:CloudMusicContext):MusicBackend {
  const submit=async(artifactId:string)=>operation(await cloudVocalRequest<Job>(connection,`/projects/${connection.projectId}/jobs`,{kind:'elevenlabs',idempotencyKey:crypto.randomUUID(),input:{artifactId}}));
  const upload=async(wav:ArrayBuffer)=>submit(await uploadWav({...connection,path:'upload.wav',source:''},wav,()=>undefined));
  return {mode:'cloud',list:async()=>(await cloudRequest<{music:MusicSummary[]}>(connection,`/projects/${connection.projectId}/music`)).music,get:id=>cloudRequest(connection,`/music/${id}`),
    versions:async(id,before)=>{const result=await cloudRequest<{versions:{document:MusicVersion}[];original:MusicVersion;nextBefore?:number}>(connection,`/music/${id}/versions${before?`?before=${before}`:''}`);return {...result,versions:result.versions.map(row=>row.document)};},
    upload:async file=>{if(!file)return null;return upload(await file.arrayBuffer());},rendered:async wav=>upload(wav),
    act:async(id,action,key)=>operation(await (action.operation==='edit'?cloudRequest<Job>(connection,`/music/${id}/actions`,'POST',{action,idempotencyKey:key}):cloudVocalRequest<Job>(connection,`/music/${id}/actions`,{action,idempotencyKey:key}))),
    operations:async()=>{
      const jobs=(await cloudRequest<{jobs:Job[]}>(connection,`/projects/${connection.projectId}/jobs`)).jobs.filter(job=>job.kind==='elevenlabs');
      const configured=(await aiSettingsBridge().load()).elevenLabsConfigured;
      for(const job of jobs.filter(job=>['queued','running'].includes(job.status)||(configured&&job.status==='awaiting_provider')))void (configured?cloudVocalRequest(connection,`/jobs/${job.id}/resume`,{}):cloudRequest(connection,`/jobs/${job.id}/resume`,'POST',{})).catch(()=>undefined);
      return jobs.map(operation);
    },audio:version=>audioUrl(connection,version.audioId),save:async version=>{
      const url=await audioUrl(connection,version.audioId);const link=document.createElement('a');link.href=url;link.download=`${version.name.replace(/[^a-zA-Z0-9_.-]/g,'_').replace(/\.(wav|mp3)$/,'')}-v${version.version}.${version.audioType==='audio/wav'?'wav':'mp3'}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    },
  };
}
