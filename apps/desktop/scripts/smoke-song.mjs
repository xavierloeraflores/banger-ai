import { enterStudio } from "./smoke-startup.mjs";
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, BrowserWindow, dialog } from 'electron';
import { compileMusic, serializeMusic } from '../../../packages/compiler/dist/index.js';
import { serveApp } from '../dist/static-app.js';

const web = process.argv.includes('--web');
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { console.error('Song studio smoke timed out'); app.exit(1); }, 120000);
let server;
async function run(window) {
  await enterStudio(window);
  const directory = await mkdtemp(join(tmpdir(), 'banger-song-'));
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
    if (blur) {
      window.show(); window.focus(); window.webContents.focus();
      await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector(label))}); let ancestor = el.parentElement; while (ancestor) { if (ancestor.tagName === "DETAILS") ancestor.open = true; ancestor = ancestor.parentElement; } el.scrollIntoView({block:"center"}); el.focus(); el.select(); })()`);
      await delay(60);
      await window.webContents.insertText(String(value));
      await delay(60);
      await evaluate(`document.querySelector(${JSON.stringify(selector(label))}).blur()`);
      await delay(60);
      return;
    }
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector(label))}); if (!el || el.matches(':disabled')) throw new Error('Unavailable input: ${label}'); Object.getOwnPropertyDescriptor(${tag}.prototype, 'value').set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event(${JSON.stringify(tag === 'HTMLSelectElement' ? 'change' : 'input')}, { bubbles: true })); })()`); await delay(35);
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
    console.log('Song studio smoke started');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await evaluate('typeof window.bangerProjects'), web ? 'undefined' : 'object');
    await apply('tempo 240; track kick { sound "drums/kick"; rhythm "x . x ."; gain .5; } track keys { instrument "synth/keys"; bars 2; piano { note "C4" start 0 duration 1 velocity .7; note "G4" start 5 duration 1 velocity .6; } gain .4; }');
    await click('Edit keys');
    const base = (await program()).tracks[1].pianoRoll;
    await text('Duplicate pattern', "document.querySelectorAll('.producer-track')[1]");
    assert.equal((await program()).tracks[1].patterns[0].bars, 2);
    await set('keys phrase bars', 3);
    await evaluate("document.querySelectorAll('.piano-note-body')[0].focus()");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await waitFor("document.querySelector('.piano-note').dataset.start === '0.25'", 'selected named pattern edit');
    assert.deepEqual((await program()).tracks[1].pianoRoll, base, 'Named phrase edits preserve base notes.');
    assert.equal((await program()).tracks[1].patterns[0].pianoRoll[1].start, 5, 'Late phrase note survives.');
    await text('Quantize notes', "document.querySelectorAll('.producer-track')[1]");
    await set('keys timing quantize', .25, 'HTMLSelectElement'); await set('keys swing', .2); await set('keys humanize', .025); await set('keys humanize seed', 97);
    await text("Song");
    await evaluate("document.querySelector('.studio-arrangement summary').click()");
    await text('+ Add section'); await set('section_1 section bars', 3); await set('section_1 keys pattern', 'pattern:pattern_1', 'HTMLSelectElement'); await click('Append section_1');
    await text('+ Add section'); await set('section_2 section bars', 1); await click('Append section_2');
    await set('Timeline 1 repeats', 2);
    assert.deepEqual((await program()).timeline, [{ section: 'section_1', repeats: 2 }, { section: 'section_2', repeats: 1 }]);
    const timeline = (await program()).timeline;
    await click('Duplicate timeline 1');
    assert.deepEqual((await program()).timeline, [timeline[0], timeline[0], timeline[1]]);
    await click('Move timeline 3 earlier');
    assert.deepEqual((await program()).timeline, [timeline[0], timeline[1], timeline[0]]);
    await click('Remove timeline 3');
    await evaluate("document.querySelector('.studio-song-timeline li').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }))");
    await delay(35);
    await evaluate("document.querySelectorAll('.studio-song-timeline li')[1].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))");
    await delay(35);
    assert.deepEqual((await program()).timeline, [timeline[1], timeline[0]], 'Drag reorder persists timeline order');
    await click('Move timeline 2 earlier');
    await click('Chain arrangement');
    assert.equal((await program()).chainEnabled, false);
    assert.deepEqual((await program()).timeline, timeline);
    await click('Preview section_1, timeline 1');
    await waitFor("document.querySelector('.producer-transport-state').textContent === 'Playing'", 'section preview audio');
    assert.deepEqual((await program()).timeline, timeline, 'Preview preserves saved song');
    await text('Stop preview');
    await click('Chain arrangement');
    assert.equal((await program()).chainEnabled, true);
    await text('Mixer');
    await set('Mixer keys gain', .45); await set('Mixer keys pan', -.2);
    await click('Mixer mute keys'); await click('Mixer solo keys');
    assert.equal((await program()).tracks[1].muted, true);
    assert.equal((await program()).tracks[1].solo, true);
    assert.equal((await program()).tracks[1].gain, .45);
    assert.equal((await program()).tracks[1].pan, -.2);
    await click('Mixer mute keys'); await click('Mixer solo keys');
    await click('keys effects');
    assert.equal(await evaluate("document.querySelector('#mixer-detail details').open"), true);
    await click('keys routing');
    assert.ok(await evaluate("document.querySelector('#mixer-detail .studio-routing') !== null"));
    await text('Close', "document.querySelector('#mixer-detail')");
    await writeFile('/tmp/banger-features-mixer.png', (await window.webContents.capturePage()).toPNG());
    await evaluate("document.querySelectorAll('details').forEach(el => el.open = true)");
    await text('+ Add bus'); await text('+ Add bus');
    await text('Sequencer');
    await set('keys output', 'bus_1', 'HTMLSelectElement'); await set('keys send bus_2', .2); await set('bus_1 send bus_2', .1);
    for (const kind of ['filter','delay','eq','compressor','distortion']) await click(`Add keys ${kind}`);
    await click('Add bus_2 reverb');
    await set('keys compressor sidechain', 'kick', 'HTMLSelectElement'); await set('keys pan', -.3); await set('keys eq low', -3); await set('keys distortion amount', .15);
    await set('keys automation parameter', 'pitch', 'HTMLSelectElement'); await text('Add automation lane', "document.querySelectorAll('.producer-track')[1]");
    await set('keys pitch point 1 value', -3.5, 'HTMLInputElement', true);
    assert.equal((await program()).tracks[1].automation[0].points[0].value, -3.5);
    await evaluate("document.querySelector('[aria-label=\"keys pitch curve\"]').scrollIntoView({block:'center'})"); await delay(100);
    const graph = await evaluate("(() => { const r = document.querySelector('[aria-label=\"keys pitch curve\"]').getBoundingClientRect(); return {x:Math.round(r.left+r.width*.25),y:Math.round(r.top+r.height*.5)}; })()");
    for (const type of ['mouseMove','mouseDown','mouseUp']) window.webContents.sendInputEvent({ type, ...graph, button:'left', clickCount:1 });
    await delay(100);
    assert.equal((await program()).tracks[1].automation[0].points[1].beat, 3, 'Quarter-width curve click adds a point at one quarter of the phrase.');
    assert.ok(await evaluate("(() => { const svg = document.querySelector('[aria-label=\"keys pitch curve\"]'); const r = svg.getBoundingClientRect(), p = svg.querySelectorAll('circle')[1].getBoundingClientRect(); return Math.abs(p.left+p.width/2-(r.left+r.width*.25))<2; })()"), 'Curve point aligns with the clicked position.');
    await set('keys automation parameter', 'eq.low', 'HTMLSelectElement'); await text('Add automation lane', "document.querySelectorAll('.producer-track')[1]"); await set('keys eq.low point 2 value', -6.25, 'HTMLInputElement', true);
    await set('keys eq.low interpolation', 'step', 'HTMLSelectElement');
    assert.equal((await program()).tracks[1].automation[1].points[1].value, -6.25);
    await set('keys automation parameter', 'gain', 'HTMLSelectElement'); await text('Add automation lane', "document.querySelectorAll('.producer-track')[1]");
    assert.deepEqual((await program()).timeline, timeline, 'Mixer and phrase edits preserve song structure.');
    await set('keys pattern name', 'chorus', 'HTMLInputElement', true);
    assert.equal((await program()).sections[0].tracks.find(track => track.track === 'keys').pattern, 'chorus');
    await text('Song');
    await set('section_1 section name', 'intro', 'HTMLInputElement', true);
    assert.equal((await program()).timeline[0].section, 'intro');
    assert.deepEqual(compileMusic(serializeMusic(await program())), await program());
    await text('Sequencer');
    await evaluate("document.querySelector('.producer-play').click()");
    await waitFor("document.querySelector('[aria-label=\"keys output meter\"]').value > 0", 'live signal meter');
    await waitFor("document.querySelector('.studio-song-timeline li').dataset.playing === 'true'", 'section playback');
    await click('Mute keys');
    await waitFor("document.querySelector('.producer-transport-state').textContent === 'Playing'", 'mute update applied');
    await delay(1500);
    assert.equal(await evaluate("document.querySelector('[aria-label=\"keys output meter\"]').value"), 0, 'Mute silences gain automation.');
    await click('Mute keys');
    await waitFor("document.querySelector('[aria-label=\"keys output meter\"]').value > 0", 'unmute restores automated track');
    console.log('Song editing and playback passed');
    const preserved = await source();
    await draft('track broken { piano {'); await text('Sequencer');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"keys phrase bars\"]').matches(':disabled')"), true);
    assert.equal(await source(), 'track broken { piano {');
    assert.equal(await evaluate("document.querySelector('.producer-play').disabled"), true);
    await text('Raw .banger'); await text('Revert draft'); await text('Sequencer'); assert.equal(await source(), preserved);
    await click('Stop playback');
    // Save and reopen the complete arrangement through each application's real file flow.
    let projectPath;
    if (web) projectPath = (await download('Save')).path;
    else { projectPath = join(directory, 'song.banger'); dialog.showSaveDialog = async () => ({ canceled: false, filePath: projectPath }); await text('Save'); await waitFor("document.querySelector('.producer-footer [role=status]').textContent.startsWith('Saved ')", 'native save'); }
    assert.equal(await readFile(projectPath, 'utf8'), preserved);
    if (web) {
      window.webContents.debugger.attach('1.3'); await window.webContents.debugger.sendCommand('Page.enable'); await window.webContents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
      const chooser = new Promise(resolve => window.webContents.debugger.once('message', (_event, method, params) => { if (method === 'Page.fileChooserOpened') resolve(params); }));
      await text('Open'); const { backendNodeId } = await chooser; await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { files: [projectPath], backendNodeId }); window.webContents.debugger.detach();
    } else { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [projectPath] }); await text('Open'); }
    await waitFor("document.querySelector('.producer-footer [role=status]').textContent.startsWith('Opened ')", 'reopen arrangement'); assert.equal(await source(), preserved);
    await evaluate("document.querySelector('.studio-export').open = true");
    await text('Song');
    await evaluate("document.querySelector('.studio-song').scrollIntoView({block:'start'})");
    await delay(150);
    await writeFile('/tmp/banger-features-song.png', (await window.webContents.capturePage()).toPNG());
    await text('Sequencer');
    await click('Edit keys');
    await evaluate("document.querySelectorAll('.piano-roll')[0].scrollIntoView({block:'center'})");
    await delay(150);
    await writeFile('/tmp/banger-song-piano.png', (await window.webContents.capturePage()).toPNG());
    await evaluate("document.querySelectorAll('.studio-automation').forEach(el => el.open = true); document.querySelectorAll('.producer-track')[1].querySelector('.studio-automation').scrollIntoView({block:'center'})");
    await delay(150);
    await writeFile('/tmp/banger-song-automation.png', (await window.webContents.capturePage()).toPNG());
    console.log('Project save and reopen passed');
    const mix = await download('Export WAV'); await set('Stem track', 'keys', 'HTMLSelectElement'); const stem = await download('Export stem');
    for (const output of [mix, stem]) {
      assert.equal(output.bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(output.bytes.toString('ascii', 8, 12), 'WAVE'); assert.equal(output.bytes.readUInt16LE(22), 2); assert.equal(output.bytes.readUInt32LE(24), 44100);
      assert.ok(output.bytes.length > 44100 * 4 * 7, 'WAV includes every arranged bar.');
      let peak = 0; for (let offset = 44; offset < output.bytes.length; offset += 2) peak = Math.max(peak, Math.abs(output.bytes.readInt16LE(offset))); assert.ok(peak > 100, 'Rendered audio is non-silent.');
    }
    assert.equal(mix.bytes.length, stem.bytes.length, 'Mix and stem share the full song duration.');
    assert.notDeepEqual(mix.bytes, stem.bytes, 'Individual stem excludes other audible tracks.');
    await text('Song');
    await click('Remove timeline 2'); await click('Remove timeline 1');
    assert.equal((await program()).timeline, undefined, 'Removing last timeline entry returns to base patterns.');
    await text('Sequencer');
    await set('keys pattern', 'chorus', 'HTMLSelectElement');
    await evaluate('void (window.confirm = () => true)');
    await text('Delete pattern', "document.querySelectorAll('.producer-track')[1]");
    assert.equal((await program()).tracks[1].patterns?.length ?? 0, 0);
    assert.equal((await program()).sections[0].tracks.find(track => track.track === 'keys').pattern, undefined, 'Deleting a pattern repairs section bindings.');
    await writeFile(join(directory, 'verified.banger'), preserved);
    console.log(`Song studio ${web ? 'web' : 'desktop'} smoke passed: multi-bar pattern editing, sections/timeline preservation, groove, buses/sends/sidechain, effects, negative automation points, live meters, invalid draft, native/browser save reopen, real stereo WAV and individual stem downloads.`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timeout); window.destroy(); server?.close(); await rm(directory, { recursive:true, force:true }); app.exit(process.exitCode ?? 0); }
}
async function start() {
if (web) {
  await app.whenReady();
  server = createServer(async (request, response) => { const result = await serveApp(new Request(`banger://app${request.url}`), resolve('../www/out')); response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer())); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const window = new BrowserWindow({ width: 1600, height: 1100, webPreferences: { sandbox:true, contextIsolation:true, nodeIntegration:false } });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`); await run(window);
} else {
  app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', () => void run(window)));
  await import('../dist/main.js');
}

}
void start();
