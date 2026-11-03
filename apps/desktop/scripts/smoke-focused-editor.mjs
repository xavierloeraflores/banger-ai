import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { compileMusic, serializeMusic, INIT_SYNTH, FACTORY_PATCHES } from '../../../packages/compiler/dist/index.js';

export async function smokeFocusedEditor(window) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  const source = () => evaluate("document.querySelector('#producer-source').value");
  const select = async (selector, value) => {
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await settle();
  };
  const key = async keyCode => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await setTimeout(60);
  };
  const original = compileMusic(await readFile(new URL('../../../examples/night-drive.banger', import.meta.url), 'utf8'));
  original.tracks[4].synth = { ...INIT_SYNTH, enabled: true, osc1: 'square', cutoff: 2345, release: 2, fm: .3 };
  original.tracks[5].modular = globalThis.structuredClone(FACTORY_PATCHES[2]);
  original.tracks[5].patchLibrary = [{ name: 'Saved pad', config: { ...FACTORY_PATCHES[2].config, drive: .4 } }];
  const fixture = serializeMusic(original);
  await click('#studio-tab-source');
  await evaluate(`(() => {
    const el = document.querySelector('#producer-source');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(fixture)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await settle();
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Apply source').click()");
  await click('#studio-tab-sequencer');
  await click('[aria-label="Edit keys piano roll"]');
  assert.equal(await evaluate("document.querySelector('#track-4-tab-notes').getAttribute('aria-selected')"), 'true');
  assert.ok(await evaluate("document.querySelector('#track-4-panel-notes .piano-grid').checkVisibility()"));
  assert.ok(await evaluate("document.querySelector('.producer-track-list').getBoundingClientRect().right <= document.querySelector('#track-editor-4').getBoundingClientRect().left"));
  assert.ok(await evaluate("[...document.querySelectorAll('.producer-track')].every(row => row.getBoundingClientRect().height <= 100)"), 'Focused tracks stay compact.');
  await select('[aria-label="keys pattern"]', 'chorus');
  await click('#track-4-panel-notes .piano-note-body');
  await select('[aria-label="keys grid snap"]', '0.5');
  await evaluate(`(() => {
    document.querySelector('#track-4-panel-notes .piano-scroll').scrollTop = 1400;
    document.querySelector('#track-4-panel-notes .piano-time-scroll').scrollLeft = 160;
    window.scrollTo(0, 150);
  })()`);
  await settle();
  const scrollState = () => evaluate(`({ pitch: document.querySelector('#track-4-panel-notes .piano-scroll').scrollTop, time: document.querySelector('#track-4-panel-notes .piano-time-scroll').scrollLeft, page: window.scrollY, rack: document.querySelector('.producer-track-list').scrollTop })`);
  const beforeScroll = await scrollState();
  for (const tab of ['sound', 'effects', 'routing', 'automation', 'notes']) {
    await click(`#track-4-tab-${tab}`);
    assert.ok(await evaluate(`document.querySelector('#track-4-panel-${tab}').checkVisibility()`));
    assert.equal(await evaluate("document.querySelector('[aria-label=\"keys pattern\"]').value"), 'chorus');
  }
  assert.deepEqual(await scrollState(), beforeScroll, 'Tab changes retain page, rack, pitch and time scrolling.');
  assert.equal(await evaluate("document.querySelector('#track-4-panel-notes .piano-note').dataset.selected"), 'true');
  assert.equal(await evaluate("document.querySelector('[aria-label=\"keys grid snap\"]').value"), '0.5');
  assert.equal(await source(), fixture, 'Browsing every tab does not rewrite the music.');

  await click('#track-4-tab-sound');
  await evaluate("document.querySelector('#track-4-panel-sound').scrollTop = 200");
  await settle();
  const soundScroll = await evaluate("document.querySelector('#track-4-panel-sound').scrollTop");
  await click('#track-4-tab-notes');
  await click('#track-4-tab-sound');
  assert.equal(await evaluate("document.querySelector('#track-4-panel-sound').scrollTop"), soundScroll);
  await click('[aria-label="Edit keys piano roll"]');
  assert.equal(await evaluate("document.querySelector('#track-4-tab-notes').getAttribute('aria-selected')"), 'true', 'Preview always opens Notes.');
  assert.equal(await evaluate("document.querySelector('[aria-label=\"keys pattern\"]').value"), 'chorus');
  await click('[aria-label="Edit pad piano roll"]');
  await click('[aria-label="Edit keys piano roll"]');
  assert.equal(await evaluate("document.querySelector('[aria-label=\"keys pattern\"]').value"), 'chorus', 'Switching tracks retains the selected pattern.');
  assert.equal(await evaluate("document.querySelector('#track-4-panel-notes .piano-note').dataset.selected"), 'true');
  await click('[aria-label="Edit keys piano roll"]');
  assert.ok(await evaluate("document.querySelector('#track-editor-4').checkVisibility()"), 'Repeated preview clicks never close Notes.');

  await evaluate("document.querySelector('#track-4-tab-notes').focus()");
  await key('Right');
  assert.equal(await evaluate('document.activeElement.id'), 'track-4-tab-sound');
  await key('End');
  assert.equal(await evaluate('document.activeElement.id'), 'track-4-tab-automation');
  await key('Home');
  assert.equal(await evaluate('document.activeElement.id'), 'track-4-tab-notes');
  await evaluate("document.querySelector('#track-4-panel-notes .piano-note-body').focus()");
  await key('Up');
  assert.equal(compileMusic(await source()).tracks[4].patterns[0].pianoRoll[0].midi, 61);
  assert.deepEqual(compileMusic(await source()).tracks[4].pianoRoll, original.tracks[4].pianoRoll, 'Named-pattern edits leave base notes intact.');
  await key('Down');
  assert.deepEqual(compileMusic(await source()), original, 'Reversing the keyboard edit restores the exact music and sound settings.');
  await click('#track-4-tab-sound');
  await evaluate(`(() => {
    const el = document.querySelector('[aria-label="keys gain"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '0.4');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await settle();
  const expected = globalThis.structuredClone(original); expected.tracks[4].gain = .4;
  assert.deepEqual(compileMusic(await source()), expected, 'A sound edit preserves base notes, named notes, synth, patches, effects and automation.');
  await click('#track-4-tab-notes');
  assert.equal(await evaluate("document.querySelector('#track-4-panel-notes .piano-note').dataset.selected"), 'true');
  assert.deepEqual(compileMusic(serializeMusic(compileMusic(await source()))), expected);

  if (process.env.BANGER_EDITOR_SCREENSHOT) await writeFile(process.env.BANGER_EDITOR_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  window.setSize(390, 844);
  await settle();
  await click('[aria-label="Edit keys piano roll"]');
  assert.ok(await evaluate("document.querySelector('#track-4-panel-notes .piano-grid').getBoundingClientRect().top < window.innerHeight"), 'Mobile preview reveals the roll immediately.');
  assert.ok(await evaluate("document.querySelector('.producer-track-list').checkVisibility() && document.querySelector('#track-4-panel-notes').checkVisibility()"));
  assert.ok(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), 'The mobile editor does not overflow the page.');
  if (process.env.BANGER_EDITOR_SCREENSHOT) await writeFile(process.env.BANGER_EDITOR_SCREENSHOT.replace('.png', '-mobile.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(1400, 1000);
  await settle();
  console.log('Focused editor smoke passed: direct preview, five tabs, named patterns, selection, scroll, keyboard, sound edits, responsive layout and music round trip.');
  return source();
}
