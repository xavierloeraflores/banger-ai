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
    await wait("document.querySelector('.performance-viewport canvas').dataset.playing === 'true'", 'automatic playback when ready');
    assert.equal(await evaluate("document.querySelectorAll('.performance-transport button').length"), 1, 'one transport button');
    assert.equal(await evaluate("document.querySelector('.performance-transport button').textContent"), 'Stop');
    assert.equal(await evaluate("!!document.querySelector('.performance-options')"), false, 'controls initially collapsed');
    assert.equal(await evaluate("!!document.querySelector('#performance-title, .performance-live, #performance-description')"), false, 'removed heading and badge');
    await click('Stop');
    await wait("document.querySelector('.performance-viewport canvas').dataset.playing === 'false'", 'manual stop');
    await delay(300);
    assert.equal(await evaluate("document.querySelector('.performance-transport button').textContent"), 'Play', 'stop does not trigger autoplay again');
    const cameraPosition = () => evaluate("document.querySelector('.performance-viewport canvas').dataset.cameraPosition");
    const cameraDistance = async () => Number(await evaluate("document.querySelector('.performance-viewport canvas').dataset.cameraDistance"));
    assert.equal(await evaluate("document.querySelector('.performance-viewport canvas').dataset.cameraMode"), 'auto');
    const idlePosition = await cameraPosition();
    await delay(800);
    assert.notEqual(await cameraPosition(), idlePosition, 'camera tours before playback');
    const autoDistance = await cameraDistance();
    window.webContents.sendInputEvent({ type: 'mouseWheel', x: 700, y: 400, deltaY: 200, deltaX: 0 });
    await delay(300);
    assert.ok(Math.abs(await cameraDistance() - autoDistance) < .2, 'scroll cannot take over the automatic camera');
    const cameraShot = () => evaluate("document.querySelector('.performance-viewport canvas').dataset.cameraShot");
    const shots = new Set([await cameraShot()]);
    for (let cut = 0; cut < 3; cut++) {
      const previous = await cameraShot();
      await wait(`document.querySelector('.performance-viewport canvas').dataset.cameraShot !== ${JSON.stringify(previous)}`, 'automatic shot cut');
      const shot = await cameraShot();
      shots.add(shot);
      await delay(250);
      await writeFile(`/tmp/banger-band-stage-${shot}.png`, (await window.webContents.capturePage()).toPNG());
    }
    assert.deepEqual([...shots].sort(), ['close', 'orbit', 'overhead', 'wide'], 'automatic camera uses every shot style');
    await clickSelector('.performance-controls-trigger');
    await click('Take control');
    assert.equal(await evaluate("document.querySelector('.performance-viewport canvas').dataset.cameraMode"), 'manual');
    const heldPosition = await cameraPosition();
    await delay(500);
    assert.equal(await cameraPosition(), heldPosition, 'manual mode holds the visible pose');
    const wideDistance = await cameraDistance();
    await clickSelector('[aria-label="Zoom in"]');
    await delay(500);
    assert.ok(await cameraDistance() < wideDistance * .95, 'zoom in moves closer');
    await clickSelector('[aria-label="Zoom out"]');
    await delay(500);
    assert.ok(await cameraDistance() > wideDistance * .97, 'zoom out moves back');
    const beforeDrag = await cameraPosition();
    window.webContents.sendInputEvent({ type: 'mouseDown', x: 700, y: 400, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 850, y: 450, button: 'left' });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: 850, y: 450, button: 'left', clickCount: 1 });
    await delay(700);
    assert.notEqual(await cameraPosition(), beforeDrag, 'manual drag orbits');
    await clickSelector('.performance-controls-trigger');
    await click('Auto camera');
    assert.equal(await evaluate("document.querySelector('.performance-viewport canvas').dataset.cameraMode"), 'auto');
    const resumedPosition = await cameraPosition();
    await delay(700);
    assert.notEqual(await cameraPosition(), resumedPosition, 'automatic camera resumes');
    const outfits = await evaluate("document.querySelector('.performance-viewport canvas').dataset.outfits");
    assert.equal(JSON.parse(outfits).length, trackCount, 'each performer receives an outfit');
    await clickSelector('.performance-transport button');
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
    if (!await evaluate("!!document.querySelector('.performance-options')")) await clickSelector('.performance-controls-trigger');
    await clickSelector('.performance-options input');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '" + trackCount + "' && document.querySelector('.performance-viewport canvas') !== window.previousStage", 'still mode rebuild');
    assert.equal(await evaluate("document.querySelector('.performance-viewport canvas').dataset.playing"), 'false', 'still mode does not restart stopped audio');
    const stillPosition = await cameraPosition();
    await delay(500);
    assert.equal(await cameraPosition(), stillPosition, 'still mode freezes camera');
    await evaluate("void (window.previousStage = document.querySelector('.performance-viewport canvas'))");
    if (!await evaluate("!!document.querySelector('.performance-options')")) await clickSelector('.performance-controls-trigger');
    await clickSelector('.performance-options input');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '" + trackCount + "' && document.querySelector('.performance-viewport canvas') !== window.previousStage", 'animation rebuild');
    for (let iteration = 0; iteration < 3; iteration++) {
      if (!await evaluate("!!document.querySelector('.performance-options')")) await clickSelector('.performance-controls-trigger');
      await click('Take control');
      await clickSelector('[aria-label="Close band stage"]');
      await wait("!document.querySelector('.performance-viewport canvas')", 'renderer disposal');
      assert.equal(await evaluate("document.activeElement.textContent.trim()"), 'Band stage');
      await click('Band stage');
      await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '" + trackCount + "'", 'reopened renderer');
      assert.equal(await evaluate("document.querySelector('.performance-viewport canvas').dataset.cameraMode"), 'auto', 'reopening defaults to automatic');
      await wait("document.querySelector('.performance-viewport canvas').dataset.playing === 'true'", 'reopening starts playback');
      await click('Stop');
    }
    window.setMinimumSize(0, 0); window.setContentSize(390, 844);
    await delay(2500);
    assert.ok(await evaluate("document.querySelector('#performance-stage').scrollWidth <= document.querySelector('#performance-stage').clientWidth + 1"));
    await clickSelector('.performance-controls-trigger');
    await click('Take control');
    await wait("document.querySelector('[aria-label=\"Zoom in\"]') && document.querySelector('.performance-viewport canvas').dataset.cameraMode === 'manual'", 'mobile manual controls');
    assert.ok(await evaluate("[...document.querySelectorAll('.performance-camera-controls button')].every(button => { const rect = button.getBoundingClientRect(); return rect.x >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight; })"), 'mobile camera controls fit');
    // Let Chromium present the newly rendered controls before capturing the frame.
    await delay(300);
    await writeFile('/tmp/banger-band-stage-mobile.png', (await window.webContents.capturePage()).toPNG());
    window.setContentSize(1440, 1000);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("!document.querySelector('.performance-options')", 'Escape collapses controls');
    assert.equal(await evaluate("document.activeElement === document.querySelector('.performance-controls-trigger')"), true, 'Escape restores controller focus');
    assert.equal(await evaluate("document.querySelector('#performance-stage').open"), true);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("!document.querySelector('#performance-stage').open", 'Escape closes modal');
    await click('Band stage');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '" + trackCount + "'", 'final stage ready');
    assert.deepEqual(graphicsErrors, [], 'No WebGL shader errors');
    console.log('Band stage smoke passed: automatic shot cuts, close-ups, overhead sweeps, performer orbits, manual hold, zoom buttons, drag orbit, auto resume, still camera, default mode on reopen, mobile camera controls, one performer per track, shared transport, beat progression, stopped pose, still mode, repeated disposal/reopen, focus restoration, mobile layout and Escape.');
    clearTimeout(timeout);
    if (!keepOpen) app.exit(0);
    else { window.show(); window.focus(); console.log('Leaving band stage open for review.'); }
  } catch (error) { console.error(await evaluate("JSON.stringify({ open: document.querySelector('#performance-stage')?.open, hero: !!document.querySelector('.muse-game'), canvases: document.querySelectorAll('.performance-viewport canvas').length })")); await writeFile('/tmp/banger-stage-failure.png', (await window.webContents.capturePage()).toPNG()); console.error(error); clearTimeout(timeout); app.exit(1); }
}));
await import('../dist/main.js');
