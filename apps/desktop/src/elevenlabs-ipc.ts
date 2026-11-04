import { librarySongType } from '@banger/elevenlabs/protocol';
import { songStorage } from '@banger/harness';
import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { open, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { toWav } from './audio-conversion.js';
import type { SongLocation } from './song-storage.js';
import type { MusicVersion } from '@banger/elevenlabs';
import type { SongStorageBridge } from './song-storage-ipc.js';
import { ElevenMusic, MusicProviderError, MAX_WAV_BYTES, lyricsOf } from '@banger/elevenlabs';
import { createMusicStore } from './elevenlabs-music.js';
export function musicStorageHooks(storage: SongStorageBridge['storage']) {
  return {
    current: async (song: SongLocation) => { const source=await songStorage.readCurrentLyrics(song); return source ? JSON.parse(source) as MusicVersion : null; },
    imported: (song: SongLocation, bytes: Uint8Array) => storage.saveAudio(song, 'instrumentals', bytes),
    saved: async (song: SongLocation, version: MusicVersion, audio?: Uint8Array) => {
      if (audio) await storage.saveAudio(song, version.plan.chunks.some(chunk => lyricsOf(chunk.text)) ? 'vocals' : 'instrumentals', await toWav(audio));
      await storage.saveLyrics(song, { schemaVersion: 1, musicId: version.id, ...version });
    },
  };
}
export function installMusicHandlers(senderWindow:(event:IpcMainInvokeEvent)=>BrowserWindow, suppliedStore?:ReturnType<typeof createMusicStore>, storage?:SongStorageBridge, apiKey?:()=>Promise<string|null>) {
  if(!apiKey&&!app.isPackaged&&!process.env.ELEVENLABS_API_KEY){try{process.loadEnvFile(join(app.getAppPath(),'.env.local'));}catch{/* Credentials may instead be supplied by the launch environment. */}}
  const store=suppliedStore??createMusicStore(join(app.getPath('userData'),'elevenlabs-music'), apiKey ? async () => {
    const key=await apiKey();
    if(!key)throw new MusicProviderError('Add an ElevenLabs API key in Settings to generate vocals.');
    return new ElevenMusic(key);
  } : undefined, storage ? musicStorageHooks(storage.storage) : undefined);
  const dialogs=new Set<number>();
  ipcMain.handle('banger:music-list',(event,token?:string)=>{const window=senderWindow(event);return store.list(token&&storage?storage.resolve(window,token):undefined);});
  ipcMain.handle('banger:music-operations',(event,token?:string)=>{const window=senderWindow(event);return store.operations(token&&storage?storage.resolve(window,token):undefined);});
  ipcMain.handle('banger:music-versions',(event,id:string,before?:number)=>{senderWindow(event);return store.versions(id,before);});
  ipcMain.handle('banger:music-get',(event,id:string)=>{senderWindow(event);return store.refresh(id);});
  ipcMain.handle('banger:music-operation',(event,id:string)=>{senderWindow(event);return store.recover(id);});
  ipcMain.handle('banger:music-act',async(event,id:string,input:unknown,key:string)=>{
    const window=senderWindow(event);
    if(storage) await store.bind(id,await store.location(id) ?? await storage.prepare(window,(await store.get(id)).name));
    return store.act(id,input,key);
  });
  ipcMain.handle('banger:music-audio',(event,id:string,version?:number)=>{senderWindow(event);return store.audio(id,version);});
  ipcMain.handle('banger:music-import',async(event,key:string,token?:string)=>{
    const window=senderWindow(event);if(dialogs.has(window.id))throw new Error('A music file dialog is already open.');dialogs.add(window.id);
    try{
      const location=token&&storage?storage.resolve(window,token):undefined;
      const selected=await dialog.showOpenDialog(window,{title:'Upload WAV to ElevenLabs',filters:[{name:'WAV audio',extensions:['wav']}],properties:['openFile']});
      if(selected.canceled||!selected.filePaths[0])return null;
      const file=await open(selected.filePaths[0],'r');
      try{const stat=await file.stat();if(!stat.isFile()||stat.size>MAX_WAV_BYTES)throw new Error('Choose a WAV up to 100 MiB.');const bytes=await file.readFile();return store.importWav(bytes,basename(selected.filePaths[0]),key,location ?? await storage?.prepare(window,basename(selected.filePaths[0])));}finally{await file.close();}
    }finally{dialogs.delete(window.id);}
  });
  ipcMain.handle('banger:music-rendered',async(event,bytes:unknown,name:unknown,key:string,token?:string,beat?:MusicVersion["beat"])=>{
    const window=senderWindow(event);
    if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX_WAV_BYTES||typeof name!=='string')throw new Error('Invalid rendered WAV.');
    const location = storage ? token ? storage.resolve(window,token) : await storage.prepare(window,name) : undefined;
    return store.importWav(bytes,name.slice(0,120),key,location,beat);
  });
  ipcMain.handle('banger:music-add-library', async (event, id: string, version: number) => {
    const window = senderWindow(event);
    if (!storage) throw new Error('Song storage is unavailable.');
    const history = await store.versions(id, version + 1);
    const selected = history.versions.find(item => item.version === version);
    if (!selected) throw new Error('Select a saved song version.');
    const location = await store.location(id) ?? await storage.prepare(window, selected.name);
    await store.bind(id, location);
    const audio = await store.audio(id, version);
    const recordingHistory = selected.audioVersion === selected.version ? history : await store.versions(id, selected.audioVersion + 1);
    const recording = recordingHistory.versions.find(item => item.version === selected.audioVersion) ?? recordingHistory.original;
    return storage.storage.addToLibrary(location, await toWav(audio.bytes), selected.beat?.source, selected, librarySongType(recording));
  });
  ipcMain.handle('banger:music-save',async(event,id:string,version?:number)=>{
    const window=senderWindow(event);if(dialogs.has(window.id))throw new Error('A music file dialog is already open.');dialogs.add(window.id);
    try{const audio=await store.audio(id,version);const extension=audio.contentType==='audio/wav'?'wav':'mp3';
      const target=await dialog.showSaveDialog(window,{title:'Save completed song',defaultPath:`song.${extension}`,filters:[{name:'Audio',extensions:[extension]}]});
      if(target.canceled||!target.filePath)return false;await writeFile(target.filePath,audio.bytes);return true;
    }finally{dialogs.delete(window.id);}
  });
}
