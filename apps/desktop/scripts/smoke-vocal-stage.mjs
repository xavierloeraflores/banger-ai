import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { app } from 'electron';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { enterStudio } from './smoke-startup.mjs';

const profile = await mkdtemp(join(tmpdir(), 'banger-sing-along-'));
app.setPath('userData', profile);
app.once('will-quit', () => { void rm(profile, { recursive: true, force: true }); });
// A short audible fixture exercises the media clock without a provider request.
function wav() {
  const rate = 8000, samples = rate * 8, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 440) * 1000), 44 + i * 2);
  return bytes;
}
const fixture = {
  plan: { chunks: [{ text: '[Verse]\nMorning light\nCarry me home', durationMs: 8000, positiveStyles: [] }] },
  audioMetadata: {
    wordsTimestamps: [{ word: 'Morning', startMs: 500, endMs: 1300 }, { word: 'light', startMs: 1400, endMs: 2200 }, { word: 'Carry', startMs: 4000, endMs: 4600 }, { word: 'me', startMs: 4700, endMs: 5000 }, { word: 'home', startMs: 5100, endMs: 6500 }],
    waveformVisual: Array.from({ length: 32 }, (_, i) => Math.round(Math.sin(i) * 600)),
  },
};
const actual = undefined;
const audio = actual ? await readFile(actual) : wav();
const lyrics = actual ? JSON.parse(await readFile(actual.replace(/\.wav$/i, '.lyrics.json'), 'utf8')) : fixture;
const folder = join(profile, 'library', 'Sing-along fixture');
await mkdir(folder, { recursive: true });
const name = actual ? 'First Light' : 'Morning light';
await writeFile(join(folder, `${name}.wav`), audio);
await writeFile(join(folder, `${name}.lyrics.json`), JSON.stringify(lyrics));
await writeFile(join(folder, 'Audio only.wav'), wav());
const beat = 'tempo 120; track keys { instrument "synth/keys"; piano { note "C4" start 0 duration 2 velocity .7; } gain .5; }';
await writeFile(join(folder, `${name}.banger`), beat);
await writeFile(join(folder, 'Audio only.banger'), beat);
const timeout = setTimeout(() => { console.error('Sing-along smoke timed out'); app.exit(1); }, 120000);
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const wait = async (code, label) => {
    for (let attempt = 0; attempt < 300; attempt++) { if (await evaluate(`Boolean(${code})`)) return; await delay(30); }
    throw new Error(`Timed out: ${label}`);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const chooseView = value => evaluate(`(() => { const field = document.querySelector('[aria-label="View"]'); field.value = ${JSON.stringify(value)}; field.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const seek = seconds => evaluate(`(() => { const audio = document.querySelector('.library-player audio'); audio.currentTime = ${seconds}; audio.dispatchEvent(new Event('timeupdate')); })()`);
  try {
    await enterStudio(window);
    window.setContentSize(1380, 1020); window.show(); window.focus();
    await chooseView('library');
    await wait("document.querySelectorAll('.library-card').length === 2", 'library ready');
    await click(`[aria-label="Play ${name}"]`);
    await wait("document.querySelector('.library-player audio').duration > 0", 'recording ready');
    await evaluate("document.querySelector('.library-player audio').pause()");
    await click('.performance-stage-trigger');
    const canvas = "document.querySelector('.performance-viewport canvas')";
    await wait(`${canvas}?.dataset.singer === 'true'`, 'singer appears');
    assert.equal(await evaluate(`${canvas}.dataset.characterCount`), '2');
    await wait("!document.querySelector('.library-player audio').paused", 'recorded audio autoplays on stage ready');
    await evaluate("document.querySelector('.library-player audio').pause()");
    await seek(1);
    await wait(`${canvas}.dataset.mouth === '0.000'`, 'paused mouth');
    await evaluate("document.querySelector('.library-player audio').play()");
    await wait(`${canvas}.dataset.singing === 'true' && Number(${canvas}.dataset.mouth) > .1`, 'singing mouth');
    await writeFile('/tmp/banger-singer-stage.png', (await window.webContents.capturePage()).toPNG());
    await seek(2.6);
    await wait(`${canvas}.dataset.singing === 'false'`, 'instrumental gap');
    await seek(4.2);
    await wait(`${canvas}.dataset.singing === 'true'`, 'forward seek');
    await seek(.8);
    await wait(`${canvas}.dataset.singing === 'true' && Number(${canvas}.dataset.beat) < 3`, 'backward seek and score clock');
    if (!await evaluate("!!document.querySelector('.performance-options')")) await click('.performance-controls-trigger');
    await click('.performance-options input');
    await wait(`${canvas}?.dataset.singer === 'true' && ${canvas}.dataset.mouth === '0.000'`, 'still singer');
    if (!await evaluate("!!document.querySelector('.performance-options')")) await click('.performance-controls-trigger');
    await click('.performance-options input');
    await wait(`${canvas}?.dataset.singer === 'true'`, 'animated singer returns');
    await evaluate("document.querySelector('.library-player audio').pause()");
    await seek(7.8);
    await evaluate("document.querySelector('.library-player audio').play()");
    await wait("document.querySelector('.library-player audio').ended", 'recording end');
    await wait(`${canvas}.dataset.singing === 'false' && ${canvas}.dataset.playing === 'false'`, 'ended pose');
    await click('[aria-label="Close band stage"]');
    await wait("!document.querySelector('.performance-viewport canvas')", 'singer disposal');
    await click('[aria-label="Play Audio only"]');
    await click('.performance-stage-trigger');
    await wait(`${canvas}?.dataset.singer === 'false'`, 'no stale singer on instrumental');
    assert.equal(await evaluate(`${canvas}.dataset.characterCount`), '1');
    await click('[aria-label="Close band stage"]');
    // Read the exact same timing document from a browser library bundle as well.
    await evaluate(`new Promise((resolve, reject) => { const request = indexedDB.open('banger-library', 1); request.onupgradeneeded = () => request.result.createObjectStore('songs', { keyPath: 'id' }); request.onsuccess = () => { const db = request.result; const tx = db.transaction('songs', 'readwrite'); tx.objectStore('songs').put({ id: 'browser-vocals', name: 'Browser vocals', wav: Uint8Array.from(atob(${JSON.stringify(wav().toString('base64'))}), c => c.charCodeAt(0)).buffer, beat: { name: 'beat.banger', source: ${JSON.stringify(beat)} }, files: { 'lyrics.json': ${JSON.stringify(JSON.stringify(fixture))} } }); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; })`);
    await chooseView('beat'); await chooseView('library');
    await wait("document.querySelector('[aria-label=\"Play Browser vocals\"]')", 'browser library ready');
    await click('[aria-label="Play Browser vocals"]');
    await wait("document.querySelector('.library-player audio').duration > 0", 'browser audio ready');
    await click('.performance-stage-trigger');
    await wait(`${canvas}?.dataset.singer === 'true'`, 'browser singer');
    await seek(4.2);
    await wait(`${canvas}.dataset.singing === 'true'`, 'browser timing data');
    console.log('Vocal stage smoke passed: native/browser library timings, singer count, mouth, silence, seek, pause, end, still mode, disposal and instrumental fallback.');
    clearTimeout(timeout); app.exit(0);
  } catch (error) {
    await writeFile('/tmp/banger-singer-failure.png', (await window.webContents.capturePage()).toPNG());
    console.error(error); clearTimeout(timeout); app.exit(1);
  }
}));
await import('../dist/main.js');
