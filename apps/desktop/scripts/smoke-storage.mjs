import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { installSongStorage } from '../dist/song-storage-ipc.js';
import { installMusicHandlers, musicStorageHooks } from '../dist/elevenlabs-ipc.js';
import { createMusicStore } from '../dist/elevenlabs-music.js';
import { toWav } from '../dist/audio-conversion.js';
import { validateWav } from '@banger/elevenlabs';
import { fixtureProvider, wav } from '../../../packages/elevenlabs/test/fixtures.mjs';
app.on('window-all-closed', () => {});
const root = await realpath(await mkdtemp(join(tmpdir(), 'banger-storage-smoke-')));
app.setPath('userData', root);
const timeout = setTimeout(() => app.exit(1), 60000);
void app.whenReady().then(async () => {
const window = new BrowserWindow({ show:false, webPreferences:{ preload:resolve('dist/preload.cjs'), sandbox:true, contextIsolation:true, nodeIntegration:false } });
const sender = event => { assert.equal(event.senderFrame, window.webContents.mainFrame); return window; };
try {
  const storage = installSongStorage(sender);
  const project = join(root, 'project'); await mkdir(project); storage.setRoot(window, project);
  const provider = fixtureProvider(), generate = provider.generate;
  const mp3 = await readFile(new URL('../../../packages/elevenlabs/test/fixture.mp3', import.meta.url));
  provider.generate = async (...args) => ({ ...await generate(...args), audio: mp3 });
  const store = createMusicStore(join(root, 'music'), () => provider, musicStorageHooks(storage.storage));
  installMusicHandlers(sender, store, storage);
  await window.loadURL('about:blank');
  const evaluate = code => window.webContents.executeJavaScript(code);
  const token = await evaluate(`window.bangerStorage.prepare('midnight.banger','tempo 120;')`);
  const bytes = [...wav()];
  await evaluate(`window.bangerStorage.audio(${JSON.stringify(token)},new Uint8Array(${JSON.stringify(bytes)}))`);
  const other = join(root, 'other'); await mkdir(other); storage.setRoot(window, other);
  const key = randomUUID();
  await evaluate(`window.bangerMusic.rendered(new Uint8Array(${JSON.stringify(bytes)}),'midnight.wav',${JSON.stringify(key)},${JSON.stringify(token)})`);
  const done = async id => { for(let i=0;i<300;i++) { const op = await store.operation(id); if(!['queued','running'].includes(op.status)) { assert.equal(op.status,'completed',op.error); return; } await new Promise(resolve=>setTimeout(resolve,20)); } throw new Error('Operation timeout'); };
  await done(key);
  const generation = await evaluate(`window.bangerMusic.act(${JSON.stringify(key)},{operation:'generate',baseVersion:1,indices:[0,1]},${JSON.stringify(randomUUID())})`);
  await done(generation.id);
  const history = await evaluate(`window.bangerStorage.history(${JSON.stringify(token)})`);
  assert.equal(history.instrumentals.length, 2); assert.equal(history.vocals.length, 1); assert.equal(history.lyrics.length, 2);
  const archived = await readFile(join(project, '.banger/history/midnight/vocals', history.vocals[0]));
  assert.ok(validateWav(archived).durationMs >= 3000);
  assert.notDeepEqual(archived, mp3);
  for(const scope of ['global','project']) await evaluate(`window.bangerStorage.copyToLibrary(${JSON.stringify(token)},${JSON.stringify(scope)},${JSON.stringify({ audio:`vocals/${history.vocals[0]}`, instrumental:history.instrumentals[0] })})`);
  assert.deepEqual(await readFile(join(root, 'library', (await readdir(join(root,'library'))).find(name=>name.endsWith('-midnight')), 'midnight.wav')), archived);
  await evaluate(`window.bangerStorage.addToLibrary('midnight.banger','tempo 120;',new Uint8Array(${JSON.stringify(bytes)}),${JSON.stringify(token)})`);
  const saved = await evaluate('window.bangerLibrary.list()');
  const identity = JSON.parse(await readFile(join(project, '.banger/record.json'), 'utf8'));
  assert.ok(saved.every(song => song.recordId === identity.id), 'exports retain the original project after switching');
  await assert.rejects(evaluate(`window.bangerStorage.audio('invalid-token',new Uint8Array(${JSON.stringify(bytes)}))`));
  await assert.rejects(toWav(new Uint8Array([1,2,3])));
  console.log('Storage smoke passed: real IPC, project switch, provider MP3 decoding, immutable WAVs, lyric sidecars, both libraries, invalid token and corrupt audio rejection.');
} catch(error) { console.error(error); process.exitCode=1; }
finally { clearTimeout(timeout); window.destroy(); await rm(root,{recursive:true,force:true}); app.exit(process.exitCode??0); }

});
