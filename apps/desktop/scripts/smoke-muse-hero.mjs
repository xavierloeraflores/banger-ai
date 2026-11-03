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
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const wait = async (code, name) => {
    for (let i = 0; i < 1600; i++) { if (await evaluate(code)) return; await delay(10); }
    await writeFile("/tmp/muse-hero-failure.png", (await window.webContents.capturePage()).toPNG());
    throw new Error(`Timed out: ${name}; ${await evaluate("document.querySelector('.muse-game')?.dataset.phase + ' / ' + document.querySelector('.muse-game')?.textContent")}`);
  };
  const click = label => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
  const key = (type, keyCode) => window.webContents.sendInputEvent({ type, keyCode });
  const apply = async source => {
    await evaluate(`(() => { const field = document.querySelector('#producer-source'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(source)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('Apply source');
  };
  try {
    await enterStudio(window);
    window.setContentSize(1440, 1000); window.show(); window.focus();
    const sample = await evaluate("document.querySelector('#producer-source').value");
    await apply('tempo 120; track keys { instrument "synth/keys"; piano { note "C4" start 1 duration 1.5 velocity .7; note "C4" start 3 duration .5 velocity .7; } }');
    await click('Muse Hero');
    await wait("document.querySelector('.muse-stage canvas')?.dataset.characterCount === '1'", 'band ready');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#muse-hero')).backgroundColor"), 'rgba(0, 0, 0, 0)');
    assert.equal(await evaluate("getComputedStyle(document.body).overflow"), 'hidden');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.muse-game')).backgroundColor"), 'rgba(0, 0, 0, 0)');
    assert.ok(await evaluate("document.querySelector('#muse-hero').getBoundingClientRect().width === innerWidth && document.querySelector('#muse-hero').getBoundingClientRect().height === innerHeight"));
    await evaluate("document.querySelector('.muse-start').click()");
    await wait("document.querySelector('.muse-game').dataset.phase === 'playing' && +document.querySelector('.muse-game').dataset.time >= .47", 'manual note');
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
    assert.ok(Number(await evaluate("document.querySelector('.muse-stats .miss b').textContent")) > 0);
    await evaluate("document.querySelector('.muse-autoplay input').click()");
    await evaluate("document.querySelector('.muse-start').click()");
    await wait("document.querySelector('.muse-game').dataset.phase === 'playing'", 'autoplay begins');
    await wait("document.querySelector('.muse-game').dataset.phase === 'finished'", 'autoplay ends');
    assert.equal(await evaluate("document.querySelector('.muse-stats .perfect b').textContent"), '8');
    assert.equal(await evaluate("document.querySelector('.muse-stats .miss b').textContent"), '0');
    assert.match(await evaluate("document.querySelector('.muse-menu p').textContent"), /100.0% accuracy.*4 holds/);
    await evaluate("document.querySelector('[aria-label=\"Close Muse Hero\"]').click()");
    await wait("!document.querySelector('.muse-stage canvas')", 'renderer disposal');
    assert.equal(await evaluate('document.activeElement.textContent'), 'Muse Hero');
    await apply(sample); await click('Muse Hero');
    await wait("document.querySelector('.muse-stage canvas')?.dataset.characterCount === '8'", 'full band rebuilt');
    await delay(1000);
    await writeFile('/tmp/muse-hero-desktop.png', (await window.webContents.capturePage()).toPNG());
    window.setMinimumSize(0, 0); window.setContentSize(390, 844); await delay(400);
    assert.ok(await evaluate("document.querySelector('#muse-hero').scrollWidth === innerWidth"));
    await writeFile('/tmp/muse-hero-mobile.png', (await window.webContents.capturePage()).toPNG());
    window.setContentSize(1440, 1000);
    key('keyDown', 'Escape'); key('keyUp', 'Escape');
    await wait("!document.querySelector('#muse-hero').open", 'Escape closes game');
    await click('Muse Hero');
    await wait("document.querySelector('.muse-stage canvas')?.dataset.characterCount === '8'", 'final open');
    assert.deepEqual(graphicsErrors, []);
    clearTimeout(timeout);
    console.log('Muse Hero smoke passed: transparent fullscreen overlay, live Three.js band, keyboard and pointer hits, early hold release, misses, finite run, autoplay with holds, restart, mobile, cleanup and Escape.');
    if (!keepOpen) app.exit(0);
    else { window.show(); window.focus(); console.log('Leaving Muse Hero open.'); }
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
}));
await import('../dist/main.js');
