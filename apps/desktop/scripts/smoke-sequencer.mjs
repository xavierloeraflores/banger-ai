import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, dialog } from 'electron';
import { compileMusic } from '../../../packages/compiler/dist/index.js';

app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { console.error('Sequencer smoke timed out'); app.exit(1); }, 120000);
async function run(window) {
  window.webContents.setBackgroundThrottling(false);
  const directory = await mkdtemp(join(tmpdir(), 'banger-sequencer-'));
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const waitFor = async (code, label, milliseconds = 7000) => {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) { if (await evaluate(code)) return; await delay(25); }
    throw new Error(`Timed out: ${label}; status ${await evaluate("document.querySelector('.producer-footer [role=status]').textContent + ' / ' + document.querySelector('.producer-alert')?.textContent")}`);
  };
  const source = () => evaluate('document.querySelector("#producer-source").value');
  const program = async () => compileMusic(await source());
  const selector = label => `[aria-label=${JSON.stringify(label)}]`;
  const click = async label => { await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector(label))}); if (!el || el.matches(':disabled')) throw new Error('Unavailable control: ${label}'); el.click(); })()`); await delay(35); };
  const text = async (label, scope = 'document') => { await evaluate(`(() => { const el = [...${scope}.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(label)}); if (!el || el.matches(':disabled')) throw new Error('Unavailable button: ${label}'); el.click(); })()`); await delay(35); };
  const set = async (label, value, tag = 'HTMLInputElement', blur = false) => {
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector(label))}); if (!el || el.matches(':disabled')) throw new Error('Unavailable input: ${label}'); ${blur ? 'let ancestor = el.parentElement; while (ancestor) { if (ancestor.tagName === "DETAILS") ancestor.open = true; ancestor = ancestor.parentElement; } el.scrollIntoView({block: "center"}); el.focus();' : ''} Object.getOwnPropertyDescriptor(${tag}.prototype, 'value').set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event(${JSON.stringify(tag === 'HTMLSelectElement' ? 'change' : 'input')}, { bubbles: true })); ${blur ? 'el.blur();' : ''} })()`); await delay(35);
  };
  const draft = async value => { await text('Raw .banger'); await evaluate(`(() => { const el = document.querySelector('#producer-source'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles:true })); })()`); await delay(35); };
  const apply = async value => { await draft(value); await waitFor("!document.querySelector('.producer-editor-actions button').disabled", 'source compiles'); await text('Apply source'); await text('Sequencer'); };
  const download = async label => {
    const pending = new Promise((resolve, reject) => window.webContents.session.once('will-download', (_event, item) => {
      const path = join(directory, item.getFilename()); item.setSavePath(path);
      item.once('done', (_event, state) => state === 'completed' ? resolve(path) : reject(new Error(state)));
    }));
    await text(label); const path = await pending; return { path, bytes: await readFile(path) };
  };
  try {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await apply('tempo 120; track kick { sound "drums/kick"; rhythm "x x x x"; } section intro { bars 2; play kick; } song { play intro; }');
    const originalSong = (await program()).timeline;
    window.show(); window.focus(); window.webContents.focus();
    await delay(150);
    await evaluate("document.querySelector('.producer-step').scrollIntoView({block:'center'})"); await delay(100);
    const point = await evaluate("(() => { const r = document.querySelector('.producer-step').getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()");
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type:'mouseMoved', ...point, button:'none', buttons:0 });
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type:'mousePressed', ...point, button:'left', buttons:1, clickCount:1 });
    await delay(50);
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y+50, button:'left', buttons:1 });
    await delay(80);
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y+50, button:'left', buttons:0, clickCount:1 });
    window.webContents.debugger.detach();
    await waitFor("document.querySelector('.producer-step').getAttribute('aria-label').includes('velocity 50%') && document.querySelector('#producer-source').value.includes('@0.5')", 'saved drag velocity');
    assert.equal((await program()).tracks[0].steps[0].velocity, .5, 'Drag changes step velocity without disabling the step.');
    await click('kick, step 1 probability 100%');
    await click('kick, step 1 condition always');
    assert.equal((await program()).tracks[0].steps[0].probability, .9);
    assert.equal((await program()).tracks[0].steps[0].condition, 'fill');
    await text('Copy to new pattern');
    assert.equal((await program()).activePattern, 'A');
    assert.equal((await program()).chainEnabled, false);
    assert.deepEqual((await program()).timeline, originalSong);
    assert.equal((await program()).tracks[0].patterns[0].steps[0].condition, 'fill');
    await text('Copy');
    await evaluate("document.querySelectorAll('.producer-step')[1].click()"); await delay(40);
    assert.equal((await program()).tracks[0].patterns[0].steps[1], null);
    await text('Paste');
    assert.equal((await program()).tracks[0].patterns[0].steps[1].kind, 'hit');
    await set('Master volume', .4); await text('Click');
    assert.equal((await program()).masterGain, .4); assert.equal((await program()).metronome, true);
    await text('Tap tempo'); await delay(500); await text('Tap tempo');
    assert.ok((await program()).tempo >= 100 && (await program()).tempo <= 125, 'Tap sets plausible tempo.');
    await evaluate("document.querySelector('.producer-play').click()");
    await waitFor("document.querySelector('[aria-label=\"Master output meter\"]').value > 0", 'live audio');
    const position = await evaluate("document.querySelector('.producer-position').textContent"); await delay(350);
    assert.notEqual(await evaluate("document.querySelector('.producer-position').textContent"), position);
    await text('Base'); await waitFor("document.querySelector('.producer-transport-state').textContent === 'Playing'", 'launch on bar boundary');
    await text('A'); await waitFor("document.querySelector('.producer-transport-state').textContent === 'Playing'", 'relaunch A');
    await evaluate("(() => { const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Fill'); el.dispatchEvent(new KeyboardEvent('keydown', {key:' ',bubbles:true})); })()");
    await waitFor("[...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Fill').getAttribute('aria-pressed') === 'true'", 'held fill');
    await evaluate("(() => { const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Fill'); el.dispatchEvent(new KeyboardEvent('keyup', {key:' ',bubbles:true})); })()");
    await click('Stop playback');
    const saved = await source(), projectPath = join(directory, 'performance.banger');
    dialog.showSaveDialog = async () => ({ canceled:false, filePath:projectPath }); await text('Save .banger');
    await waitFor("document.querySelector('.producer-footer [role=status]').textContent.startsWith('Saved ')", 'native save');
    assert.equal(await readFile(projectPath, 'utf8'), saved);
    dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[projectPath] }); await text('Open');
    await waitFor("document.querySelector('.producer-footer [role=status]').textContent.startsWith('Opened ')", 'native reopen');
    assert.equal(await source(), saved);
    assert.deepEqual(compileMusic(saved), await program());
    await evaluate("document.querySelector('.studio-export').open = true");
    const mix = await download('Export WAV'), stem = await download('Export stem');
    for (const output of [mix, stem]) {
      assert.equal(output.bytes.toString('ascii',0,4), 'RIFF');
      let peak = 0; for (let i=44; i<output.bytes.length; i+=2) peak = Math.max(peak, Math.abs(output.bytes.readInt16LE(i)));
      assert.ok(peak > 100, 'Export contains audio.');
    }
    window.show(); window.focus(); window.webContents.focus();
    await evaluate("window.scrollTo(0,0); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"); await delay(250);
    const heights = await evaluate("[...document.querySelectorAll('.producer-track')].map(row => row.getBoundingClientRect().height)");
    console.log('Collapsed track heights:', heights);
    await writeFile('/tmp/banger-features-sequencer.png', (await window.webContents.capturePage()).toPNG());
    console.log('Sequencer smoke passed: pointer velocity, probability/condition badges, pattern copy/paste and bar-boundary launch, tap tempo, click, master, held fill, real playback, native save/reopen and mix/stem WAV export.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timeout); window.destroy(); await rm(directory, { recursive:true, force:true }); app.exit(process.exitCode ?? 0); }
}
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', () => void run(window)));
await import('../dist/main.js');
