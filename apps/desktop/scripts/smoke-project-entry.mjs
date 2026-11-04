import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { app, BrowserWindow, dialog } from 'electron';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { serveApp } from '../dist/static-app.js';

const web = process.argv.includes('--web');
const directory = await mkdtemp(join(tmpdir(), 'banger-project-entry-'));
app.setPath('userData', directory);
const existing = join(directory, 'Existing project');
const created = join(directory, 'New project');
const source = 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain 0.5; }';
await mkdir(existing);
await writeFile(join(existing, 'entry.banger'), source);
let pickerMode = 'cancel', pickerCalls = 0, server, exitCode = 0;
dialog.showOpenDialog = async () => {
  pickerCalls++;
  if (pickerMode === 'error') throw new Error('Folder access failed');
  return { canceled: pickerMode === 'cancel', filePaths: pickerMode === 'cancel' ? [] : [existing] };
};
dialog.showSaveDialog = async () => { pickerCalls++; return { canceled: pickerMode === 'cancel', filePath: created }; };
const timeout = setTimeout(() => { console.error('Project entry smoke timed out'); app.exit(1); }, 90000);
app.on('window-all-closed', () => {});

async function run(window) {
  const evaluate = code => { if (process.env.BANGER_ENTRY_DEBUG) console.log(code.slice(0, 180)); return window.webContents.executeJavaScript(code, true); };
  const wait = async expression => {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await delay(25);
    }
    throw new Error(`Project entry timed out: ${expression}`);
  };
  const click = (label, scope = 'body') => evaluate(`[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
  const chooseView = value => evaluate(`(() => { const field = document.querySelector('[aria-label="View"]'); field.value = ${JSON.stringify(value)}; field.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const idle = () => wait("document.querySelector('.producer-start-card')?.getAttribute('aria-busy') === 'false'");
  const mode = async value => { pickerMode = value; if (web) await evaluate(`window.entryPickerMode = ${JSON.stringify(value)}`); };
  const setupBrowser = async () => {
    if (!web) return;
    await evaluate(`(() => {
      const directory = (name, files = {}) => {
        const entries = new Map();
        const result = { kind: 'directory', name, async *values() { yield* entries.values(); },
          async getDirectoryHandle(name, options) { if (!entries.has(name)) { if (!options?.create) throw new DOMException('Missing', 'NotFoundError'); entries.set(name, directory(name)); } return entries.get(name); },
          async getFileHandle(name, options) { if (!entries.has(name)) { if (!options?.create) throw new DOMException('Missing', 'NotFoundError'); let text = ''; entries.set(name, { kind: 'file', name, getFile: async () => new File([text], name), createWritable: async () => ({ write: async value => { text = value; }, close: async () => {} }) }); } return entries.get(name); }
        };
        for (const [name, text] of Object.entries(files)) entries.set(name, { kind: 'file', name, getFile: async () => new File([text], name) });
        return result;
      };
      const existing = directory('Existing project', { 'entry.banger': ${JSON.stringify(source)} });
      window.entryParent = directory('Projects'); window.entryPickerCalls = 0; window.entryPickerMode = 'cancel';
      window.prompt = () => 'New project';
      window.showDirectoryPicker = async () => {
        window.entryPickerCalls++;
        if (window.entryPickerMode === 'cancel') throw new DOMException('Canceled', 'AbortError');
        if (window.entryPickerMode === 'error') throw new Error('Folder access failed');
        return window.entryPickerMode === 'create' ? window.entryParent : existing;
      };
    })()`);
  };
  try {
    await wait("document.querySelector('.producer-start')");
    await setupBrowser();
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.producer-start-actions button')].map(b => b.textContent)"), ['Open Project', 'Create New Project', 'Load Sample Project', 'Open Library']);
    await writeFile(`/tmp/banger-project-entry-${web ? 'web' : 'desktop'}-start.png`, (await window.webContents.capturePage()).toPNG());
    await click('Open Library');
    await wait("document.querySelector('.song-library')");
    assert.equal(web ? await evaluate('window.entryPickerCalls') : pickerCalls, 0, 'Library opens without requesting a project folder');
    assert.equal(await evaluate("document.querySelector('.producer-project').textContent.includes('night-drive')"), false);
    assert.equal(await evaluate("document.querySelector('.music-workshop, [aria-label=\"Open AI chat\"]')"), null, 'No project editing controls before a project opens');
    for (const destination of ['vocal', 'beat']) {
      await chooseView(destination);
      await wait("document.querySelector('.producer-project-required')?.open");
      assert.equal(await evaluate("document.querySelector('[aria-label=View]').value"), 'library');
      assert.match(await evaluate("document.querySelector('#project-start-description').textContent"), destination === 'vocal' ? /Vocal Studio/ : /Beat Studio/);
      await click('Open Project', '.producer-project-required'); await idle();
      assert.equal(await evaluate("document.querySelector('.producer-project-required').open"), true, 'Canceled picker keeps the prompt');
      await click('Create New Project', '.producer-project-required'); await idle();
      assert.equal(await evaluate("document.querySelector('[aria-label=View]').value"), 'library');
      await click('Cancel', '.producer-project-required');
      await wait("!document.querySelector('.producer-project-required')");
    }
    await chooseView('vocal');
    await wait("document.querySelector('.producer-project-required')?.open");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("!document.querySelector('.producer-project-required')");
    await chooseView('vocal'); await wait("document.querySelector('.producer-project-required')?.open");
    assert.ok(await evaluate("document.querySelector('.producer-project-required').getBoundingClientRect().width <= 520"), 'Prompt stays compact');
    window.setMinimumSize(0, 0); window.setContentSize(390, 844);
    await delay(100);
    assert.equal(await evaluate("document.querySelector('.producer-project-required').scrollWidth <= document.querySelector('.producer-project-required').clientWidth"), true, 'Prompt fits a narrow screen');
    window.setContentSize(1380, 980);
    await mode('error'); await click('Open Project', '.producer-project-required'); await idle();
    assert.match(await evaluate("document.querySelector('.producer-project-required [role=alert]').textContent"), /Folder access failed/);
    await writeFile(`/tmp/banger-project-entry-${web ? 'web' : 'desktop'}-prompt.png`, (await window.webContents.capturePage()).toPNG());
    await mode('open'); await click('Open Project', '.producer-project-required');
    await wait("document.querySelector('[aria-label=View]')?.value === 'vocal' && !document.querySelector('.producer-project-required')");
    assert.equal(await evaluate("document.querySelector('#producer-source').value"), source);
    await wait("document.querySelector('#workspace-file')?.value === 'entry.banger'");
    for (const destination of ['library', 'beat', 'vocal']) { await chooseView(destination); await wait(`document.querySelector('[aria-label=View]').value === '${destination}'`); }
    assert.equal(await evaluate("document.querySelector('.producer-project-required')"), null, 'An open project allows switching studios');
    await window.loadURL(window.webContents.getURL()); await wait("document.querySelector('.producer-start')"); await setupBrowser();
    await click('Open Library'); await chooseView('beat'); await wait("document.querySelector('.producer-project-required')?.open");
    await mode('create'); await click('Create New Project', '.producer-project-required');
    await wait("document.querySelector('.first-song-dialog')?.open");
    assert.equal(await evaluate("document.querySelector('[aria-label=View]').value"), 'library', 'Wait for the first song before entering the studio');
    await evaluate(`(() => { const field = document.querySelector('#first-song-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'First song'); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('Create Song', '.first-song-dialog');
    await wait("document.querySelector('[aria-label=View]')?.value === 'beat' && !document.querySelector('.producer-project-required')");
    await wait("document.querySelector('#workspace-file')?.value === 'First song.banger'");
    const saved = web ? await evaluate("(async () => (await (await (await window.entryParent.getDirectoryHandle('New project')).getFileHandle('First song.banger')).getFile()).text())()") : await readFile(join(created, 'First song.banger'), 'utf8');
    assert.equal(await evaluate("document.querySelector('#producer-source').value"), saved);
    console.log(`Project entry smoke passed (${web ? 'web' : 'desktop'}): startup Library, both studio gates, canceled pickers, cancel/Escape, errors, open/create continuation, saved first song, and switching with a project.`);
  } catch (error) {
    await writeFile('/tmp/banger-project-entry-failure.png', (await window.webContents.capturePage()).toPNG());
    console.error(error); exitCode = 1;
  } finally {
    clearTimeout(timeout); window.destroy(); server?.close();
    await rm(directory, { recursive: true, force: true }); app.exit(exitCode);
  }
}
async function startWeb() {
  server = createServer(async (request, response) => {
    const result = await serveApp(new Request(`banger://app${request.url}`), resolve('../www/out'));
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const window = new BrowserWindow({ width: 1380, height: 980, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`); await run(window);
}
if (web) {
  void app.whenReady().then(startWeb);
} else {
  app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', () => { void run(window); }));
  await import('../dist/main.js');
}
