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
const emptyRecent = join(directory, 'Empty recent project');
await mkdir(emptyRecent);
if (!web) await writeFile(join(directory, 'recent-projects.json'), JSON.stringify([
  { id: 'missing', root: join(directory, 'missing'), name: 'Unavailable project', openedAt: 2 },
  { id: 'empty', root: emptyRecent, name: 'Empty recent project', openedAt: 1 },
]));
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
  const chooseView = value => evaluate(`document.querySelector('.app-sidebar [aria-label="${({ beat: 'Beat Studio', vocal: 'Vocal Studio', library: 'Library' })[value]}"]').click()`);
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
    const sidebarGeometry = () => evaluate(`(() => {
      const rail = document.querySelector('.app-sidebar-rail').getBoundingClientRect();
      const panel = document.querySelector('.app-sidebar-panel');
      return { left: rail.left, width: rail.width, top: rail.top, panelVisible: panel.checkVisibility(), contentLeft: document.querySelector('.app-shell-content').getBoundingClientRect().left };
    })()`);
    assert.deepEqual(await sidebarGeometry(), { left: 0, width: 64, top: 0, panelVisible: false, contentLeft: 64 });
    assert.equal(await evaluate("document.querySelector('.app-sidebar-toggle').getAttribute('aria-controls') === document.querySelector('.app-sidebar-panel').id"), true);
    await evaluate("document.querySelector('.app-sidebar-toggle').click()");
    await wait("document.querySelector('.app-sidebar-panel').hidden");
    assert.deepEqual(await sidebarGeometry(), { left: 0, width: 64, top: 0, panelVisible: false, contentLeft: 64 });
    assert.equal(await evaluate("[...document.querySelectorAll('.app-sidebar-rail button')].filter(button => button.checkVisibility()).length"), 6);
    await evaluate("document.querySelector('.app-sidebar-rail [aria-label=Settings]').click()");
    await wait("document.querySelector('#producer-settings-dialog')?.getAttribute('data-state') === 'open'");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("document.querySelector('#producer-settings-dialog')?.getAttribute('data-state') !== 'open'");
    assert.equal(await evaluate("document.querySelector('.app-sidebar-toggle').disabled"), true);
    await evaluate("document.querySelector('.app-sidebar-toggle').click()");
    assert.equal(await evaluate("document.querySelector('.app-sidebar-panel').hidden"), true);
    assert.equal(await evaluate("document.querySelector('.app-sidebar-footer [aria-label=\"Add project\"]').checkVisibility()"), true);

    assert.deepEqual(await evaluate("[...document.querySelectorAll('.producer-start-actions button')].map(b => b.textContent)"), ['Open Project', 'Create New Project', 'Load Sample Project', 'Open Library']);
    await writeFile(`/tmp/banger-project-entry-${web ? 'web' : 'desktop'}-start.png`, (await window.webContents.capturePage()).toPNG());
    assert.ok(await evaluate("Boolean(document.querySelector('[aria-label=\"Projects\"] [aria-label=\"Add project\"]'))"));
    await evaluate("document.querySelector('.app-sidebar-rail [aria-label=\"Add project\"]').focus(); document.activeElement.click()");
    await wait("document.querySelector('.producer-project-required')?.getAttribute('data-state') === 'open'");
    for (const [width, height] of [[1380, 980], [390, 844]]) {
      window.setMinimumSize(0, 0); window.setContentSize(width, height); await delay(250);
      const layout = await evaluate(`(() => {
        const modal = document.querySelector('.producer-project-required');
        const card = modal.querySelector('.producer-start-card');
        const rect = modal.getBoundingClientRect();
        const style = getComputedStyle(modal);
        return {
          color: style.color, font: style.fontFamily, boxSizing: getComputedStyle(card).boxSizing,
          background: getComputedStyle(card).backgroundColor,
          fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
          noOverflow: modal.scrollWidth <= modal.clientWidth,
          centered: Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 2,
        };
      })()`);
      assert.equal(layout.color, 'rgb(229, 233, 238)');
      assert.match(layout.font, /Arial/);
      assert.equal(layout.boxSizing, 'border-box');
      assert.equal(layout.background, 'rgb(27, 28, 29)');
      assert.ok(layout.fits && layout.noOverflow && layout.centered, JSON.stringify(layout));
      await writeFile(`/tmp/banger-add-project-${web ? 'web' : 'desktop'}-${width}.png`, (await window.webContents.capturePage()).toPNG());
    }
    window.setContentSize(1380, 980);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.producer-project-required .producer-start-actions button')].map(b => b.textContent)"), ['Open Project', 'Create New Project', 'Load Sample Project', 'Close']);
    await click('Close', '.producer-project-required');
    await wait("document.querySelector('.producer-project-required')?.getAttribute('data-state') !== 'open'");
    await wait("document.activeElement?.getAttribute('aria-label') === 'Add project'");
    await click('Open Library');
    await wait("document.querySelector('.song-library')");
    assert.equal(await evaluate("document.querySelector('.app-sidebar-toggle').disabled"), true);
    await evaluate("document.querySelector('.app-sidebar-rail [aria-label=\"Add project\"]').click()");
    await wait("document.querySelector('.producer-project-required')?.getAttribute('data-state') === 'open'");
    await click('Close', '.producer-project-required');

    assert.equal(web ? await evaluate('window.entryPickerCalls') : pickerCalls, 0, 'Library opens without requesting a project folder');
    assert.equal(await evaluate("document.querySelector('.producer-project').textContent.includes('night-drive')"), false);
    assert.equal(await evaluate("document.querySelector('.music-workshop, [aria-label=\"Open AI chat\"]')"), null, 'No project editing controls before a project opens');
    for (const destination of ['vocal', 'beat']) {
      await chooseView(destination);
      await wait("(document.querySelector('.producer-project-required')?.getAttribute('data-state') === 'open')");
      assert.equal(await evaluate("({ 'Library': 'library', 'Beat Studio': 'beat', 'Vocal Studio': 'vocal' })[document.querySelector('.app-sidebar-link[aria-current=page]')?.getAttribute('aria-label')]"), 'library');
      assert.match(await evaluate("document.querySelector('.producer-project-required .producer-start-card > p').textContent"), destination === 'vocal' ? /Vocal Studio/ : /Beat Studio/);
      await click('Open Project', '.producer-project-required'); await idle();
      assert.equal(await evaluate("(document.querySelector('.producer-project-required')?.getAttribute('data-state') === 'open')"), true, 'Canceled picker keeps the prompt');
      await click('Create New Project', '.producer-project-required'); await idle();
      assert.equal(await evaluate("({ 'Library': 'library', 'Beat Studio': 'beat', 'Vocal Studio': 'vocal' })[document.querySelector('.app-sidebar-link[aria-current=page]')?.getAttribute('aria-label')]"), 'library');
      await click('Close', '.producer-project-required');
      await wait("document.querySelector('.producer-project-required')?.getAttribute('data-state') !== 'open'");
    }
    await chooseView('vocal');
    await wait("(document.querySelector('.producer-project-required')?.getAttribute('data-state') === 'open')");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("document.querySelector('.producer-project-required')?.getAttribute('data-state') !== 'open'");
    await chooseView('vocal'); await wait("(document.querySelector('.producer-project-required')?.getAttribute('data-state') === 'open')");
    assert.ok(await evaluate("document.querySelector('.producer-project-required').getBoundingClientRect().width <= 520"), 'Prompt stays compact');
    window.setMinimumSize(0, 0); window.setContentSize(390, 844);
    await delay(100);
    assert.equal(await evaluate("document.querySelector('.producer-project-required').scrollWidth <= document.querySelector('.producer-project-required').clientWidth"), true, 'Prompt fits a narrow screen');
    window.setContentSize(1380, 980);
    await mode('error'); await click('Open Project', '.producer-project-required'); await idle();
    assert.match(await evaluate("document.querySelector('.producer-project-required [role=alert]').textContent"), /Folder access failed/);
    await writeFile(`/tmp/banger-project-entry-${web ? 'web' : 'desktop'}-prompt.png`, (await window.webContents.capturePage()).toPNG());
    await mode('open'); await click('Open Project', '.producer-project-required');
    await wait("({ 'Library': 'library', 'Beat Studio': 'beat', 'Vocal Studio': 'vocal' })[document.querySelector('.app-sidebar-link[aria-current=page]')?.getAttribute('aria-label')] === 'vocal' && document.querySelector('.producer-project-required')?.getAttribute('data-state') !== 'open'");
    assert.equal(await evaluate("document.querySelector('#producer-source').value"), source);
    await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");
    await wait("document.querySelector('#project-controls')?.getAttribute('data-state') === 'open' && document.querySelector('.app-sidebar-song[aria-current]')?.dataset.songPath === 'entry.banger'");
    assert.ok(await evaluate("[...document.querySelectorAll('#project-controls button')].some(b => b.textContent === 'Load Sample Project')"));
    await evaluate("document.querySelector('[aria-label=\"Close project controls\"]').click()");
    for (const destination of ['library', 'beat', 'vocal']) { await chooseView(destination); await wait(`({ 'Library': 'library', 'Beat Studio': 'beat', 'Vocal Studio': 'vocal' })[document.querySelector('.app-sidebar-link[aria-current=page]')?.getAttribute('aria-label')] === '${destination}'`); }
    assert.equal(await evaluate("document.querySelector('.producer-project-required')?.getAttribute('data-state') === 'open'"), false, 'An open project allows switching studios');
    // Songs are available without opening project controls, in both desktop and browser workspaces.
    assert.equal(await evaluate("document.querySelector('.app-sidebar-toggle').disabled"), false);
    assert.equal(await evaluate("document.querySelector('.app-sidebar-panel').hidden"), true);
    assert.equal(await evaluate("document.querySelector('.app-sidebar-rail [aria-label=\"Add project\"]')"), null);
    await evaluate("document.querySelector('.app-sidebar-toggle').click()");
    await wait("!document.querySelector('.app-sidebar-panel').hidden");
    window.setMinimumSize(0, 0); window.setContentSize(390, 844); await delay(100);
    assert.deepEqual(await sidebarGeometry(), { left: 0, width: 64, top: 0, panelVisible: true, contentLeft: 64 });
    await writeFile(`/tmp/banger-sidebar-${web ? 'web' : 'desktop'}-mobile.png`, (await window.webContents.capturePage()).toPNG());
    await evaluate("document.querySelector('.app-sidebar-backdrop').click()");
    await wait("document.querySelector('.app-sidebar-panel').hidden");
    assert.equal(await evaluate("document.activeElement === document.querySelector('.app-sidebar-toggle')"), true);
    window.setContentSize(1380, 980); await delay(100);
    await evaluate("document.querySelector('.app-sidebar-toggle').click()");
    await wait("!document.querySelector('.app-sidebar-panel').hidden");
    await evaluate("document.querySelector('[aria-label=\"Add project\"]').focus()");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("document.querySelector('.app-sidebar-panel').hidden");
    assert.equal(await evaluate("document.activeElement === document.querySelector('.app-sidebar-toggle')"), true);
    await evaluate("document.querySelector('.app-sidebar-toggle').click()");
    await wait("!document.querySelector('.app-sidebar-panel').hidden");

    assert.deepEqual(await evaluate("[...document.querySelectorAll('.app-sidebar-song')].map(button => button.dataset.songPath)"), ['entry.banger']);
    await evaluate("document.querySelector('[aria-label=\"Add song\"]').focus(); document.querySelector('[aria-label=\"Add song\"]').click()");
    await wait("document.querySelector('.create-song-dialog')?.getAttribute('data-state') === 'open'");
    await evaluate(`(() => { const field = document.querySelector('[aria-label="New song name"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'Second song'); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('Create New Song', '.create-song-dialog');
    await wait("document.querySelector('.app-sidebar-song[aria-current]')?.dataset.songPath === 'Second song.banger'");
    await wait("document.activeElement?.getAttribute('aria-label') === 'Add song'");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.app-sidebar-song')].map(button => button.dataset.songPath)"), ['Second song.banger', 'entry.banger']);
    const secondSource = await evaluate("document.querySelector('#producer-source').value");
    await evaluate("document.querySelector('[aria-label=\"Open song entry.banger\"]').click()");
    await wait("document.querySelector('.app-sidebar-song[aria-current]')?.dataset.songPath === 'entry.banger'");
    assert.equal(await evaluate("document.querySelector('#producer-source').value"), source);
    await chooseView('beat'); await click('Raw .banger');
    await evaluate(`(() => { const field = document.querySelector('#producer-source'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, field.value + '\\n// unsaved song'); field.dispatchEvent(new Event('input', { bubbles: true })); window.confirm = () => false; })()`);
    await evaluate("document.querySelector('[aria-label=\"Open song Second song.banger\"]').click()");
    assert.match(await evaluate("document.querySelector('#producer-source').value"), /unsaved song/);
    assert.equal(await evaluate("document.querySelector('.app-sidebar-song[aria-current]').dataset.songPath"), 'entry.banger');
    await evaluate("window.confirm = () => true; document.querySelector('[aria-label=\"Open song Second song.banger\"]').click()");
    await wait("document.querySelector('.app-sidebar-song[aria-current]')?.dataset.songPath === 'Second song.banger'");
    assert.equal(await evaluate("document.querySelector('#producer-source').value"), secondSource);
    await evaluate("document.querySelector('[aria-label=\"Open song entry.banger\"]').click()");
    await wait("document.querySelector('.app-sidebar-song[aria-current]')?.dataset.songPath === 'entry.banger'");
    window.setContentSize(390, 844); await delay(100);
    assert.ok(await evaluate("document.querySelector('.app-sidebar').scrollWidth <= document.querySelector('.app-sidebar').clientWidth"));
    await writeFile(`/tmp/banger-sidebar-songs-${web ? 'web' : 'desktop'}.png`, (await window.webContents.capturePage()).toPNG());
    window.setContentSize(1380, 980);
    await window.loadURL(window.webContents.getURL()); await wait("document.querySelector('.producer-start')"); await setupBrowser();
    if (!web) {
      await wait("[...document.querySelectorAll('.producer-start-recents button')].some(b => b.textContent === 'Existing project')");
      const beforeRestore = pickerCalls;
      for (const destination of ['beat', 'vocal']) {
        await click('Open Library'); await chooseView(destination);
        await wait("document.querySelector('.producer-project-required .producer-start-recents')");
        await click('Unavailable project', '.producer-project-required .producer-start-recents'); await idle();
        assert.match(await evaluate("document.querySelector('.producer-project-required [role=alert]').textContent"), /unavailable/);
        assert.equal(await evaluate("document.querySelector('.app-sidebar-link[aria-current=page]').getAttribute('aria-label')"), 'Library');
        window.setContentSize(390, 844); await delay(100);
        assert.equal(await evaluate("document.querySelector('.producer-project-required').scrollWidth <= document.querySelector('.producer-project-required').clientWidth"), true, 'Recent projects fit a narrow prompt');
        await writeFile('/tmp/banger-recent-project-prompt.png', (await window.webContents.capturePage()).toPNG());
        window.setContentSize(1380, 980);
        await click('Existing project', '.producer-project-required .producer-start-recents');
        await wait(`document.querySelector('.app-sidebar-link[aria-current=page]')?.getAttribute('aria-label') === '${destination === 'beat' ? 'Beat Studio' : 'Vocal Studio'}' && document.querySelector('.producer-project-required')?.getAttribute('data-state') !== 'open'`);
        assert.equal(await evaluate("document.querySelector('#producer-source').value"), source);
        assert.equal(pickerCalls, beforeRestore, 'Recent projects reopen without a folder picker');
        await window.loadURL(window.webContents.getURL()); await wait("document.querySelector('.producer-start')");
      }
      await wait("document.querySelector('.producer-start-recents')");
      await click('Empty recent project', '.producer-start-recents');
      await wait("document.querySelector('.first-song-dialog')?.getAttribute('data-state') === 'open'");
      await evaluate(`(() => { const field = document.querySelector('#first-song-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'Recent song'); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await click('Create Song', '.first-song-dialog');
      await wait("document.querySelector('.app-sidebar-link[aria-current=page]')?.getAttribute('aria-label') === 'Beat Studio' && !document.querySelector('.first-song-dialog')");
      assert.ok((await readFile(join(emptyRecent, 'Recent song.banger'), 'utf8')).length > 0);
      assert.equal(pickerCalls, beforeRestore, 'Empty recent projects also bypass the folder picker');
      await window.loadURL(window.webContents.getURL()); await wait("document.querySelector('.producer-start')");
    }
    await click('Open Library'); await chooseView('beat'); await wait("(document.querySelector('.producer-project-required')?.getAttribute('data-state') === 'open')");
    await mode('create'); await click('Create New Project', '.producer-project-required');
    await wait("(document.querySelector('.first-song-dialog')?.getAttribute('data-state') === 'open')");
    assert.equal(await evaluate("({ 'Library': 'library', 'Beat Studio': 'beat', 'Vocal Studio': 'vocal' })[document.querySelector('.app-sidebar-link[aria-current=page]')?.getAttribute('aria-label')]"), 'library', 'Wait for the first song before entering the studio');
    await evaluate(`(() => { const field = document.querySelector('#first-song-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'First song'); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('Create Song', '.first-song-dialog');
    await wait("({ 'Library': 'library', 'Beat Studio': 'beat', 'Vocal Studio': 'vocal' })[document.querySelector('.app-sidebar-link[aria-current=page]')?.getAttribute('aria-label')] === 'beat' && document.querySelector('.producer-project-required')?.getAttribute('data-state') !== 'open'");
    await wait("document.querySelector('.app-sidebar-song[aria-current]')?.dataset.songPath === 'First song.banger'");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.app-sidebar-song')].map(button => button.dataset.songPath)"), ['First song.banger']);
    {
      if (web) {
        await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");
        await mode('open'); await click('Open Project', '#project-controls');
      } else await evaluate("document.querySelector('.app-sidebar-recents [aria-label=\"Open project Existing project\"]').click()");
      await wait("document.querySelector('.app-sidebar-song[aria-current]')?.dataset.songPath === 'entry.banger'");
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.app-sidebar-song')].map(button => button.dataset.songPath)"), web ? ['entry.banger'] : ['Second song.banger', 'entry.banger']);
      await evaluate("document.querySelector('.app-sidebar-recents [aria-label=\"Open project New project\"]').click()");
      await wait("document.querySelector('.app-sidebar-song[aria-current]')?.dataset.songPath === 'First song.banger'");
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.app-sidebar-song')].map(button => button.dataset.songPath)"), ['First song.banger']);
      await chooseView('beat');
    }
    await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");
    await wait("document.querySelector('#project-controls')?.getAttribute('data-state') === 'open'");
    await evaluate("document.querySelector('[aria-label=\"Close project controls\"]').click()");
    assert.equal(await evaluate("[...document.querySelectorAll('.producer-file-actions button')].find(b => b.textContent === 'Save').disabled"), true);
    await click('Raw .banger');
    await evaluate(`(() => { const field = document.querySelector('#producer-source'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, field.value + '\\n// saved from header'); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await wait("[...document.querySelectorAll('.producer-file-actions button')].find(b => b.textContent === 'Save')?.disabled === false");
    await click('Save', '.producer-file-actions');
    await wait("document.querySelector('.producer-footer [role=status]')?.textContent.startsWith('Saved ')");
    assert.equal(await evaluate("[...document.querySelectorAll('.producer-file-actions button')].find(b => b.textContent === 'Save').disabled"), true);
    await click('Apply source');
    await evaluate("document.querySelector('.producer-header .studio-export-menu > button').focus()");
    await click('Export', '.producer-file-actions');
    await wait("document.querySelector('.studio-export-dialog')?.getAttribute('data-state') === 'open'");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.studio-export-actions button')].map(b => b.textContent)"), ['Export and download', 'Export and save to library']);
    assert.ok(await evaluate("Boolean(document.querySelector('[aria-label=\"Export sample rate\"]') && document.querySelector('[aria-label=\"Stem track\"]'))"));
    window.setMinimumSize(0, 0); window.setContentSize(390, 844); await delay(100);
    assert.equal(await evaluate("document.querySelector('.studio-export-dialog').scrollWidth <= document.querySelector('.studio-export-dialog').clientWidth"), true);
    await writeFile(`/tmp/banger-export-${web ? 'web' : 'desktop'}.png`, (await window.webContents.capturePage()).toPNG());
    await evaluate("document.querySelector('[aria-label=\"Close export options\"]').click()");
    await wait("document.activeElement?.textContent === 'Export'");
    window.setContentSize(1380, 980);
    const saved = web ? await evaluate("(async () => (await (await (await window.entryParent.getDirectoryHandle('New project')).getFileHandle('First song.banger')).getFile()).text())()") : await readFile(join(created, 'First song.banger'), 'utf8');
    assert.equal(await evaluate("document.querySelector('#producer-source').value"), saved);
    console.log(`Project entry smoke passed (${web ? 'web' : 'desktop'}): startup Library, both studio gates, canceled pickers, cancel/Escape, errors, open/create continuation, saved first song, sidebar song creation and switching, unsaved-change guards, and project-specific song lists.`);
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
