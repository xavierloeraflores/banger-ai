import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { open, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { MAX_WAV_BYTES } from '@banger/elevenlabs';
import { createMusicStore } from './elevenlabs-music.js';
export function installMusicHandlers(senderWindow:(event:IpcMainInvokeEvent)=>BrowserWindow, suppliedStore?:ReturnType<typeof createMusicStore>) {
  if(!app.isPackaged&&!process.env.ELEVENLABS_API_KEY){try{process.loadEnvFile(join(app.getAppPath(),'.env.local'));}catch{/* Credentials may instead be supplied by the launch environment. */}}
  const store=suppliedStore??createMusicStore(join(app.getPath('userData'),'elevenlabs-music'));
  const dialogs=new Set<number>();
  ipcMain.handle('banger:music-list',event=>{senderWindow(event);return store.list();});
  ipcMain.handle('banger:music-operations',event=>{senderWindow(event);return store.operations();});
  ipcMain.handle('banger:music-get',(event,id:string)=>{senderWindow(event);return store.get(id);});
  ipcMain.handle('banger:music-operation',(event,id:string)=>{senderWindow(event);return store.recover(id);});
  ipcMain.handle('banger:music-act',(event,id:string,input:unknown,key:string)=>{senderWindow(event);return store.act(id,input,key);});
  ipcMain.handle('banger:music-audio',(event,id:string,version?:number)=>{senderWindow(event);return store.audio(id,version);});
  ipcMain.handle('banger:music-import',async(event,key:string)=>{
    const window=senderWindow(event);if(dialogs.has(window.id))throw new Error('A music file dialog is already open.');dialogs.add(window.id);
    try{
      const selected=await dialog.showOpenDialog(window,{title:'Upload WAV to ElevenLabs',filters:[{name:'WAV audio',extensions:['wav']}],properties:['openFile']});
      if(selected.canceled||!selected.filePaths[0])return null;
      const file=await open(selected.filePaths[0],'r');
      try{const stat=await file.stat();if(!stat.isFile()||stat.size>MAX_WAV_BYTES)throw new Error('Choose a WAV up to 100 MiB.');const bytes=await file.readFile();return store.importWav(bytes,basename(selected.filePaths[0]),key);}finally{await file.close();}
    }finally{dialogs.delete(window.id);}
  });
  ipcMain.handle('banger:music-rendered',async(event,bytes:unknown,name:unknown,key:string)=>{
    senderWindow(event);
    if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX_WAV_BYTES||typeof name!=='string')throw new Error('Invalid rendered WAV.');
    return store.importWav(bytes,name.slice(0,120),key);
  });
  ipcMain.handle('banger:music-save',async(event,id:string,version?:number)=>{
    const window=senderWindow(event);if(dialogs.has(window.id))throw new Error('A music file dialog is already open.');dialogs.add(window.id);
    try{const audio=await store.audio(id,version);const extension=audio.contentType==='audio/wav'?'wav':'mp3';
      const target=await dialog.showSaveDialog(window,{title:'Save completed song',defaultPath:`song.${extension}`,filters:[{name:'Audio',extensions:[extension]}]});
      if(target.canceled||!target.filePath)return false;await writeFile(target.filePath,audio.bytes);return true;
    }finally{dialogs.delete(window.id);}
  });
}
