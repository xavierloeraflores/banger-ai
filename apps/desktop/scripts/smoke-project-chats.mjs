import { app, BrowserWindow, dialog } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'banger-project-chats-'));
app.setPath('userData', join(directory, 'profile'));
const source = 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain 0.5; }';
for (const name of ['Project A', 'Project B']) { await mkdir(join(directory, name)); await writeFile(join(directory, name, 'song.banger'), source); }
let selected = 'Project A';
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [join(directory, selected)] });
let release;
const calls = [];
globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body); calls.push(body);
  const index = body.prompt.findLastIndex(message => message.role === 'user');
  const current = body.prompt.slice(index);
  const user = JSON.stringify(current[0]);
  const tools = current.filter(message => message.role === 'tool');
  if (user.includes('background A') && !tools.length) await new Promise(resolve => { release = resolve; });
  if (user.includes('cancel task')) await new Promise((_resolve, reject) => { if (options.signal.aborted) reject(options.signal.reason); else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); });
  const call = (name, input) => ({ type: 'tool-call', toolCallId: `${name}-${calls.length}`, toolName: name, input: JSON.stringify(input) });
  const content = user.includes('fresh chat') ? [{ type: 'text', text: 'Fresh reply.' }] : !tools.length ? [call('read_file', { path: 'song.banger' })] : tools.length === 1 ? [call('edit_file', { path: 'song.banger', search: 'tempo 120;', replacement: 'tempo 101;' })] : [{ type: 'text', text: 'Saved Project A.' }];
  const reason = content[0].type === 'text' ? 'stop' : 'tool-calls';
  return Response.json({ content, finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } }, warnings: [] });
};
const timeout = setTimeout(() => { console.error('Project chats smoke timed out'); app.exit(1); }, 90000);
app.on('before-quit', event => event.preventDefault());
let started = false;
app.on('browser-window-created', (_event, window) => { if (started) return; started = true; window.webContents.once('did-finish-load', () => void run(window)); });
await import('../dist/main.js');
async function run(window) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  async function wait(code) { for (let i = 0; i < 300; i++) { if (await evaluate(`Boolean(${code})`)) return; await delay(25); } throw new Error(`Missing: ${code}\n${await evaluate("document.body.innerText.slice(-1800)")}`); }
  const click = label => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(label)} && item.checkVisibility()); if (!button || button.disabled) throw new Error('Unavailable: ' + ${JSON.stringify(label)}); button.click(); })()`);
  const input = (id, value) => evaluate(`(() => { const field = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  const close = () => evaluate(`document.querySelector('[aria-label="Beat Studio"]')?.click()`);
  const chooseChat = index => evaluate(`document.querySelectorAll('.app-sidebar-chat')[${index}].click()`);
  try {
    await wait("document.querySelector('.producer-start')");
    await click('Open Project');
    await wait("document.querySelector('#producer-source')?.value.includes('tempo 120')");
    await evaluate("window.bangerAI.save('vercel', 'anthropic/claude-opus-5-5', 'fixture-key')");
    await evaluate("window.dispatchEvent(new Event('banger:ai-settings-changed')); document.querySelector('[aria-label=\"Expand sidebar\"]').click()");
    await wait("!document.querySelector('.ai-chat-launcher').disabled && document.querySelectorAll('.app-sidebar-chat').length === 1");
    await chooseChat(0); await input('ai-chat-prompt', 'background A'); await click('Send');
    await wait("document.querySelector('.app-chat-indicator[data-status=running]')");
    await close();
    selected = 'Project B'; await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()"); await click('Open Project');
    await wait("document.querySelectorAll('.app-sidebar-chat').length === 2 && document.querySelector('.producer-project').textContent.includes('Project B')");
    await click('Raw .banger'); await input('producer-source', source + '\n// B draft');
    for (let i = 0; i < 100 && !release; i++) await delay(20);
    assert.ok(release); release();
    await wait("document.querySelector('.app-chat-indicator[data-status=done]')");
    assert.match(await evaluate("document.querySelector('#producer-source').value"), /B draft/);
    assert.match(await readFile(join(directory, 'Project A', 'song.banger'), 'utf8'), /tempo 101/);
    assert.equal(await readFile(join(directory, 'Project B', 'song.banger'), 'utf8'), source);
    await chooseChat(0); await wait("document.querySelector('.ai-chat-answer')?.textContent.includes('Saved Project A')");
    assert.match(await evaluate("document.querySelector('#producer-source').value"), /tempo 101/);
    await evaluate(`document.querySelector('[aria-label="New chat"]').click()`); await wait("document.querySelectorAll('.app-sidebar-chat').length === 3 && !document.querySelector('.ai-chat-answer')");
    await input('ai-chat-prompt', 'fresh chat'); await click('Send');
    await wait("document.querySelector('.ai-chat-answer')?.textContent.includes('Fresh reply')");
    assert.equal(calls.at(-1).prompt.filter(message => message.role === 'user').length, 1);
    await close(); await chooseChat(0); await wait("document.querySelector('.ai-chat-answer')?.textContent.includes('Saved Project A')");
    await close(); await chooseChat(1); await wait("document.querySelector('#producer-source')?.value.includes('B draft')");
    assert.equal(await evaluate("document.querySelectorAll('.ai-chat-answer').length"), 0);
    await close(); await chooseChat(2); await wait("document.querySelector('.ai-chat-answer')?.textContent.includes('Fresh reply')");
    await input('ai-chat-prompt', 'cancel task'); await click('Send'); await wait("document.querySelector('.ai-chat-working')");
    await close(); await chooseChat(1); await wait("document.querySelector('#producer-source').value.includes('B draft')");
    await close(); await chooseChat(2); await wait("document.querySelector('.ai-chat-working')");
    await click('Stop task'); await wait("!document.querySelector('.ai-chat-working')");
    await close();
    assert.equal((await evaluate('window.bangerWorkspace.recent()')).length, 2);
    await delay(350);
    await writeFile(join(tmpdir(), 'banger-project-chats.png'), (await window.webContents.capturePage()).toPNG());
    await evaluate('window.onbeforeunload = null');
    // Reload after clearing dirty prompts; pagehide must persist the B draft.
    window.webContents.on('will-prevent-unload', event => event.preventDefault());
    window.webContents.reload();
    await wait("document.querySelector('.producer-start') && document.querySelector('[aria-label=\"Open project Project B\"]')");
    await evaluate("document.querySelector('[aria-label=\"Open project Project B\"]').click()");
    await wait("document.querySelector('#producer-source')?.value.includes('B draft')");
    assert.equal(await evaluate("document.querySelectorAll('.app-sidebar-chat').length"), 3);
    await chooseChat(0); await wait("document.querySelector('.ai-chat-answer')?.textContent.includes('Saved Project A')");
    assert.match(await evaluate("document.querySelector('#producer-source').value"), /tempo 101/);
    await close();
    await writeFile(join(directory, 'Project A', 'song.banger'), source.replace('120', '103'));
    await delay(350); window.webContents.reload();
    await wait("document.querySelector('.producer-start') && document.querySelectorAll('.app-sidebar-chat').length === 3");
    await chooseChat(0);
    await wait("document.querySelector('#producer-source')?.value.includes('tempo 103')");
    const recent = JSON.parse(await readFile(join(directory, 'profile', 'recent-projects.json'), 'utf8'));
    assert.equal(recent.length, 2);
    assert.ok(recent.every(item => item.id && item.root && item.openedAt));
    console.log('Project chats smoke passed: background completion, project isolation, draft preservation, distinct histories, cancellation after switching, recent projects, and reload persistence. Real IPC/harness, fixture model.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { release?.(); clearTimeout(timeout); for (const window of BrowserWindow.getAllWindows()) window.destroy(); await rm(directory, {recursive:true,force:true,maxRetries:5,retryDelay:100}); app.exit(process.exitCode ?? 0); }
}
