import { BrowserWindow } from 'electron';
import { MAX_WAV_BYTES, validateWav } from '@banger/elevenlabs';

/** Chromium decodes provider audio, so packaged apps need no external ffmpeg installation. */
export async function toWav(bytes: Uint8Array): Promise<Uint8Array> {
  try { validateWav(bytes, false); return bytes; } catch { /* Decode compressed audio below. */ }
  if (!bytes.length || bytes.length > MAX_WAV_BYTES) throw new Error('Invalid audio size.');
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const timeout = setTimeout(() => window.destroy(), 60000);
  try {
    await window.loadURL('about:blank');
    const base64 = Buffer.from(bytes).toString('base64');
    const output: string = await window.webContents.executeJavaScript(`(async () => {
      const context = new AudioContext({sampleRate: 44100});
      try {
        const input = Uint8Array.from(atob(${JSON.stringify(base64)}), c => c.charCodeAt(0));
        const audio = await context.decodeAudioData(input.buffer);
        const channels = audio.numberOfChannels, size = audio.length * channels * 2;
        if (size + 44 > ${MAX_WAV_BYTES}) throw new Error('Decoded audio exceeds 100 MiB.');
        const buffer = new ArrayBuffer(44 + size), view = new DataView(buffer);
        const text = (at, value) => { for(let i=0;i<value.length;i++) view.setUint8(at+i,value.charCodeAt(i)); };
        text(0,'RIFF'); view.setUint32(4,36+size,true); text(8,'WAVE'); text(12,'fmt ');
        view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,channels,true);
        view.setUint32(24,audio.sampleRate,true); view.setUint32(28,audio.sampleRate*channels*2,true);
        view.setUint16(32,channels*2,true); view.setUint16(34,16,true); text(36,'data'); view.setUint32(40,size,true);
        for(let channel=0;channel<channels;channel++) {
          const samples=audio.getChannelData(channel);
          for(let i=0;i<samples.length;i++) { const sample=Math.max(-1,Math.min(1,samples[i])); view.setInt16(44+(i*channels+channel)*2,Math.round(sample*(sample<0?32768:32767)),true); }
        }
        const data=new Uint8Array(buffer); let result='';
        for(let i=0;i<data.length;i+=32768) result+=String.fromCharCode(...data.subarray(i,i+32768));
        return btoa(result);
      } finally { await context.close(); }
    })()`);
    const result = new Uint8Array(Buffer.from(output, 'base64')); validateWav(result, false); return result;
  } finally { clearTimeout(timeout); if (!window.isDestroyed()) window.destroy(); }
}
