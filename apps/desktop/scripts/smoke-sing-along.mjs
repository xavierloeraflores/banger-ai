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
const actual = process.env.BANGER_SING_ALONG_FIXTURE;
const audio = actual ? await readFile(actual) : wav();
const lyrics = actual ? JSON.parse(await readFile(actual.replace(/\.wav$/i, '.lyric.json'), 'utf8')) : fixture;
const folder = join(profile, 'library', 'Sing-along fixture');
await mkdir(folder, { recursive: true });
const name = actual ? 'First Light' : 'Morning light';
await writeFile(join(folder, `${name}.wav`), audio);
await writeFile(join(folder, `${name}.lyric.json`), JSON.stringify(lyrics));
await writeFile(join(folder, 'Audio only.wav'), wav());
const timeout = setTimeout(() => { console.error('Sing-along smoke timed out'); app.exit(1); }, 120000);
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  const evaluate = code => window.webContents.executeJavaScript(code, true).catch(error => { throw new Error(`Failed: ${code}`, { cause: error }); });
  const wait = async (code, label) => {
    for (let attempt = 0; attempt < 300; attempt++) { if (await evaluate(`Boolean(${code})`)) return; await delay(30); }
    throw new Error(`Timed out: ${label}`);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const chooseView = value => evaluate(`document.querySelector('.app-sidebar-nav button[aria-label="${value === 'library' ? 'Library' : 'Beat Studio'}"]').click()`);
  const seek = seconds => evaluate(`(() => { const audio = document.querySelector('.library-player audio'); audio.currentTime = ${seconds}; audio.dispatchEvent(new Event('timeupdate')); })()`);
  try {
    await enterStudio(window);
    window.setContentSize(1380, 1020); window.show(); window.focus();
    // Seed the browser library through its real IndexedDB storage.
    await evaluate(`new Promise((resolve, reject) => { const request = indexedDB.open('banger-library', 2); request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('songs')) request.result.createObjectStore('songs', { keyPath: 'id' }); if (!request.result.objectStoreNames.contains('records')) request.result.createObjectStore('records', { keyPath: 'id' }); }; request.onsuccess = () => { const db = request.result; const tx = db.transaction('songs', 'readwrite'); tx.objectStore('songs').put({ id: 'browser-fixture', name: 'Browser recording', wav: Uint8Array.from(atob(${JSON.stringify(wav().toString('base64'))}), c => c.charCodeAt(0)).buffer, files: { 'lyrics.json': ${JSON.stringify(JSON.stringify(fixture))} } }); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; })`);
    await chooseView('library');
    await wait("document.querySelectorAll('.library-card').length === 3", 'native and browser songs');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Play Audio only\"] .library-song-tag').textContent"), 'Instrumental');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Play Browser recording\"] .library-song-tag').textContent"), 'Vocal');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Play ${name}"] .library-song-tag').textContent`), 'Vocal');
    await writeFile('/tmp/banger-library-tags.png', (await window.webContents.capturePage()).toPNG());
    assert.equal(await evaluate("document.querySelector('.performance-stage-trigger').nextElementSibling.textContent.trim()"), 'Lyrics', 'action sits beside Band stage');
    assert.equal(await evaluate("document.querySelector('[aria-controls=\"library-sing-along\"]').disabled"), true);
    await click(`[aria-label="Play ${name}"]`);
    await wait("!document.querySelector('[aria-controls=\"library-sing-along\"]').disabled", 'lyrics available');
    await click('[aria-controls="library-sing-along"]');
    await wait("document.querySelector('.sing-along-lines button') && document.querySelector('.library-player audio').duration > 0", 'timed lyrics');
    await wait("document.querySelector('[aria-label=" + JSON.stringify('Pause library song') + "]')", 'audio playing');
    await wait("!document.querySelector('[aria-label=\"Pause library song\"]').disabled", 'player ready');
    await click('[aria-label="Pause library song"]');
    await wait("document.querySelector('.library-player audio').paused", 'paused');
    const first = lyrics.audioMetadata.wordsTimestamps[0];
    await seek((first.startMs + first.endMs) / 2000);
    await wait("document.querySelector('[data-state=singing]')", 'current word highlight');
    assert.equal((await evaluate("document.querySelector('[data-state=singing]').textContent")).trim(), first.word);
    assert.equal(await evaluate("document.querySelectorAll('.sing-along-seek svg rect').length"), lyrics.audioMetadata.waveformVisual.length);
    await wait("!document.querySelector('.library-player audio').seeking", 'seek settled');
    const pausedAt = await evaluate("document.querySelector('.library-player audio').currentTime");
    await delay(250);
    assert.equal(await evaluate("document.querySelector('.library-player audio').currentTime"), pausedAt);
    await click('.sing-along-lines button:last-child');
    const lastStart = await evaluate("document.querySelector('.library-player audio').currentTime");
    assert.ok(lastStart > 1, 'clicking a phrase seeks forward');
    await click('.sing-along-lines button:first-child');
    assert.ok(Math.abs(await evaluate("document.querySelector('.library-player audio').currentTime") - first.startMs / 1000) < .1);
    await seek(0);
    await wait("!document.querySelector('.sing-along-lines [aria-current=true]')", 'intro has no active phrase');
    await evaluate("document.querySelector('[aria-label=\"Seek lyrics waveform\"]').scrollIntoView({ block: 'center' })");
    const rect = await evaluate("(() => { const r = document.querySelector('[aria-label=\"Seek lyrics waveform\"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width * .6), y: Math.round(r.y + r.height / 2) }; })()");
    window.webContents.sendInputEvent({ type: 'mouseDown', ...rect, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...rect, button: 'left', clickCount: 1 });
    await wait("document.querySelector('.library-player audio').currentTime > document.querySelector('.library-player audio').duration * .5", 'waveform seek');
    await click('[aria-label="Play library song"]');
    const before = await evaluate("document.querySelector('.library-player audio').currentTime");
    await delay(250);
    assert.ok(await evaluate("document.querySelector('.library-player audio').currentTime") > before, 'playback resumes from seek');
    await click('[aria-label="Pause library song"]');
    await seek((first.startMs + first.endMs) / 2000);
    await delay(100);
    await writeFile('/tmp/banger-sing-along.png', (await window.webContents.capturePage()).toPNG());
    window.setMinimumSize(0, 0); window.setContentSize(390, 844);
    await delay(150);
    assert.equal(await evaluate("document.querySelector('.sing-along').scrollWidth <= document.querySelector('.sing-along').clientWidth"), true, 'mobile panel fits');
    await writeFile('/tmp/banger-sing-along-mobile.png', (await window.webContents.capturePage()).toPNG());
    window.setContentSize(1380, 1020);
    await click('.library-sing-controls button');
    await wait("document.querySelector('.library-grid')", 'back to collection');
    await click('[aria-label="Play Browser recording"]');
    await click('[aria-controls="library-sing-along"]');
    await wait("document.querySelector('.sing-along-lines')?.textContent.includes('Carry me home')", 'browser bundle metadata');
    assert.equal(await evaluate("document.querySelector('.sing-along-title .library-song-tag')"), null, 'vocal title has no tag');
    await evaluate(`(() => { const field = document.querySelector('[aria-label="Lyrics song"]'); field.value = [...field.options].find(option => option.text === 'Audio only').value; field.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await wait("document.querySelector('.sing-along-title .library-song-tag')?.textContent === 'Instrumental'", 'instrumental title tag');
    await click('.library-sing-controls button');

    await wait("document.querySelector('[aria-controls=\"library-sing-along\"]').disabled", 'audio-only lyrics disabled');
    await click('[aria-controls="library-sing-along"]');
    assert.equal(await evaluate("document.querySelector('.sing-along')"), null);
    await chooseView('beat');
    assert.equal(await evaluate("document.querySelector('.library-player audio')"), null, 'leaving library disposes player');
    console.log('Sing-along smoke passed: native and browser metadata, button placement, word sync, silence, phrase seek, waveform seek, pause/resume, collection return, mobile layout, missing metadata, song changes and cleanup.');
    clearTimeout(timeout); app.exit(0);
  } catch (error) {
    await writeFile('/tmp/banger-sing-along-failure.png', (await window.webContents.capturePage()).toPNG());
    console.error(error); clearTimeout(timeout); app.exit(1);
  }
}));
await import('../dist/main.js');
