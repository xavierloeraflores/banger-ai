import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app } from 'electron';
import { enterStudio } from './smoke-startup.mjs';

const profile = await mkdtemp(join(tmpdir(), 'muse-hero-smoke-'));
app.setPath('userData', profile);
app.once('will-quit', () => { void rm(profile, { recursive: true, force: true }); });
const keepOpen = process.argv.includes('--keep-open');
const graphicsErrors = [];
app.on('web-contents-created', (_event, contents) => contents.on('console-message', details => {
  if (/THREE.WebGLProgram|GL_INVALID|Shader Error|WebGL: INVALID/.test(details.message)) graphicsErrors.push(details.message);
}));
const timeout = setTimeout(() => { console.error('Muse Hero smoke timed out'); app.exit(1); }, 120000);
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  const evaluate = code => window.webContents.executeJavaScript(code, true).catch(error => { throw new Error(`Renderer evaluation failed: ${code}`, { cause: error }); });
  const wait = async (code, name) => {
    for (let i = 0; i < 1600; i++) { if (await evaluate(`Boolean(${code})`)) return; await delay(10); }
    await writeFile("/tmp/muse-hero-failure.png", (await window.webContents.capturePage()).toPNG());
    throw new Error(`Timed out: ${name}; ${await evaluate("document.querySelector('.muse-game')?.dataset.phase + ' / ' + document.querySelector('.muse-game')?.textContent")}`);
  };
  const activate = async selector => {
    await wait(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); return button && !button.disabled && button.getBoundingClientRect().width > 0; })()`, 'control ready');
    const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  };
  const click = async label => {
    if (label === 'Band stage') return activate('[aria-controls="performance-stage"]');
    return evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
  };
  const key = (type, keyCode) => window.webContents.sendInputEvent({ type, keyCode });
  const apply = async source => {
    await evaluate(`(() => { const field = document.querySelector('#producer-source'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(source)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('Apply source');
  };
  try {
    await enterStudio(window);
    window.setContentSize(1440, 1000); window.setAlwaysOnTop(true); window.show(); window.focus(); window.webContents.focus();
    await activate('[aria-label="Settings"]');
    await wait("document.querySelector('#muse-hero-difficulty')", 'difficulty setting');
    assert.equal(await evaluate("document.querySelector('#muse-hero-difficulty').value"), 'normal');
    await activate('[aria-label="Close settings"]');
    await wait("!document.querySelector('#producer-settings-dialog').open && document.querySelector('[aria-label=\"Settings\"]').getAttribute('aria-expanded') === 'false'", 'settings closed');
    for (const [difficulty, count] of [['very-easy', 2], ['easy', 3], ['normal', 4], ['hard', 5]]) {
      await activate('[aria-label="Settings"]');
      await wait("document.querySelector('#muse-hero-difficulty')", 'difficulty setting');
      await evaluate(`(() => { const select = document.querySelector('#muse-hero-difficulty'); select.value = ${JSON.stringify(difficulty)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await wait(`document.querySelector('#muse-hero-difficulty').value === ${JSON.stringify(difficulty)}`, 'difficulty selected');
      await activate('[aria-label="Close settings"]');
      await wait("!document.querySelector('#producer-settings-dialog').open && document.querySelector('[aria-label=\"Settings\"]').getAttribute('aria-expanded') === 'false'", 'settings closed');
      await click('Band stage');
      await wait("document.querySelector('#performance-stage').open && !document.querySelector('.performance-hero-trigger').disabled", 'difficulty stage ready');
      await activate('.performance-hero-trigger');
      await wait(`document.querySelectorAll('.muse-frets button').length === ${count}`, 'difficulty fret count');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.muse-frets')).gridTemplateColumns.split(' ').length"), count);
      assert.match(await evaluate("document.querySelector('.muse-highway').getAttribute('aria-label')"), new RegExp(`^${count} fret lanes`));
      if (count < 5) assert.equal(await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', cancelable: true }))"), true, 'hidden fret keys are ignored');
      assert.equal(await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', cancelable: true }))"), false, 'visible fret keys are handled');
      await writeFile(`/tmp/muse-hero-${difficulty}.png`, (await window.webContents.capturePage()).toPNG());
      await activate('[aria-label="Hide Muse Hero"]');
      await activate('[aria-label="Close band stage"]');
      await wait("!document.querySelector('.performance-viewport canvas')", 'difficulty stage closed');
    }
    // Reload the application to verify this is a saved preference, not component state.
    const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    window.webContents.reload();
    await reloaded;
    await enterStudio(window);
    await activate('[aria-label="Settings"]');
    await wait("document.querySelector('#muse-hero-difficulty')?.value === 'hard'", 'difficulty persisted after reload');
    await activate('[aria-label="Close settings"]');
    await wait("!document.querySelector('#producer-settings-dialog').open && document.querySelector('[aria-label=\"Settings\"]').getAttribute('aria-expanded') === 'false'", 'settings closed');
    const sample = await evaluate("document.querySelector('#producer-source').value");
    await apply('tempo 120; track keys { instrument "synth/keys"; piano { note "C4" start 1 duration 1.5 velocity .7; note "C4" start 3 duration .5 velocity .7; } }');
    await click('Band stage');
    await wait("document.querySelector('#performance-stage').open && !document.querySelector('.performance-hero-trigger').disabled", 'shared stage ready');
    await evaluate("void (window.sharedStageCanvas = document.querySelector('.performance-viewport canvas'))");
    await activate('.performance-hero-trigger');
    await wait("document.querySelector('.muse-game')", 'click opens overlay');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '1'", 'band ready');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#muse-hero')).backgroundColor"), 'rgba(0, 0, 0, 0)');
    assert.equal(await evaluate("getComputedStyle(document.body).overflow"), 'hidden');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.muse-game')).backgroundColor"), 'rgba(0, 0, 0, 0)');
    assert.ok(await evaluate("document.querySelector('#performance-stage').getBoundingClientRect().width === innerWidth && document.querySelector('#performance-stage').getBoundingClientRect().height === innerHeight"));
    await activate('.muse-restart');
    await wait("document.querySelector('.muse-game').dataset.phase === 'countdown'", 'countdown begins');
    // Sample the receptor fill to verify that real key events reach the canvas during the count-in.
    const lit = lane => `(() => { const canvas = document.querySelector('.muse-highway'); const pixel = canvas.getContext('2d').getImageData(Math.round((500 + (${lane} - 2) * 154) / 1000 * canvas.width), Math.round(.852 * canvas.height), 1, 1).data; return pixel[3] > 230; })()`;
    for (const [lane, code] of ['A', 'S', 'D', 'F', 'G'].entries()) {
      key('keyDown', code);
      await wait(lit(lane), `countdown fret ${code} lights`);
      key('keyUp', code);
      await wait(`!${lit(lane)}`, `countdown fret ${code} releases`);
    }
    assert.equal(await evaluate("document.querySelector('.muse-game').dataset.phase"), 'countdown');
    assert.equal(await evaluate("document.querySelector('.muse-game').dataset.score"), '0');
    key('keyDown', 'G');
    await wait("document.querySelector('.muse-game').dataset.phase === 'playing' && +document.querySelector('.muse-game').dataset.time >= .47", 'manual note');
    assert.ok(await evaluate(lit(4)), 'countdown key remains held when playback starts');
    key('keyUp', 'G');
    await wait(`!${lit(4)}`, 'held countdown key releases during playback');
    key('keyDown', 'A');
    await wait("+document.querySelector('.muse-game').dataset.score > 0", 'keyboard hit scored');
    await delay(120); key('keyUp', 'A');
    await wait("document.querySelector('.muse-judgment')?.textContent.includes('Hold lost')", 'early sustain release');
    await wait("+document.querySelector('.muse-game').dataset.time >= 1.47", 'touch note');
    const beforeTouch = Number(await evaluate("document.querySelector('.muse-game').dataset.score"));
    const fret = await evaluate("(() => { const r = document.querySelector('.muse-frets button').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
    window.webContents.sendInputEvent({ type: 'mouseDown', ...fret, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...fret, button: 'left', clickCount: 1 });
    await wait(`+document.querySelector('.muse-game').dataset.score > ${beforeTouch}`, 'pointer hit scored');
    await wait("document.querySelector('.muse-game').dataset.phase === 'finished'", 'finite run completes');
    assert.ok(Number(await evaluate("document.querySelector('.muse-game').dataset.time")) >= 8, 'manual run completes without losing window focus');
    assert.ok(Number(await evaluate("document.querySelector('.muse-stats .miss b').textContent")) > 0);
    window.focus(); window.webContents.focus();
    await activate('.muse-autoplay input');
    await wait("document.querySelector('.muse-autoplay input').checked", 'autoplay selected');
    await activate('.muse-start');
    await wait("document.querySelector('.muse-game').dataset.phase === 'playing'", 'autoplay begins');
    await wait("document.querySelector('.muse-game').dataset.phase === 'finished'", 'autoplay ends');
    assert.equal(await evaluate("document.querySelector('.muse-stats .perfect b').textContent"), '8');
    assert.equal(await evaluate("document.querySelector('.muse-stats .miss b').textContent"), '0');
    assert.match(await evaluate("document.querySelector('.muse-menu p').textContent"), /100.0% accuracy.*4 holds/);
    await activate('[aria-label="Hide Muse Hero"]');
    await wait("!document.querySelector('.muse-game')", 'overlay removed');
    assert.ok(await evaluate("window.sharedStageCanvas === document.querySelector('.performance-viewport canvas')"), 'same renderer survives game');
    assert.equal(await evaluate("document.querySelectorAll('.performance-viewport canvas').length"), 1);
    await wait("document.activeElement === document.querySelector('.performance-hero-trigger')", 'toggle focus restored');
    await activate('[aria-label="Close band stage"]');
    await wait("!document.querySelector('.performance-viewport canvas')", 'renderer disposal');
    await apply(sample); await click('Band stage');
    await wait("document.querySelector('#performance-stage').open && !document.querySelector('.performance-hero-trigger').disabled", 'toggle ready');
    await activate('.performance-hero-trigger');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '8'", 'full band rebuilt');
    await delay(1000);
    await writeFile('/tmp/muse-hero-desktop.png', (await window.webContents.capturePage()).toPNG());
    window.setMinimumSize(0, 0); window.setContentSize(390, 844); await delay(400);
    assert.ok(await evaluate("document.querySelector('#muse-hero').scrollWidth === innerWidth"));
    await writeFile('/tmp/muse-hero-mobile.png', (await window.webContents.capturePage()).toPNG());
    window.setContentSize(1440, 1000);
    key('keyDown', 'Escape'); key('keyUp', 'Escape');
    await wait("!document.querySelector('.muse-game')", 'Escape hides game');
    assert.ok(await evaluate("document.querySelector('#performance-stage').open"));
    key('keyDown', 'Escape'); key('keyUp', 'Escape');
    await wait("!document.querySelector('#performance-stage').open && !document.querySelector('.performance-viewport canvas')", 'second Escape closes stage');
    await click('Band stage');
    await wait("document.querySelector('#performance-stage').open && !document.querySelector('.performance-hero-trigger').disabled", 'final toggle ready');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '8'", 'stage ready for keyboard');
    await evaluate("document.querySelector('.performance-hero-trigger').focus()");
    await wait("document.activeElement === document.querySelector('.performance-hero-trigger')", 'keyboard toggle focused');
    key('keyDown', 'Enter'); key('char', '\r'); key('keyUp', 'Enter');
    await wait("document.querySelector('.muse-game')", 'keyboard opens overlay');
    await activate('.muse-restart');
    await wait("document.querySelector('.muse-game').dataset.phase === 'countdown'", 'cancellable countdown');
    key('keyDown', 'Escape'); key('keyUp', 'Escape');
    await delay(3500);
    assert.equal(await evaluate("document.querySelector('.performance-viewport canvas').dataset.playing"), 'true', 'leaving a restart countdown resumes the band');
    await activate('.performance-hero-trigger');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '8'", 'final open');
    assert.deepEqual(graphicsErrors, []);
    clearTimeout(timeout);
    console.log('Muse Hero smoke passed: all four difficulty settings and persistence, transparent fullscreen overlay, live Three.js band, countdown key presses and releases, keys held into playback, keyboard and pointer hits, early hold release, misses, finite run, autoplay with holds, restart, mobile, cleanup and Escape.');
    if (!keepOpen) app.exit(0);
    else { window.show(); window.focus(); console.log('Leaving Muse Hero open.'); }
  } catch (error) { console.error(await evaluate("document.querySelector('.muse-game')?.dataset.time + ' / ' + document.querySelector('.muse-menu')?.textContent")); await writeFile('/tmp/muse-hero-failure.png', (await window.webContents.capturePage()).toPNG()); console.error(error); clearTimeout(timeout); app.exit(1); }
}));
await import('../dist/main.js');
