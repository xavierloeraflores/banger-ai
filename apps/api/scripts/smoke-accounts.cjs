/* eslint-disable @typescript-eslint/no-require-imports -- Electron exposes its runtime module through require in this standalone smoke script. */
// Run with Electron against a local API and a dedicated test database.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const origin = process.env.BANGER_SMOKE_URL || 'http://127.0.0.1:3048';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Account smoke tests require a local test server.');
const username = `smoke_${Date.now()}`;
const password = 'local-fixture-password-123';
const timer = setTimeout(() => { console.error('Account smoke timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { partition: `account-smoke-${Date.now()}`, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const errors = [];
  window.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('Failed to load resource')) errors.push(event.message); });
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const wait = async condition => {
    for (let i = 0; i < 100; i++) { if (await evaluate(condition)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Did not render: ${condition}\n${await evaluate('document.body.innerText')}`);
  };
  const fill = async (name, value) => evaluate(`(() => { const input=document.getElementById(${JSON.stringify(name)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent===${JSON.stringify(text)}).click()`);
  await window.loadURL(origin);
  await wait("document.body.innerText.includes('Sign in to Banger')");
  await click('New to Banger? Create an account');
  await wait("document.body.innerText.includes('Create your account')");
  await fill('account-username', username);
  await fill('account-password', password);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await writeFile('/tmp/banger-account-signup.png', (await window.webContents.capturePage()).toPNG());
  await click('Create account');
  await wait("document.body.innerText.includes('Start making music')");
  assert.equal(await evaluate('document.cookie.includes("banger_session")'), false);
  assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(username)})`), true);
  await window.reload();
  await wait("document.body.innerText.includes('Start making music')");
  await evaluate('void(window.confirm=()=>true)');
  await click('Sign out');
  await wait("document.body.innerText.includes('Sign in to Banger')");
  await fill('account-username', username.toUpperCase());
  await fill('account-password', 'incorrect-password');
  await click('Sign in');
  await wait("document.body.innerText.includes('Incorrect username or password')");
  await fill('account-password', password);
  await click('Sign in');
  await wait("document.body.innerText.includes('Start making music')");
  await writeFile('/tmp/banger-account-signed-in.png', (await window.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, []);
  console.log('PASS: rendered signup, private cookie, reload, logout, invalid password, case-insensitive returning sign-in');
  window.destroy(); clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
