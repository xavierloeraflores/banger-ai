import { enterStudio } from "./smoke-startup.mjs";
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, BrowserWindow } from 'electron';
import { compileMusic, SOUND_NAMES, INSTRUMENT_NAMES } from '../../../packages/compiler/dist/index.js';
import { serveApp } from '../dist/static-app.js';
import { smokePiano } from './smoke-piano.mjs';

const web = process.argv.includes('--web');
const timeout = setTimeout(() => { console.error('Musical options smoke timed out'); app.exit(1); }, 60000);
let server;

async function run(window) {
  await enterStudio(window);
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const waitFor = async (code, label) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { if (await evaluate(code)) return; await delay(25); }
    throw new Error(`Timed out: ${label}`);
  };
  const source = () => evaluate('document.querySelector("#producer-source").value');
  const program = async () => compileMusic(await source());
  const control = label => `[aria-label=${JSON.stringify(label)}]`;
  const click = async label => {
    const selector = control(label);
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.matches(':disabled')) throw new Error('Unavailable control'); el.click(); })()`);
    await delay(30);
  };
  const clickText = async text => {
    await evaluate(`[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)}).click()`);
    await delay(30);
  };
  const set = async (label, value, tag = 'HTMLInputElement') => {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(control(label))});
      if (!el || el.matches(':disabled')) throw new Error('Unavailable control');
      Object.getOwnPropertyDescriptor(${tag}.prototype, 'value').set.call(el, ${JSON.stringify(String(value))});
      el.dispatchEvent(new Event(${JSON.stringify(tag === 'HTMLSelectElement' ? 'change' : 'input')}, { bubbles: true }));
    })()`);
    await delay(30);
  };
  const apply = async text => {
    await clickText('Raw .banger');
    await evaluate(`(() => { const el = document.querySelector('#producer-source'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles:true })); })()`);
    await waitFor("!document.querySelector('.producer-editor-actions button').disabled", 'source valid');
    await clickText('Apply source'); await clickText('Sequencer');
  };
  try {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await evaluate('typeof window.bangerProjects'), web ? 'undefined' : 'object');
    await smokePiano(window);
    const before = await program();
    const notes = before.tracks[1].pianoRoll;
    const rhythm = before.tracks[0].steps;
    for (const sound of SOUND_NAMES) {
      await set('drum sound', sound, 'HTMLSelectElement');
      assert.equal((await program()).tracks[0].source.name, sound);
      assert.deepEqual((await program()).tracks[0].steps, rhythm);
    }
    for (const sound of INSTRUMENT_NAMES) {
      await set('keys sound', sound, 'HTMLSelectElement');
      assert.equal((await program()).tracks[1].source.name, sound);
      assert.deepEqual((await program()).tracks[1].pianoRoll, notes, `${sound} preserves piano notes`);
    }
    await evaluate("document.querySelectorAll('.producer-track-effects').forEach(el => { el.open = true; })");
    await set('keys pan', -0.42);
    for (const kind of ['filter', 'delay', 'reverb']) await click(`Add keys ${kind}`);
    for (const [label, value] of [['filter cutoff', 2300], ['filter resonance', 3.2], ['delay mix', 0.37], ['delay time', 0.41], ['delay feedback', 0.63], ['reverb mix', 0.29]]) await set(`keys ${label}`, value);
    await click('Move keys reverb earlier');
    await click('Move keys reverb earlier');
    await click('Move keys filter later');
    const expectedEffects = [
      { kind: 'reverb', mix: 0.29 },
      { kind: 'delay', mix: 0.37, time: 0.41, feedback: 0.63 },
      { kind: 'filter', cutoff: 2300, resonance: 3.2 },
    ];
    const edited = (await program()).tracks[1];
    assert.equal(edited.pan, -0.42);
    assert.deepEqual(edited.effects, expectedEffects);
    assert.deepEqual(edited.pianoRoll, notes);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(control('Add keys delay'))}).disabled`), true);
    const saved = await source();
    await apply(saved.replace('tempo 137', 'tempo 139'));
    assert.deepEqual((await program()).tracks[1], edited, 'Source apply preserves all voice, pan, effects and piano settings');
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.producer-track:nth-child(2) [data-effect]')].map(el => el.dataset.effect)"), ['reverb', 'delay', 'filter']);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(control('keys delay feedback'))}).value`), '0.63');
    await click('Remove keys delay');
    assert.deepEqual((await program()).tracks[1].effects, [expectedEffects[0], expectedEffects[2]]);
    await click('Add keys delay');
    assert.deepEqual((await program()).tracks[1].effects.map(effect => effect.kind), ['reverb', 'filter', 'delay']);
    await click('Solo keys');
    await evaluate("document.querySelector('.producer-play').click()");
    await waitFor("document.querySelector('.producer-transport-state').textContent === 'Playing'", 'instrument with effects playback');
    const audibleUntil = Date.now() + 4000;
    while (!window.webContents.isCurrentlyAudible() && Date.now() < audibleUntil) await delay(25);
    assert.equal(window.webContents.isCurrentlyAudible(), true, 'Organ with ordered effects produces audio');
    assert.equal(await evaluate("!!document.querySelector('.producer-alert')"), false);
    await click('Stop playback');
    const valid = await source();
    await clickText('Raw .banger');
    await evaluate("(() => { const el = document.querySelector('#producer-source'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'broken'); el.dispatchEvent(new Event('input', {bubbles:true})); })()");
    await delay(30); await clickText('Sequencer');
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(control('keys pan'))}).matches(':disabled')`), true);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(control('Remove keys filter'))}).matches(':disabled')`), true);
    await clickText('Raw .banger'); await clickText('Revert draft');
    assert.equal(await source(), valid);
    console.log(`${web ? 'Web' : 'Desktop'} musical options smoke passed: every voice, piano preservation, pan, effect settings and order, remove/readd, source reload, organ audio and draft locks.`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timeout); window.destroy(); server?.close(); app.exit(process.exitCode ?? 0); }
}

if (web) {
  void app.whenReady().then(async () => {
  server = createServer(async (request, response) => {
    const result = await serveApp(new Request(`banger://app${request.url}`), resolve('../www/out'));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const window = new BrowserWindow({ width: 1400, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
  await run(window);
  });
} else {
  app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', () => { void run(window); }));
  await import('../dist/main.js');
}
