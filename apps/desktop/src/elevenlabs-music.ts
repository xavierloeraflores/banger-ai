import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ElevenMusic, associatedBeatSchema, MusicProviderError, musicActionSchema, performMusicAction, publicMusicError, validateWav, musicActionBase, type MusicProvider, type MusicVersion, type MusicOperation } from '@banger/elevenlabs';
import type { SongLocation } from './song-storage.js';
type StorageHooks = { imported(song: SongLocation, bytes: Uint8Array): Promise<unknown>; saved(song: SongLocation, version: MusicVersion, audio?: Uint8Array): Promise<unknown> };
const uuid=(value:unknown)=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new Error('Invalid music identifier.');return value;};
export function createMusicStore(root:string, provider:()=>MusicProvider|Promise<MusicProvider>=()=>new ElevenMusic(process.env.ELEVENLABS_API_KEY ?? ''), storage?: StorageHooks) {
  let queue:Promise<unknown>=Promise.resolve();
  let imports:Promise<unknown>=Promise.resolve();
  const active=new Map<string,string>();
  const jobs=new Set<string>();
  type StoredOperation=MusicOperation & {fingerprint:string};
  const fingerprint=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const prior=async(id:string,hash:string)=>{const task=await read<StoredOperation>(operationPath(id)).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});if(task&&task.fingerprint!==hash)throw new Error('This request key was already used for a different task.');return task;};
  const locked=<T>(work:()=>Promise<T>)=>{const task=queue.then(work);queue=task.catch(()=>undefined);return task;};
  const atomic=async(path:string,data:unknown)=>{await mkdir(root,{recursive:true});const temp=`${path}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(data),{mode:0o600});await rename(temp,path);};
  const read=<T>(path:string)=>readFile(path,'utf8').then(value=>JSON.parse(value) as T);
  const musicPath=(id:string)=>join(root,`music-${uuid(id)}.json`);
  const operationPath=(id:string)=>join(root,`operation-${uuid(id)}.json`);
  const audioPath=(id:string)=>join(root,`audio-${uuid(id)}`);
  const get=(id:string)=>read<MusicVersion>(musicPath(id));
  const getVersion=(id:string,version:number)=>{if(!Number.isInteger(version)||version<1)throw new Error('Invalid music version.');return read<MusicVersion>(join(root,`version-${uuid(id)}-${version}.json`));};
  async function catalog(){return read<{id:string;name:string;version:number}[]>(join(root,'catalog.json')).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});}
  async function publish(version:MusicVersion,expected:number) {
    await locked(async()=>{
      const current=await get(version.id).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
      if((current?.version??0)!==expected)throw new Error('This song changed. Reload before saving.');
      const versionPath=join(root,`version-${version.id}-${version.version}.json`);
      try{await writeFile(versionPath,JSON.stringify(version),{flag:'wx',mode:0o600});}
      catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(versionPath,'utf8')!==JSON.stringify(version))throw error;}
      const location = await read<SongLocation>(join(root, `location-${version.id}.json`)).catch((error:NodeJS.ErrnoException) => { if(error.code==='ENOENT') return undefined; throw error; });
      const receipt = join(root, `archived-${version.id}-${version.version}.json`);
      const archived = await read<boolean>(receipt).catch((error:NodeJS.ErrnoException) => { if(error.code==='ENOENT') return false; throw error; });
      if (storage && location && !archived) {
        const audio = version.operation === 'generate' ? new Uint8Array(await readFile(audioPath(version.audioId))) : undefined;
        await storage.saved(location, version, audio);
        await atomic(receipt, true);
      }
      await atomic(musicPath(version.id),version);
      const list=await catalog();await atomic(join(root,'catalog.json'),[{id:version.id,name:version.name,version:version.version},...list.filter(item=>item.id!==version.id)]);
    });
  }
  async function operation(id:string){
    const value=await read<MusicOperation>(operationPath(id));
    if(['running','queued'].includes(value.status)&&!jobs.has(id)) {
      value.status='needs_review';value.error='The app closed during this request. Check ElevenLabs history before starting another paid request.';
      await atomic(operationPath(id),value);
    }
    return value;
  }
  async function launch(musicId:string,id:string,work:()=>Promise<{version:MusicVersion;audio?:Uint8Array}>,expected:number,hash:string,paid=true) {
    return locked(async()=>{
      const previous=await prior(id,hash);
      if(previous){if(previous.musicId!==musicId)throw new Error('This request key belongs to another song.');return previous;}
      if(active.has(musicId))throw new Error('Wait for the current song operation to finish.');
      const task:StoredOperation={id,musicId,fingerprint:hash,status:'queued',progress:0,stage:'queued'};
      await atomic(operationPath(id),task);
      const operationIds=await read<string[]>(join(root,'operation-catalog.json')).catch(()=>[]);
      await atomic(join(root,'operation-catalog.json'),[id,...operationIds.filter(value=>value!==id)].slice(0,50));
      active.set(musicId,id);jobs.add(id);
      void (async()=>{
        try {
          task.status='running';task.progress=20;task.stage='processing';await atomic(operationPath(id),task);
          const result=await work();
          task.progress=90;task.stage='saving';await atomic(operationPath(id),task);
          if(result.audio)await writeFile(audioPath(result.version.audioId),result.audio,{flag:'wx',mode:0o600});
          await atomic(join(root,`result-${id}.json`),result.version);
          await publish(result.version,expected);
          task.status='completed';task.progress=100;task.stage='completed';task.resultVersion=result.version.version;
        } catch(error) {
          task.status=error instanceof MusicProviderError&&!error.uncertain?'failed':paid?'needs_review':'failed';task.stage=task.status;
          task.error=publicMusicError(error);
        } finally {
          await atomic(operationPath(id),task).catch(()=>undefined);active.delete(musicId);jobs.delete(id);
        }
      })();
      return {...task};
    });
  }
  async function belongs(id:string, location:SongLocation) {
    const saved=await read<SongLocation>(join(root,`location-${uuid(id)}.json`)).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
    return saved?.root===location.root && saved.name===location.name;
  }
  return {
    async list(location?:SongLocation){
      const list=await catalog();
      if(!location)return list;
      const matches=await Promise.all(list.map(async item=>({item,match:await belongs(item.id,location)})));
      return matches.filter(value=>value.match).map(value=>value.item);
    },get,operation,
    async versions(id:string,before?:number){
      const current=await get(id);if(before!==undefined&&(!Number.isInteger(before)||before<1))throw new Error('Invalid history cursor.');
      const end=Math.min(current.version,(before??current.version+1)-1),start=Math.max(1,end-49);
      const versions=await Promise.all(Array.from({length:Math.max(0,end-start+1)},(_,index)=>getVersion(id,end-index)));
      return {versions,original:await getVersion(id,1),...(start>1?{nextBefore:start}:{})};
    },
    async operations(location?:SongLocation){const ids=await read<string[]>(join(root,'operation-catalog.json')).catch(()=>[]);const tasks=await Promise.all(ids.map(id=>operation(id)));if(!location)return tasks;const matches=await Promise.all(tasks.map(async task=>({task,match:await belongs(task.musicId,location)})));return matches.filter(value=>value.match).map(value=>value.task);},
    async importWav(bytes:Uint8Array,name:string,key:string,location?:SongLocation,beat?:MusicVersion["beat"],studioPath?:string) {
      if (beat) beat = associatedBeatSchema.parse(beat);
      const imported = imports.then(async () => {
      uuid(key);validateWav(bytes,false);await mkdir(root,{recursive:true});
      const hash=fingerprint({name,...(location ? {location} : {}),...(studioPath ? {studioPath} : {}),...(beat ? {beat} : {}),sha:createHash('sha256').update(bytes).digest('hex')});
      const existing=await prior(key,hash);
      if(existing)return existing;
      const id=key,audioId=randomUUID();
      if (location) {
        await atomic(join(root, `location-${id}.json`), location);
        await storage?.imported(location, bytes);
      }
      validateWav(bytes);
      await writeFile(audioPath(audioId),bytes,{flag:'wx',mode:0o600});
      return launch(id,key,async()=>{
        const result=await (await provider()).analyze(bytes,name);
        return {version:{id,version:1,name,...(studioPath ? {studioPath} : {}),...(beat ? {beat} : {}),songId:result.songId,originalSongId:result.songId,plan:result.plan,audioMetadata:result.audioMetadata,audioId,audioType:'audio/wav',audioVersion:1,createdAt:new Date().toISOString(),operation:'analyze'}};
      },0,hash);
      });
      imports = imported.catch(() => undefined);
      return imported;
    },
    async bind(id:string, location:SongLocation) {
      if (!storage) return;
      await locked(async () => {
        const path = join(root, `location-${uuid(id)}.json`);
        const bound = await read<SongLocation>(path).catch((error:NodeJS.ErrnoException) => { if(error.code==='ENOENT') return undefined; throw error; });
        const completePath = join(root, `bound-${id}.json`);
        const complete = await read<boolean>(completePath).catch((error:NodeJS.ErrnoException) => { if(error.code==='ENOENT') return false; throw error; });
        if (bound && complete) return;
        location = bound ?? location;
        const current = await get(id);
        await atomic(path, location);
        for(let number=1;number<=current.version;number++) {
          const version = await getVersion(id,number);
          const receipt = join(root, `archived-${id}-${number}.json`);
          const archived = await read<boolean>(receipt).catch((error:NodeJS.ErrnoException) => { if(error.code==='ENOENT') return false; throw error; });
          if (!archived) {
            if(number===1) await storage.imported(location,new Uint8Array(await readFile(audioPath(version.audioId))));
            await storage.saved(location,version,version.operation==='generate'?new Uint8Array(await readFile(audioPath(version.audioId))):undefined);
            await atomic(receipt,true);
          }
        }
        await atomic(completePath,true);
      });
    },
    async location(id:string) {
      return read<SongLocation>(join(root, `location-${uuid(id)}.json`)).catch((error:NodeJS.ErrnoException) => { if(error.code==='ENOENT') return undefined; throw error; });
    },
    async act(id:string,input:unknown,key:string){
      uuid(key);const action=musicActionSchema.parse(input),hash=fingerprint({id,action});
      const existing=await prior(key,hash);if(existing)return existing;
      const current=await get(id);
      const base=musicActionBase(current,action.sourceVersion?await getVersion(id,action.sourceVersion):current,action);
      base.originalSongId ??= (await getVersion(id,1)).songId;
      return launch(id,key,()=>performMusicAction(provider,base,action,key),base.version,hash,action.operation!=='edit');
    },
    async audio(id:string,version?:number){
      const current=version===undefined?await get(id):await getVersion(id,version);
      const bytes=await readFile(audioPath(current.audioId));
      return {bytes:new Uint8Array(bytes),contentType:current.audioType};
    },
    async recover(id:string){
      const task=await operation(id);
      if(jobs.has(id))return task;
      const result=await read<MusicVersion>(join(root,`result-${uuid(id)}.json`)).catch(()=>null);
      if(result){
        const current=await get(result.id).catch(()=>null);
        if(current?.version===result.version&&current.audioId===result.audioId){task.status='completed';task.progress=100;task.resultVersion=result.version;delete task.error;}
        else if((current?.version??0)===result.version-1){await publish(result,result.version-1);task.status='completed';task.progress=100;task.resultVersion=result.version;delete task.error;}
        else{task.status='conflict';task.error='Another revision is current. The completed result is retained locally.';}
        if(task.status==='completed')await locked(async()=>{const list=await catalog();await atomic(join(root,'catalog.json'),[{id:result.id,name:result.name,version:result.version},...list.filter(item=>item.id!==result.id)]);});
        task.stage=task.status;await atomic(operationPath(id),task);
      }
      return task;
    },
  };
}
