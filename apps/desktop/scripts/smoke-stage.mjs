import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { app } from 'electron';
import { compileMusic } from '../../../packages/compiler/dist/index.js';
import { enterStudio } from './smoke-startup.mjs';

const keepOpen = process.argv.includes('--keep-open');
const timeout = setTimeout(() => { console.error('Band stage smoke timed out'); app.exit(1); }, 120000);
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const wait = async (code, name) => {
    for (let i = 0; i < 600; i++) { if (await evaluate(code)) return; await delay(30); }
    throw new Error(`Timed out: ${name}; ${await evaluate("document.querySelector('.performance-overlay')?.textContent")}`);
  };
  const click = label => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
  try {
    await enterStudio(window);
    window.setSize(1440, 1000); window.show(); window.focus();
    const trackCount = compileMusic(await evaluate("document.querySelector('#producer-source').value")).tracks.length;
    await click('Band stage');
    await wait("document.querySelector('#performance-stage').open && document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '" + trackCount + "'", 'one character per track');
    assert.equal(await evaluate("document.querySelectorAll('.performance-viewport canvas').length"), 1);
    await click('Play band');
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.playing === 'true'", 'audio playback');
    const firstBeat = Number(await evaluate("document.querySelector('.performance-viewport canvas').dataset.beat"));
    await delay(600);
    assert.ok(Number(await evaluate("document.querySelector('.performance-viewport canvas').dataset.beat")) > firstBeat);
    await writeFile('/tmp/banger-band-stage.png', (await window.webContents.capturePage()).toPNG());
    await click('Stop');
    await wait("document.querySelector('.performance-viewport canvas').dataset.playing === 'false'", 'stopped pose');
    await evaluate("document.querySelector('.performance-options input').click()");
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '" + trackCount + "'", 'still mode rebuild');
    await evaluate("document.querySelector('.performance-options input').click()");
    await wait("document.querySelector('.performance-viewport canvas')?.dataset.characterCount === '" + trackCount + "'", 'animation rebuild');
    for (let iteration = 0; iteration < 3; iteration++) {
      await evaluate("document.querySelector('[aria-label=\"Close band stage\"]').click()");
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
    console.log('Band stage smoke passed: one performer per track, shared transport, beat progression, stopped pose, still mode, repeated disposal/reopen, focus restoration, mobile layout and Escape.');
    clearTimeout(timeout);
    if (!keepOpen) app.exit(0);
    else { window.show(); window.focus(); console.log('Leaving band stage open for review.'); }
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
}));
await import('../dist/main.js');
