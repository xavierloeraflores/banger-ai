import { enterStudio } from "./smoke-startup.mjs";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveApp } from "../dist/static-app.js";
import { smokeFocusedEditor } from "./smoke-focused-editor.mjs";
import { compileMusic, pianoNotes } from "../../../packages/compiler/dist/index.js";
import { smokePiano } from "./smoke-piano.mjs";

const timeout = setTimeout(() => { console.error('Web smoke timed out'); app.exit(1); }, 45000);
async function run() {
const directory = await mkdtemp(join(tmpdir(), 'banger-web-'));
const server = createServer(async (request, response) => {
  const result = await serveApp(new Request(`banger://app${request.url}`), resolve('../www/out'));
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const window = new BrowserWindow({ width: 1400, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
const evaluate = code => window.webContents.executeJavaScript(code, true);
try {
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);await enterStudio(window);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert.equal(await evaluate('typeof window.bangerProjects'), 'undefined');
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), await readFile(new URL('../../../examples/night-drive.banger', import.meta.url), 'utf8'));
  assert.equal(await evaluate("document.querySelector('#source-title').textContent"), 'night-drive.banger');
  assert.equal(await evaluate("document.querySelector('#producer-tempo').value"), '112');
  console.log("Web startup ready");
  await smokePiano(window);
  console.log("Web piano passed");
  const source = await smokeFocusedEditor(window);
  console.log("Web focused editor passed");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Save').click()");
  await evaluate(`new Promise((resolve, reject) => { const end = Date.now() + 5000; const poll = () => {
    if (document.querySelector('.producer-footer [role=status]').textContent.startsWith('Saved ')) resolve();
    else if (Date.now() > end) reject(new Error('Browser save timed out')); else setTimeout(poll, 25);
  }; poll(); })`);
  const stored = await evaluate("(async () => { const folder = await window.smokeProjectParent.getDirectoryHandle('Sample Project'); return (await (await folder.getFileHandle('night-drive.banger')).getFile()).text(); })()");
  assert.equal(stored, source, 'Browser folder contains the edited piano source.');
  await evaluate("void (window.showDirectoryPicker = () => window.smokeProjectParent.getDirectoryHandle('Sample Project'))");
  await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Open Project').click()");
  await evaluate(`new Promise((resolve, reject) => { const end = Date.now() + 5000; const poll = () => {
    if (document.querySelector('.producer-footer [role=status]').textContent.startsWith('Opened ')) resolve();
    else if (Date.now() > end) reject(new Error('Browser reopen timed out')); else setTimeout(poll, 25);
  }; poll(); })`);
  await evaluate("document.querySelector('#project-controls [aria-label=\"Close project controls\"]')?.click()");
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), source);
  assert.deepEqual(compileMusic(await evaluate("document.querySelector('#producer-source').value")), compileMusic(source));
  for (const [index, track] of compileMusic(source).tracks.entries()) {
    if (track.source.kind !== 'instrument') continue;
    const rendered = await evaluate(`[...document.querySelectorAll('#track-editor-${index} .piano-note')].map(note => ({ midi: Number(note.dataset.midi), start: Number(note.dataset.start), duration: Number(note.dataset.duration), velocity: Number(note.dataset.velocity) }))`);
    assert.deepEqual(rendered, pianoNotes(track), 'Reopened notes render with the saved pitch, timing and velocity.');
  }
  console.log('Web smoke passed: HTTP app without desktop bridge, folder-backed save and reopen using directory-handle fixtures.');
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  clearTimeout(timeout); window.destroy(); server.close();
  await rm(directory, { recursive: true, force: true });
  app.exit(process.exitCode ?? 0);
}

}
void app.whenReady().then(run);
