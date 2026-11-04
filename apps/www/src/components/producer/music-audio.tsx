'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {MusicVersion} from '@banger/elevenlabs/protocol';
import type {MusicBackend} from '@/lib/elevenlabs';

export const clockTime=(seconds:number)=>`${Math.floor(Math.max(0,seconds)/60)}:${String(Math.floor(Math.max(0,seconds)%60)).padStart(2,'0')}`;
export function Waveform({peaks,progress=0}:{peaks?:number[];progress?:number}) {
  return <svg className="music-waveform" viewBox="0 0 360 48" preserveAspectRatio="none" aria-hidden="true">
    {peaks?peaks.map((peak,index)=><rect key={index} x={index*360/peaks.length} y={24-Math.max(1,peak*22)} width={Math.max(.5,360/peaks.length*.58)} height={Math.max(2,peak*44)} rx={.8} className={index/peaks.length<progress?'is-played':undefined}/>):<path d="M0 24H360" className="music-wave-pending"/>}
  </svg>;
}
async function audioPeaks(url:string,duration:number) {
  // Downsample for display; keep decoding bounded and let the media element handle larger audio.
  const response=await fetch(url);const blob=await response.blob();
  if(blob.size>32*1024*1024 || duration>600)return undefined;
  const header=new DataView(await blob.slice(0,44).arrayBuffer());
  const wav=header.byteLength>=24&&header.getUint32(0,false)===0x52494646;
  const channels=wav?(header.getUint32(12,false)===0x666d7420?header.getUint16(22,true):8):2;
  if(duration*8000*channels*4>64*1024*1024)return undefined;
  const context=new AudioContext({sampleRate:8000});
  try {
    const decoded=await context.decodeAudioData(await blob.arrayBuffer());
    const channel=decoded.getChannelData(0),stride=Math.max(1,Math.ceil(channel.length/120));
    const peaks=Array.from({length:120},(_,index)=>{let peak=0;for(let sample=index*stride;sample<Math.min(channel.length,(index+1)*stride);sample++)peak=Math.max(peak,Math.abs(channel[sample]!));return peak;});
    const maximum=Math.max(.01,...peaks);return peaks.map(peak=>peak/maximum);
  } finally {await context.close();}
}
export function useMusicAudio(backend:MusicBackend|undefined,song:MusicVersion|null,active:boolean,history:MusicVersion[]) {
  const player=useRef<HTMLAudioElement>(null),clipEnd=useRef<number|null>(null);
  const [loadedId,setLoadedId]=useState('');
  const [url,setUrl]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [position,setPosition]=useState(0),[duration,setDuration]=useState(0),[playing,setPlaying]=useState(false),[volume,setVolume]=useState(.8);
  const [waves,setWaves]=useState<Record<string,number[]>>({});
  const generation=useRef(0),cache=useRef(new Map<string,number[]|undefined>());
  const songRef=useRef(song);useEffect(()=>{songRef.current=song;},[song]);
  const audioId=song?.audioId;
  useEffect(()=>{cache.current.clear();queueMicrotask(()=>setWaves({}));},[backend]);
  useEffect(()=>{
    const version=songRef.current;const epoch=++generation.current;const element=player.current;let disposed=false,objectUrl='';
    queueMicrotask(()=>{setUrl('');setLoadedId('');setPosition(0);setPlaying(false);setDuration(0);setError('');setLoading(Boolean(backend&&version));});
    if(backend&&version)void(async()=>{
      try{
        objectUrl=await backend.audio(version);if(disposed){URL.revokeObjectURL(objectUrl);return;}
        setUrl(objectUrl);setLoadedId(version.audioId);setLoading(false);
        const seconds=version.plan.chunks.reduce((sum,chunk)=>sum+chunk.durationMs,0)/1000;
        const peaks=cache.current.get(version.audioId)??await audioPeaks(objectUrl,seconds);
        if(!disposed&&epoch===generation.current&&peaks){cache.current.set(version.audioId,peaks);setWaves(previous=>({...previous,[version.audioId]:peaks}));}
      }catch(cause){if(!disposed){setLoading(false);setError(cause instanceof Error?cause.message:'Audio could not be loaded.');}}
    })();
    return()=>{disposed=true;clipEnd.current=null;element?.pause();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[backend,audioId]);
  // Only the few visible history cards are decoded, one at a time; audio URLs are released immediately.
  useEffect(()=>{
    if(!backend||!active||loading)return;let disposed=false;
    void(async()=>{
      for(const version of history.filter(item=>['analyze','generate'].includes(item.operation)).slice(-5)){
        if(disposed)break;if(version.audioId===audioId||cache.current.has(version.audioId))continue;
        let objectUrl='';
        try{objectUrl=await backend.audio(version);if(disposed)break;
          const peaks=await audioPeaks(objectUrl,version.plan.chunks.reduce((sum,chunk)=>sum+chunk.durationMs,0)/1000);
          if(!disposed){cache.current.set(version.audioId,peaks);if(peaks)setWaves(previous=>({...previous,[version.audioId]:peaks}));}
        }catch{/* Playback remains available when a thumbnail cannot be decoded. */}
        finally{if(objectUrl)URL.revokeObjectURL(objectUrl);}
      }
    })();return()=>{disposed=true;};
  },[backend,history,active,audioId,loading]);
  useEffect(()=>{if(!active)player.current?.pause();},[active]);
  useEffect(()=>{if(player.current)player.current.volume=volume;},[volume,url]);
  async function play(){const element=player.current;if(!element)return;try{await element.play();}catch{setError('Audio playback could not start. Try again.');}}
  function pause(){player.current?.pause();clipEnd.current=null;}
  async function toggle(){const element=player.current;clipEnd.current=null;if(!element)return;if(element.paused)await play();else pause();}
  function seek(seconds:number){const element=player.current;clipEnd.current=null;if(!element||!Number.isFinite(element.duration))return;element.currentTime=Math.max(0,Math.min(element.duration,seconds));setPosition(element.currentTime);}
  async function preview(start:number,end:number){seek(start);clipEnd.current=end;await play();}
  function updateTime(element:HTMLAudioElement){setPosition(element.currentTime);if(clipEnd.current!==null&&element.currentTime>=clipEnd.current){element.pause();clipEnd.current=null;}}
  const clearPreview=useCallback(()=>{clipEnd.current=null;},[]);
  return {player,clearPreview,attach:(element:HTMLAudioElement|null)=>{player.current=element;},url:loadedId===audioId?url:'',loadedId,loading:loading||Boolean(song&&loadedId!==audioId),error,position:loadedId===audioId?position:0,duration:loadedId===audioId?duration:0,playing:loadedId===audioId&&playing,volume,waves,setVolume,toggle,play,pause,preview,seek,updateTime,setDuration,setPlaying,setError};
}
