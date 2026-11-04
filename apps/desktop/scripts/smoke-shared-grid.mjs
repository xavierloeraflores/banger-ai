import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app } from 'electron';
import { compileMusic, serializeMusic, resolveArrangement } from '../../../packages/compiler/dist/index.js';
import { enterStudio } from './smoke-startup.mjs';

const profile = await mkdtemp(join(tmpdir(), 'banger-grid-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { console.error('Shared grid smoke timed out'); app.exit(1); }, 90000);
async function run(window) {
  const evaluate = code => window.webContents.executeJavaScript(code, true).catch(error => { throw new Error(`${error.message} while evaluating: ${code}`); });
  const wait = async (code, label) => {
    for (let attempt = 0; attempt < 400; attempt++) { if (await evaluate(code)) return; await delay(25); }
    throw new Error(`Timed out: ${label}`);
  };
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(50); };
  const input = async (selector, value, type = 'HTMLInputElement') => {
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(${type}.prototype, 'value').set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event('${type === 'HTMLSelectElement' ? 'change' : 'input'}', {bubbles:true})); })()`);
    await delay(50);
  };
  const program = async () => compileMusic(await evaluate("document.querySelector('#producer-source').value"));
  const key = async (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({type:'keyDown', keyCode, modifiers});
    window.webContents.sendInputEvent({type:'keyUp', keyCode, modifiers});
    await delay(80);
  };
  const apply = async value => {
    await click('#studio-tab-source');
    await input('#producer-source', value, 'HTMLTextAreaElement');
    await wait("!document.querySelector('.producer-editor-actions button').disabled", 'valid fixture');
    await click('.producer-editor-actions button');
    await click('#studio-tab-sequencer');
  };
  try {
    await enterStudio(window);
    window.show(); window.focus(); window.webContents.focus();
    window.webContents.setBackgroundThrottling(false);
    const originalViewport = window.getContentSize();
    for (const width of [800, 1600]) {
      window.setMinimumSize(0, 0); window.setContentSize(width, 980);
      await wait(`innerWidth === ${width}`, 'sample viewport');
      await evaluate("document.activeElement.blur(); document.querySelector('.producer-step').focus({preventScroll:true})");
      await delay(100);
      await writeFile(`/tmp/banger-shared-grid-sample-${width}.png`, (await window.webContents.capturePage()).toPNG());
    }
    const fixture = compileMusic('tempo 240; track kick { sound "drums/kick"; rhythm "x . . . x . . . x . . . x . . ."; pattern chorus { rhythm "x x x x"; } } track hat { sound "drums/hat"; rhythm "x . x . x . x ."; } track bass { instrument "synth/bass"; notes "C2 . . . C2 . . . C2 . . . C2 . . ."; } section intro { bars 2; play kick; play hat; play bass; } section chorus { bars 1; play kick chorus; } song { play intro; play chorus; }');
    fixture.tracks[2].bars = 2;
    fixture.tracks[2].steps = [...fixture.tracks[2].steps, ...fixture.tracks[2].steps];
    await apply(serializeMusic(fixture));
    const song = (await program()).timeline;
    assert.equal(await evaluate("document.querySelector('.producer-playback-mode button').getAttribute('aria-pressed')"), 'true');

    for (const width of [...new Set([originalViewport[0], 800, 1600, 390])]) {
      window.setMinimumSize(0,0); window.setContentSize(width, 980);
      await wait(`innerWidth === ${width}`, 'viewport resize');
      await evaluate("document.querySelector('.producer-sequence-scroll').scrollLeft = 0");
      await delay(100);
      const measure = () => evaluate(`(() => {
        const box = el => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width}; };
        return { viewport:innerWidth, pageWidth:document.documentElement.scrollWidth,
          label:box(document.querySelector('.producer-track-toggle')),
          beats:[...document.querySelectorAll('.producer-beat-ruler > span')].map(box),
          rows:[...document.querySelectorAll('.producer-step-grid')].map(row => [...row.querySelectorAll('.producer-step-cell')].map(box)),
          scroll:document.querySelector('.producer-sequence-scroll').scrollLeft };
      })()`);
      const before = await measure();
      assert.ok(before.pageWidth <= width + 1, `No page overflow at ${width}`);
      for (let beat = 0; beat < 4; beat++) {
        assert.ok(Math.abs(before.rows[0][beat*4].x - before.beats[beat].x) < 1, '16-step beat alignment');
        assert.ok(Math.abs(before.rows[1][beat*2].x - before.beats[beat].x) < 1, '8-step beat alignment');
      }
      for (let beat = 0; beat < 8; beat++) assert.ok(Math.abs(before.rows[2][beat*4].x - before.beats[beat].x) < 1, 'Two-bar alignment');
      await evaluate("document.querySelector('.producer-sequence-scroll').scrollLeft = 240");
      await delay(80);
      const after = await measure();
      assert.ok(Math.abs(before.label.x - after.label.x) < 1, 'Track labels stay fixed');
      for (const row of after.rows) assert.ok(Math.abs((before.rows[after.rows.indexOf(row)][0].x - row[0].x) - after.scroll) < 1, 'Rows scroll together');
      assert.ok(Math.abs(before.beats[0].x - after.beats[0].x - after.scroll) < 1, 'Ruler scrolls with rows');
      await evaluate("document.querySelector('.producer-sequence-scroll').scrollLeft = 0; document.activeElement.blur(); document.querySelector('.producer-step').focus({preventScroll:true})");
      await delay(50);
      await writeFile(`/tmp/banger-shared-grid-${width}.png`, (await window.webContents.capturePage()).toPNG());
      console.log(`Aligned at ${width}px; fixed labels and shared scroll verified.`);
      // Mode transitions must work at each viewport and preserve the arrangement.
      await click('.producer-playback-mode button:last-child');
      assert.equal((await program()).chainEnabled, false);
      await input('[aria-label="Launch pattern"]', 'chorus', 'HTMLSelectElement');
      assert.equal((await program()).activePattern, 'chorus');
      assert.equal(resolveArrangement(await program())[0].pattern, 'chorus');
      assert.deepEqual((await program()).timeline, song);
      await click('.producer-playback-mode button:first-child');
      assert.equal((await program()).chainEnabled, true);
      assert.equal(resolveArrangement(await program())[0].section, 'intro');
      await input('[aria-label="Launch pattern"]', '', 'HTMLSelectElement');
      await click('.producer-playback-mode button:first-child');
    }
    window.setContentSize(800,980);
    await evaluate("document.activeElement.blur(); document.querySelector('.producer-step').focus()");
    await key('Down', ['shift']);
    assert.equal((await program()).tracks[0].steps[0].velocity, .95);
    await wait("document.querySelector('[aria-label=\"Selected step velocity\"]') && !document.querySelector('[aria-label=\"Selected step velocity\"]').matches(':disabled')", 'inspector ready');
    await key('E');
    await wait("document.activeElement.getAttribute('aria-label') === 'Selected step velocity'", 'keyboard focus enters inspector');
    await key('Escape');
    assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'), /kick, step 1/);
    await input('[aria-label="Selected step velocity"]', 63);
    await input('[aria-label="Selected step probability"]', 37);
    await input('[aria-label="Selected step condition"]', 'every-2', 'HTMLSelectElement');
    assert.deepEqual((await program()).tracks[0].steps[0], {kind:'hit', velocity:.63, probability:.37, condition:'every-2'});
    await evaluate("document.activeElement.blur(); document.querySelector('.producer-step').focus()");
    await key('Right');
    assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'), /step 2/);
    await key('Space');
    assert.equal((await program()).tracks[0].steps[1].kind, 'hit');
    await key('Space');
    assert.equal((await program()).tracks[0].steps[1], null);
    await key('End');
    assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'), /step 16/);
    assert.equal(await evaluate(`(() => {
      const step = document.activeElement.getBoundingClientRect();
      const label = document.querySelector('.producer-track-toggle').getBoundingClientRect();
      const mix = document.querySelector('.producer-track-mix').getBoundingClientRect();
      return step.left >= label.right && step.right <= mix.left;
    })()`), true, 'Keyboard focus stays visible between fixed columns');
    await key('Home');
    await key('Down');
    assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'), /hat, step 1/);
    await evaluate("document.querySelector('.producer-step').dispatchEvent(new MouseEvent('click', {bubbles:true, shiftKey:true}))");
    assert.equal((await program()).tracks[0].steps[0].velocity, .63, 'Shift-click selects without toggling');
    await input('[aria-label="Launch pattern"]', 'chorus', 'HTMLSelectElement');
    await evaluate("document.activeElement.blur(); document.querySelector('.producer-step').focus()");
    await input('[aria-label="Selected step probability"]', 45);
    assert.equal((await program()).tracks[0].patterns[0].steps[0].probability, .45);
    assert.equal((await program()).tracks[0].steps[0].probability, .37, 'Inspector changes only the selected phrase');
    await click('[aria-label="Edit kick"]');
    await input('[aria-label="kick pattern"]', '', 'HTMLSelectElement');
    assert.equal(await evaluate("document.querySelector('.producer-step-inspector') === null"), true, 'Selection clears across phrases');
    await click('[aria-label="Close kick editor"]');
    await click('.producer-play');
    await wait("document.querySelector('.producer-position').getAttribute('aria-label') !== 'Stopped'", 'live pattern playback');
    await click('.producer-playback-mode button:first-child');
    await wait("!document.querySelector('.producer-transport-state')", 'song update applied at bar boundary');
    await wait("document.querySelector('[aria-label=\"Master output meter\"]').value > 0", 'song produces audio');
    await click('.producer-playback-mode button:last-child');
    await wait("!document.querySelector('.producer-transport-state')", 'pattern update applied at bar boundary');
    await click('[aria-label="Stop playback"]');
    await click('#studio-tab-song');
    await click('[aria-label="Chain arrangement"]');
    assert.equal(await evaluate("document.querySelector('.producer-playback-mode button').getAttribute('aria-pressed')"), 'true', 'Arrangement chain control updates transport');
    await click('[aria-label="Preview intro, timeline 1"]');
    await wait("document.querySelector('.producer-mode-status').textContent === 'Previewing intro'", 'section preview state');
    await click('.producer-playback-mode button:last-child');
    assert.equal(await evaluate("document.querySelector('.producer-mode-status').textContent.includes('Previewing')"), false, 'Pattern mode exits section preview');
    await click('[aria-label="Stop playback"]');
    assert.equal(await evaluate("document.querySelector('.producer-position').getAttribute('aria-label')"), 'Stopped');
    await apply('tempo 120; track kick { sound "drums/kick"; rhythm "x . x ."; }');
    assert.equal(await evaluate("document.querySelector('.producer-playback-mode button').disabled"), true, 'Song unavailable without timeline');
    assert.equal(await evaluate("document.querySelector('.producer-playback-mode button:last-child').getAttribute('aria-pressed')"), 'true');
    await evaluate("document.activeElement.blur(); document.querySelector('.producer-step').focus()");
    await click('#studio-tab-source');
    await input('#producer-source', 'invalid draft', 'HTMLTextAreaElement');
    await click('#studio-tab-sequencer');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Selected step velocity\"]').matches(':disabled')"), true, 'Draft disables inspector');
    console.log('Shared grid smoke passed: viewport alignment, scrolling, keyboard editing, inspector phrase isolation, Song/Pattern state and live mode transitions.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timeout); window.destroy(); await rm(profile, {recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(() => {}); app.exit(process.exitCode ?? 0); }
}
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', () => void run(window)));
await import('../dist/main.js');
