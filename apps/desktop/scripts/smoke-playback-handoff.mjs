import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { app } from 'electron';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { enterStudio } from './smoke-startup.mjs';

const profile = await mkdtemp(join(tmpdir(), 'banger-playback-handoff-'));
app.setPath('userData', profile);
app.once('will-quit', () => { void rm(profile, { recursive: true, force: true }); });
// A short audible fixture exercises the media clock without a provider request.
function wav() {
  const rate = 8000, samples = rate * 40, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 440) * 1000), 44 + i * 2);
  return bytes;
}
const folder = join(profile, 'library', 'Playback fixture');
await mkdir(folder, { recursive: true });
await writeFile(join(folder, 'Continuous song.wav'), wav());
await writeFile(join(folder, 'Continuous song.banger'), 'tempo 120; track keys { instrument "synth/keys"; notes "C4 D4 E4 F4"; }');
const timeout = setTimeout(() => { console.error('Playback handoff smoke timed out'); app.exit(1); }, 120000);
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const wait = async (code, label) => {
    for (let attempt = 0; attempt < 500; attempt++) { if (await evaluate(`Boolean(${code})`)) return; await delay(20); }
    throw new Error(`Timed out: ${label}`);
  };
  const click = async selector => {
    await wait(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); return button && !button.disabled; })()`, `control ready: ${selector}`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const audio = "document.querySelector('.library-player audio')";
  const canvas = "document.querySelector('.performance-viewport canvas')";
  const hero = "document.querySelector('.muse-game')";
  const uninterrupted = async label => {
    assert.equal(await evaluate(`${audio}.paused`), false, label);
    assert.deepEqual(await evaluate('window.transportEvents'), [], `${label}: no pause, seek, or reload`);
  };
  try {
    await enterStudio(window);
    window.setContentSize(1440, 1000); window.setAlwaysOnTop(true); window.show(); window.focus(); window.webContents.focus();
    await evaluate(`(() => { const field = document.querySelector('[aria-label="View"]'); field.value = 'library'; field.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await click('[aria-label="Play Continuous song"]');
    await wait(`${audio}.duration === 40 && !${audio}.paused`, 'library playback');
    await evaluate(`${audio}.currentTime = 30`);
    await wait(`!${audio}.seeking && ${audio}.currentTime >= 30`, 'seek to thirty seconds');
    await evaluate(`(() => { window.transportEvents = []; window.sharedAudio = ${audio}; for (const type of ['pause', 'seeking', 'emptied']) window.sharedAudio.addEventListener(type, () => window.transportEvents.push(type)); })()`);
    await click('.performance-stage-trigger');
    await wait(`${canvas}?.dataset.playing === 'true' && Number(${canvas}.dataset.beat) >= 60`, 'band joins at thirty seconds');
    await uninterrupted('library to band');
    await click('.performance-hero-trigger');
    await wait(`${hero}?.dataset.phase === 'playing' && Number(${hero}.dataset.time) >= 30`, 'hero joins automatically');
    assert.ok(await evaluate(`Math.abs(Number(${hero}.dataset.time) - ${audio}.currentTime) < .2`), 'hero follows the media clock');
    assert.ok(Number(await evaluate("document.querySelector('.muse-stats .miss b').textContent")) < 4, 'joining does not penalize thirty seconds of past notes');
    await uninterrupted('band to hero');
    await writeFile('/tmp/banger-playback-handoff.png', (await window.webContents.capturePage()).toPNG());
    await click('[aria-label="Hide Muse Hero"]');
    await wait(`!${hero}`, 'back to band');
    await uninterrupted('hero to band');
    await click('.performance-hero-trigger');
    await wait(`${hero}?.dataset.phase === 'playing'`, 'rejoin hero');
    await click('.muse-footer button');
    await wait(`${hero}.dataset.phase === 'finished'`, 'end run');
    await uninterrupted('ending a run leaves audio playing');
    await click('[aria-label="Close band stage"]');
    await wait("!(document.querySelector('#performance-stage')?.getAttribute('data-state') === 'open')", 'return to library');
    await uninterrupted('band to library');
    assert.ok(await evaluate(`window.sharedAudio === ${audio}`), 'same audio element throughout');
    await click('[aria-label="Pause library song"]');
    await wait(`${audio}.paused`, 'library pause');
    const pausedAt = await evaluate(`${audio}.currentTime`);
    await delay(150);
    assert.equal(await evaluate(`${audio}.currentTime`), pausedAt);
    assert.ok(pausedAt >= 30, 'pause preserves position');
    await click('[aria-label="Play library song"]');
    await click('.performance-stage-trigger');
    await wait(`${canvas}?.dataset.playing === 'true'`, 'reopen band');
    await click('.performance-hero-trigger');
    await wait(`${hero}?.dataset.phase === 'playing'`, 'reopen hero');
    await click('[aria-label="Restart Muse Hero"]');
    await wait(`${hero}.dataset.phase === 'countdown' && ${audio}.paused && ${audio}.currentTime === 0`, 'restart resets the shared transport');
    await wait(`${hero}.dataset.phase === 'playing' && !${audio}.paused`, 'restart plays from zero');
    assert.ok(await evaluate(`${audio}.currentTime < 1 && Number(${hero}.dataset.time) < 1`));
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true }))");
    await wait(`${hero}.dataset.phase === 'countdown' && ${audio}.currentTime === 0`, 'R shortcut restarts');
    await click('[aria-label="Hide Muse Hero"]');
    await wait(`!${hero} && !${audio}.paused`, 'leaving countdown resumes playback');
    await delay(3200);
    assert.ok(await evaluate(`${audio}.currentTime >= 3`), 'cancelled countdown does not restart playback later');
    await click('.performance-hero-trigger');
    await wait(`${hero}?.dataset.phase === 'playing'`, 'final hero entry');
    await evaluate(`${audio}.currentTime = 39.8`);
    await wait(`${audio}.ended && ${hero}.dataset.phase === 'finished'`, 'recording end finishes the run');
    await click('[aria-label="Hide Muse Hero"]');
    await click('[aria-label="Close band stage"]');
    assert.equal(await evaluate(`${audio}.currentTime`), 40, 'closing preserves the ended position');
    console.log('Playback handoff smoke passed: 30-second Library/Band/Hero clock, uninterrupted navigation, no past-note penalty, end run, library pause/resume, Restart button, R shortcut, countdown exit, and recording completion.');
    clearTimeout(timeout); app.exit(0);
  } catch (error) {
    await writeFile('/tmp/banger-playback-handoff-failure.png', (await window.webContents.capturePage()).toPNG());
    console.error(error); clearTimeout(timeout); app.exit(1);
  }
}));
await import('../dist/main.js');
