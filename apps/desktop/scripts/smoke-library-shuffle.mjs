import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { app } from 'electron';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { enterStudio } from './smoke-startup.mjs';

const profile = await mkdtemp(join(tmpdir(), 'banger-library-shuffle-'));
app.setPath('userData', profile);
app.once('will-quit', () => { void rm(profile, { recursive: true, force: true }); });
function wav() {
  const rate = 8000, samples = rate * 20, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 440) * 500), 44 + i * 2);
  return bytes;
}
const source = tempo => `tempo ${tempo}; track keys { instrument "synth/keys"; notes "C4 D4 E4 F4"; }`;
const lyrics = name => ({ plan: { chunks: [{ text: `[Verse]\n${name}`, durationMs: 20000 }] }, audioMetadata: { wordsTimestamps: [{ word: name, startMs: 500, endMs: 19000 }], waveformVisual: [100, 200, 100] } });
const folder = join(profile, 'library', 'Shuffle fixture');
await mkdir(folder, { recursive: true });
for (const name of ['Native single', 'Record one', 'Record two']) {
  await writeFile(join(folder, `${name}.wav`), wav());
  await writeFile(join(folder, `${name}.banger`), source(name === 'Record two' ? 100 : 120));
  await writeFile(join(folder, `${name}.lyric.json`), JSON.stringify(lyrics(name)));
  if (name.startsWith('Record')) await writeFile(join(folder, `${name}.library.json`), JSON.stringify({ record: { id: 'shuffle-record', name: 'Shuffle record' } }));
}
const timeout = setTimeout(() => { console.error('Library shuffle smoke timed out'); app.exit(1); }, 120000);
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  const evaluate = code => window.webContents.executeJavaScript(code, true).catch(error => { throw new Error(`Failed: ${code}`, { cause: error }); });
  const wait = async (code, label) => {
    for (let attempt = 0; attempt < 500; attempt++) { if (await evaluate(`Boolean(${code})`)) return; await delay(25); }
    throw new Error(`Timed out: ${label}`);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const audio = "document.querySelector('.library-player audio')";
  const title = "document.querySelector('.library-now-playing strong').textContent";
  const hero = "document.querySelector('.muse-game')";
  const ready = () => wait(`${audio} && !${audio}.paused && ${audio}.currentTime > .05 && !document.querySelector('[aria-label="Pause library song"]').disabled`, 'playback ready');
  const seed = async (name, beat = true) => evaluate(`new Promise((resolve, reject) => { const request = indexedDB.open('banger-library', 2); request.onsuccess = () => { const db = request.result; const tx = db.transaction('songs', 'readwrite'); tx.objectStore('songs').put({ id: ${JSON.stringify(name)}, name: ${JSON.stringify(name)}, wav: Uint8Array.from(atob(${JSON.stringify(wav().toString('base64'))}), c => c.charCodeAt(0)).buffer, files: { 'lyrics.json': ${JSON.stringify(JSON.stringify(lyrics(name)))} }, beat: ${JSON.stringify(beat ? { name, source: source(90) } : null)} }); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; })`);
  const clearBrowser = () => evaluate(`new Promise(resolve => { const r = indexedDB.open('banger-library', 2); r.onsuccess = () => { const db = r.result, tx = db.transaction('songs', 'readwrite'); tx.objectStore('songs').clear(); tx.oncomplete = () => { db.close(); resolve(); }; }; })`);
  const finish = async () => { await ready(); await evaluate(`${audio}.currentTime = ${audio}.duration - .12`); };
  try {
    await enterStudio(window);
    window.setContentSize(1440, 1000); window.setAlwaysOnTop(true); window.show(); window.focus(); window.webContents.focus();
    await click('.app-sidebar-nav button[aria-label="Library"]');
    await wait("document.querySelectorAll('.library-single').length === 3", 'native singles and record');
    await seed('Browser song');
    await wait("document.querySelectorAll('.library-single').length === 4", 'combined library');
    assert.equal(await evaluate("[...document.querySelectorAll('.producer-file-actions button')].some(button => /^(Save|Export)$/.test(button.textContent.trim()))"), false);
    await click('[aria-label="Shuffle library"]'); await ready();
    const visited = new Set([await evaluate(title)]);
    await click('[aria-controls="library-sing-along"]');
    await click('.performance-stage-trigger');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.playing === 'true'", 'band playing');
    await click('.performance-hero-trigger');
    await wait(`${hero}?.dataset.phase === 'playing'`, 'hero playing');
    await evaluate(`(() => { window.sharedAudio = ${audio}; window.sharedDialog = document.querySelector('#performance-stage'); })()`);
    for (let index = 0; index < 4; index++) {
      const before = await evaluate(title);
      await finish();
      await wait(`${title} !== ${JSON.stringify(before)}`, 'next song after completion'); await ready();
      const next = await evaluate(title);
      if (index < 3) { assert.ok(!visited.has(next), 'no repeat before every song has played'); visited.add(next); }
      await wait(`${hero}?.dataset.phase === 'playing' && Number(${hero}.dataset.time) < 3`, 'fresh hero run');
      assert.equal(await evaluate('window.sharedDialog === document.querySelector("#performance-stage")'), true, 'band stays mounted');
      assert.equal(await evaluate(`window.sharedAudio === ${audio}`), true, 'same audio element');
      await wait(`document.querySelector('.sing-along-lines')?.textContent.includes(${JSON.stringify(next)})`, 'lyrics update');
      assert.ok(await evaluate(`Math.abs(Number(${hero}.dataset.time) - ${audio}.currentTime) < .3`), 'hero follows next media clock');
    }
    assert.equal(visited.size, 4, 'singles, record tracks and browser song all visited');
    await click('[aria-label="Hide Muse Hero"]'); await click('[aria-label="Close band stage"]');
    await click('[aria-label="Shuffle library"]');
    const stopped = await evaluate(title); await finish();
    await wait(`${audio}.ended`, 'shuffle off stops at end'); await delay(150);
    assert.equal(await evaluate(title), stopped);
    await click('[aria-label="Shuffle library"]'); await ready();
    const deleted = await evaluate(title);
    if (deleted === 'Browser song') await clearBrowser();
    else for (const suffix of ['wav', 'banger', 'lyric.json', 'library.json']) await rm(join(folder, `${deleted}.${suffix}`), { force: true });
    await wait(`${title} !== ${JSON.stringify(deleted)}`, 'deleting playing song advances'); await ready();
    await rm(folder, { recursive: true, force: true }); await clearBrowser();
    await wait(`${title} === 'Pick a song' && ${audio}.paused`, 'empty library stops');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Shuffle library\"]').disabled"), true);
    await seed('Only song', false);
    await wait("!document.querySelector('[aria-label=\"Shuffle library\"]').disabled", 'song added to empty library');
    await click('[aria-label="Shuffle library"]'); await ready(); await finish();
    await wait(`${audio}.currentTime < 2 && !${audio}.paused`, 'single song repeats');
    await click('[aria-label="Shuffle library"]');
    await click('.library-sing-controls button');
    window.setMinimumSize(0, 0); window.setContentSize(430, 900); await delay(150);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'narrow library fits');
    await writeFile('/tmp/banger-library-shuffle.png', (await window.webContents.capturePage()).toPNG());
    await click('.app-sidebar-nav button[aria-label="Beat Studio"]');
    assert.equal(await evaluate(`${audio}`), null, 'navigation disposes library playback');
    assert.equal(await evaluate('window.sharedAudio.paused'), true);
    console.log('Library shuffle smoke passed: header, full native/browser/record cycle, natural completion, Band/Hero/lyrics transitions, toggle off, deletion, empty library, single-song repeat, narrow layout and cleanup.');
    clearTimeout(timeout); app.exit(0);
  } catch (error) {
    await writeFile('/tmp/banger-library-shuffle-failure.png', (await window.webContents.capturePage()).toPNG());
    console.error(error); clearTimeout(timeout); app.exit(1);
  }
}));
await import('../dist/main.js');
