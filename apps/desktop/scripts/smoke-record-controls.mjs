import { app, BrowserWindow, dialog } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'banger-record-controls-'));
app.setPath('userData', join(directory, 'profile'));
const source = 'tempo 120; track kick { sound "drums/kick"; rhythm "x . x ."; }';
for (const name of ['a-song', 'b-song']) await writeFile(join(directory, `${name}.banger`), source);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
let release;
const calls = [];
globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body); calls.push(body);
  const current = body.prompt.slice(body.prompt.findLastIndex(message => message.role === 'user'));
  const results = current.filter(message => message.role === 'tool');
  if (!results.length) await new Promise(resolve => { release = resolve; });
  const call = (toolName, input) => ({ type: 'tool-call', toolCallId: `${toolName}-${input.path}`, toolName, input: JSON.stringify(input) });
  const content = !results.length
    ? ['a-song', 'b-song'].map(name => call('read_file', { path: `${name}.banger` }))
    : results.length === 1 ? ['a-song', 'b-song'].map(name => call('edit_file', { path: `${name}.banger`, search: 'tempo 120', replacement: 'tempo 90' }))
    : [{ type: 'text', text: 'Finished checking selected songs.' }];
  const reason = content[0].type === 'text' ? 'stop' : 'tool-calls';
  return Response.json({ content, finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } }, warnings: [] });
};
const timeout = setTimeout(() => { console.error('Record controls smoke timed out'); app.exit(1); }, 90000);
app.on('before-quit', event => event.preventDefault());
let started = false;
app.on('browser-window-created', (_event, window) => { if (started) return; started = true; window.webContents.once('did-finish-load', () => void run(window)); });
await import('../dist/main.js');
async function run(window) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  async function wait(code) { for (let i = 0; i < 300; i++) { if (await evaluate(`Boolean(${code})`)) return; await delay(25); } throw new Error(`Missing: ${code}\n${await evaluate('document.body.innerText.slice(-1800)')}`); }
  const click = label => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(label)} && item.checkVisibility()); if (!button || button.disabled) throw new Error('Unavailable: ' + ${JSON.stringify(label)}); button.click(); })()`);
  const states = () => evaluate("[...document.querySelectorAll('.ai-chat-record-songs [role=checkbox]')].map(item => item.getAttribute('aria-checked'))");
  const openControls = () => evaluate("document.querySelector('.ai-chat-record-controls').open = true");
  try {
    await wait("document.querySelector('.producer-start')"); await click('Open Project');
    await wait("document.querySelector('#producer-source')?.value.includes('tempo 120')");
    await evaluate("window.bangerAI.save('vercel', 'anthropic/claude-opus-5-5', 'fixture-key')");
    await evaluate("window.dispatchEvent(new Event('banger:ai-settings-changed')); document.querySelector('[aria-label=\"Expand sidebar\"]').click()");
    await evaluate("document.querySelector('.app-sidebar-chat').click()");
    await wait("document.querySelectorAll('.ai-chat-record-songs [role=checkbox]').length === 2");
    assert.deepEqual(await states(), ['true', 'true']);
    await evaluate("document.querySelector('[aria-label=\"Beat Studio\"]').click()");
    await evaluate("document.querySelector('.ai-chat-launcher').click()");
    await wait("document.querySelectorAll('.ai-chat-record-songs [role=checkbox]').length === 2");
    await openControls();
    assert.deepEqual(await states(), ['true', 'false']);
    assert.equal(await evaluate("document.querySelector('.ai-chat-new-songs [role=checkbox]').getAttribute('aria-checked')"), 'false');
    // Change the selection using the keyboard, then remove the current song.
    await evaluate("document.querySelectorAll('.ai-chat-record-songs [role=checkbox]')[1].focus()");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await wait("document.querySelectorAll('.ai-chat-record-songs [role=checkbox]')[1].getAttribute('aria-checked') === 'true'");
    await evaluate("document.querySelector('.ai-chat-record-songs [role=checkbox]').click()");
    assert.deepEqual(await states(), ['false', 'true']);
    await evaluate("(() => { const field = document.getElementById('ai-chat-prompt'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Change both songs'); field.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await click('Send'); await wait("document.querySelector('.ai-chat-working')");
    assert.equal(await evaluate("document.querySelector('.ai-chat-record-controls fieldset').disabled"), true);
    for (let i = 0; i < 100 && !release; i++) await delay(25);
    assert.ok(release); release();
    await wait("!document.querySelector('.ai-chat-working')");
    assert.equal(await readFile(join(directory, 'a-song.banger'), 'utf8'), source);
    assert.match(await readFile(join(directory, 'b-song.banger'), 'utf8'), /tempo 90/);
    assert.match(JSON.stringify(calls[0].prompt), /Only these existing songs/);
    assert.match(await evaluate("document.querySelector('.ai-chat-activity').textContent"), /not selected in Record controls/);
    await delay(350); window.webContents.reload();
    await wait("document.querySelectorAll('.app-sidebar-chat').length === 2");
    await evaluate("document.querySelectorAll('.app-sidebar-chat')[1].click()");
    await wait("document.querySelectorAll('.ai-chat-record-songs [role=checkbox]').length === 2");
    assert.deepEqual(await states(), ['false', 'true']);
    await openControls(); await click('Clear selection');
    assert.deepEqual(await states(), ['false', 'false']);
    assert.match(await evaluate("document.querySelector('.ai-chat-record-controls').textContent"), /Reply only/);
    await evaluate("document.querySelector('[aria-label=\"New chat\"]').click()");
    await wait("document.querySelectorAll('.app-sidebar-chat').length === 3");
    assert.deepEqual(await states(), ['true', 'true']);
    await openControls();
    await writeFile(join(tmpdir(), 'banger-record-controls.png'), (await window.webContents.capturePage()).toPNG());
    window.setMinimumSize(0, 0); window.setSize(540, 780); await delay(150);
    assert.equal(await evaluate('window.innerWidth <= 540 && document.documentElement.scrollWidth <= window.innerWidth'), true);
    await writeFile(join(tmpdir(), 'banger-record-controls-narrow.png'), (await window.webContents.capturePage()).toPNG());
    console.log('Record controls smoke passed: project/song defaults, keyboard selection, busy lock, enforced writes, chat persistence, empty selection and narrow layout. Fixture model, real IPC/harness.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { release?.(); clearTimeout(timeout); for (const window of BrowserWindow.getAllWindows()) window.destroy(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); app.exit(process.exitCode ?? 0); }
}
