import { enterStudio } from "./smoke-startup.mjs";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveApp } from "../dist/static-app.js";
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
  const source = await smokePiano(window);
  const downloaded = new Promise((resolve, reject) => {
    window.webContents.session.once('will-download', (_event, item) => {
      const path = join(directory, item.getFilename()); item.setSavePath(path);
      item.once('done', (_event, state) => state === 'completed' ? resolve(path) : reject(new Error(state)));
    });
  });
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Save .banger').click()");
  const path = await downloaded;
  assert.equal(await readFile(path, 'utf8'), source, 'Browser download contains the edited piano source.');
  // Reopen through the browser File input using Chromium's native file selection API.
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Page.enable');
  await window.webContents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
  const chooser = new Promise(resolve => window.webContents.debugger.once('message', (_e, method, params) => {
    if (method === 'Page.fileChooserOpened') resolve(params);
  }));
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Open').click()");
  const { backendNodeId } = await chooser;
  await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { files: [path], backendNodeId });
  await evaluate(`new Promise((resolve, reject) => { const end = Date.now() + 5000; const poll = () => {
    if (document.querySelector('.producer-footer [role=status]').textContent.startsWith('Opened ')) resolve();
    else if (Date.now() > end) reject(new Error('Browser reopen timed out')); else setTimeout(poll, 25);
  }; poll(); })`);
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), source);
  assert.equal(await evaluate("document.querySelectorAll('.piano-note').length"), 4);
  window.webContents.debugger.detach();
  console.log('Web smoke passed: HTTP app without desktop bridge, real browser download and file-input reopen.');
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  clearTimeout(timeout); window.destroy(); server.close();
  await rm(directory, { recursive: true, force: true });
  app.exit(process.exitCode ?? 0);
}

}
void app.whenReady().then(run);
