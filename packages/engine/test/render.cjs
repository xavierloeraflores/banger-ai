/* Run with the workspace Electron binary after building compiler and engine. */
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const root = resolve(__dirname, '../../..');
let server;
const timeout = setTimeout(() => { console.error('Audio render test timed out'); app.exit(1); }, 120000);
app.whenReady().then(async () => {
  server = createServer(async (request, response) => {
    const path = request.url === '/test.js' ? resolve(__dirname, 'render-browser.mjs') : request.url.startsWith('/engine/') ? resolve(root, 'packages/engine/dist', request.url.slice(8)) : request.url.startsWith('/compiler/') ? resolve(root, 'packages/compiler/dist', request.url.slice(10)) : undefined;
    if (!path) { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Engine audio verification</title>'); return; }
    try { response.setHeader('Content-Type', 'text/javascript'); response.end((await readFile(path, 'utf8')).replaceAll("'@banger/compiler'", "'/compiler/index.js'")); }
    catch { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  await window.loadURL(`http://127.0.0.1:${server.address().port}`);
  try { const result = await window.webContents.executeJavaScript("import('/test.js').then(module => module.run())"); console.log(JSON.stringify(result, null, 2)); clearTimeout(timeout); server.close(); app.exit(0); }
  catch (error) { console.error(error); clearTimeout(timeout); server.close(); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
