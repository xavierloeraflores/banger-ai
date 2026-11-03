import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app } from 'electron';
import { compileMusic } from '../../../packages/compiler/dist/index.js';
import { enterStudio } from './smoke-startup.mjs';

const profile = await mkdtemp(join(tmpdir(), 'banger-stage-smoke-'));
app.setPath('userData', profile);
app.once('will-quit', () => { void rm(profile, { recursive: true, force: true }); });
const graphicsErrors = [];
app.on('web-contents-created', (_event, contents) => contents.on('console-message', details => {
  if (/THREE.WebGLProgram|GL_INVALID|Shader Error|WebGL: INVALID/.test(details.message)) graphicsErrors.push(details.message);
}));

const keepOpen = process.argv.includes('--keep-open');
const timeout = setTimeout(() => { console.error('Band stage smoke timed out'); app.exit(1); }, 120000);
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const wait = async (code, name) => {
    for (let i = 0; i < 600; i++) { if (await evaluate(`Boolean(${code})`)) return; await delay(30); }
    throw new Error(`Timed out: ${name}; ${await evaluate("document.querySelector('.performance-overlay')?.textContent")}`);
  };
  const clickSelector = async selector => {
    await wait(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); return button && !button.disabled && button.getBoundingClientRect().width > 0; })()`, 'control ready');
    const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  };
  const click = async label => {
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}).setAttribute('data-smoke-click', '')`);
    await clickSelector('[data-smoke-click]');
    await evaluate("document.querySelector('[data-smoke-click]')?.removeAttribute('data-smoke-click')");
  };
  try {
    await enterStudio(window);
    window.setSize(1440, 1000); window.show(); window.focus();
    const trackCount = compileMusic(await evaluate("document.querySelector('#producer-source').value")).tracks.length;
    await click('Band stage');
    await wait("document.querySelector('#performance-stage').open && document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '" + trackCount + "'", 'one character per track');
    assert.equal(await evaluate("document.querySelectorAll('.performance-viewport canvas').length"), 1);
    assert.equal(await evaluate("document.querySelector('.performance-viewport canvas').dataset.concert"), 'true');
    const outfits = await evaluate("document.querySelector('.performance-viewport canvas').dataset.outfits");
    assert.equal(JSON.parse(outfits).length, trackCount, 'each performer receives an outfit');
    await click('Play band');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.playing === 'true'", 'audio playback');
    const firstBeat = Number(await evaluate("document.querySelector('.performance-viewport canvas').dataset.beat"));
    await delay(600);
    assert.ok(Number(await evaluate("document.querySelector('.performance-viewport canvas').dataset.beat")) > firstBeat);
    assert.equal(await evaluate("document.querySelector('.performance-viewport canvas').dataset.outfits"), outfits, 'outfits stay fixed during playback');
    await writeFile('/tmp/banger-band-stage.png', (await window.webContents.capturePage()).toPNG());
    await click('Stop');
    await wait("document.querySelector('.performance-viewport canvas').dataset.playing === 'false'", 'stopped pose');
    assert.equal(await evaluate("document.querySelector('.performance-viewport canvas').dataset.outfits"), outfits, 'stopping preserves outfits');
    await evaluate("void (window.previousStage = document.querySelector('.performance-viewport canvas'))");
    await clickSelector('.performance-options input');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '" + trackCount + "' && document.querySelector('.performance-viewport canvas') !== window.previousStage", 'still mode rebuild');
    await evaluate("void (window.previousStage = document.querySelector('.performance-viewport canvas'))");
    await clickSelector('.performance-options input');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '" + trackCount + "' && document.querySelector('.performance-viewport canvas') !== window.previousStage", 'animation rebuild');
    for (let iteration = 0; iteration < 3; iteration++) {
      await clickSelector('[aria-label="Close band stage"]');
      await wait("!document.querySelector('.performance-viewport canvas')", 'renderer disposal');
      assert.equal(await evaluate("document.activeElement.textContent.trim()"), 'Band stage');
      await click('Band stage');
      await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '" + trackCount + "'", 'reopened renderer');
    }
    window.setMinimumSize(0, 0); window.setContentSize(390, 844);
    await delay(500);
    assert.ok(await evaluate("document.querySelector('#performance-stage').scrollWidth <= document.querySelector('#performance-stage').clientWidth + 1"));
    await writeFile('/tmp/banger-band-stage-mobile.png', (await window.webContents.capturePage()).toPNG());
    window.setContentSize(1440, 1000);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("!document.querySelector('#performance-stage').open", 'Escape closes modal');
    await click('Band stage');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '" + trackCount + "'", 'final stage ready');
    assert.deepEqual(graphicsErrors, [], 'No WebGL shader errors');
    console.log('Band stage smoke passed: one performer per track, shared transport, beat progression, stopped pose, still mode, repeated disposal/reopen, focus restoration, mobile layout and Escape.');
    clearTimeout(timeout);
    if (!keepOpen) app.exit(0);
    else { window.show(); window.focus(); console.log('Leaving band stage open for review.'); }
  } catch (error) { console.error(await evaluate("JSON.stringify({ open: document.querySelector('#performance-stage')?.open, hero: !!document.querySelector('.muse-game'), canvases: document.querySelectorAll('.performance-viewport canvas').length })")); await writeFile('/tmp/banger-stage-failure.png', (await window.webContents.capturePage()).toPNG()); console.error(error); clearTimeout(timeout); app.exit(1); }
}));
await import('../dist/main.js');
