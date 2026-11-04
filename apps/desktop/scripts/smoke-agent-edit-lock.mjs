import { app, BrowserWindow, dialog } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { compileMusic, serializeMusic } from '../../../packages/compiler/dist/index.js';

const directory = await mkdtemp(join(tmpdir(), 'banger-agent-lock-'));
app.setPath('userData', join(directory, 'profile'));
const fixture = compileMusic('tempo 120; track kick { sound "drums/kick"; rhythm "x . x ."; pattern chorus { rhythm "x x x x"; } } track bass { instrument "synth/bass"; notes "C2 . G2 ."; } section intro { bars 1; play kick; play bass; } song { play intro; }');
fixture.tracks[1].pianoRoll = [{ midi: 36, start: 0, duration: 1, velocity: .7 }];
fixture.tracks[1].steps = [];
const source = serializeMusic(fixture);
await writeFile(join(directory, 'a-song.banger'), source);
await writeFile(join(directory, 'b-song.banger'), source);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
let release, finish, mode = 'edit', calls = 0;
globalThis.fetch = async (_url, options) => {
  if (mode === 'error') return Response.json({ error: { message: 'Fixture provider failed' } }, { status: 401 });
  if (mode === 'cancel') await new Promise((resolve, reject) => {
    release = resolve;
    options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const index = calls++;
  const call = (toolName, input) => ({ type: 'tool-call', toolCallId: `call-${index}`, toolName, input: JSON.stringify(input) });
  if (index === 0) await new Promise(resolve => { release = resolve; });
  if (index === 2) await new Promise(resolve => { finish = resolve; });
  const content = index === 0 ? [call('read_file', { path: 'a-song.banger' })]
    : index === 1 ? [call('edit_file', { path: 'a-song.banger', search: 'tempo 120', replacement: 'tempo 90' })]
    : [{ type: 'text', text: 'Saved the new tempo.' }];
  const reason = index < 2 ? 'tool-calls' : 'stop';
  return Response.json({ content, finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } }, warnings: [] });
};
const timeout = setTimeout(() => { console.error('Agent editing lock smoke timed out'); app.exit(1); }, 90000);
app.on('before-quit', event => event.preventDefault());
let started = false;
app.on('browser-window-created', (_event, window) => { if (started) return; started = true; window.webContents.once('did-finish-load', () => void run(window)); });
await import('../dist/main.js');
async function run(window) {
  window.webContents.on('console-message', event => { if (event.message.includes('Uncaught')) console.error(event.message); });
  const evaluate = code => window.webContents.executeJavaScript(code, true).catch(error => { throw new Error(`${code}\n${error.message}`); });
  async function wait(code) { for (let i = 0; i < 400; i++) { if (await evaluate(`Boolean(${code})`)) return; await delay(25); } throw new Error(`Missing: ${code}\n${await evaluate('document.body.innerText.slice(-2000)')}`); }
  const click = selector => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.matches(':disabled')) throw new Error('Unavailable: ' + ${JSON.stringify(selector)}); el.click(); })()`);
  const textClick = label => evaluate(`(() => { const el = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(label)} && item.checkVisibility()); if (!el || el.matches(':disabled')) throw new Error('Unavailable: ' + ${JSON.stringify(label)}); el.click(); })()`);
  const setPrompt = async text => { await wait("document.querySelector('#ai-chat-prompt')"); return evaluate(`(() => { const el = document.querySelector('#ai-chat-prompt'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`); };
  const disabled = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).matches(':disabled')`);
  try {
    await wait("document.querySelector('.producer-start')"); await textClick('Open Project');
    await wait("document.querySelector('#producer-source')?.value.includes('tempo 120')");
    await evaluate("window.bangerAI.save('vercel', 'anthropic/claude-opus-5-5', 'fixture-key')");
    await evaluate("window.dispatchEvent(new Event('banger:ai-settings-changed'))");
    await click('[aria-label="Expand sidebar"]');
    await click('.app-sidebar-chat');
    await setPrompt('Change the tempo to 90'); await textClick('Send');
    await wait("document.querySelector('.ai-chat-working')");
    await click('[aria-label="Beat Studio"]');
    await wait("document.querySelector('.producer-agent-banner')");
    assert.equal(await disabled('#producer-tempo'), true);
    assert.equal(await evaluate("document.querySelector('#producer-source').readOnly"), true);
    await click('.producer-step');
    assert.equal(await evaluate("document.querySelector('#producer-source').value"), source);
    await click('[aria-label="Edit kick"]');
    await wait("document.querySelector('#track-editor-0').checkVisibility()");
    await click('#track-0-tab-sound');
    assert.equal(await disabled('[aria-label="Track 1 name"]'), true);
    assert.equal(await disabled('[aria-label="kick sound"]'), true);
    assert.equal(await disabled('[aria-label="kick gain"]'), true);
    await click('#track-0-tab-routing');
    assert.equal(await evaluate("[...document.querySelectorAll('#track-0-panel-routing input, #track-0-panel-routing select')].every(el => el.matches(':disabled'))"), true);
    await click('#track-0-tab-automation');
    await click('[aria-label="Edit bass piano roll"]');
    assert.equal(await disabled('[aria-label="bass selected note"]'), true);
    await click('#studio-tab-mixer');
    await click('[aria-label="Select bass channel"]');
    assert.equal(await evaluate("document.querySelector('#mixer-channel-title').textContent"), 'bass');
    assert.equal(await disabled('[aria-label="Mixer bass gain"]'), true);
    await click('#studio-tab-song');
    assert.equal(await disabled('[aria-label="Timeline 1 repeats"]'), true);
    await click('[aria-label="Preview intro, timeline 1"]');
    await wait("!document.querySelector('[aria-label=\"Stop playback\"]').disabled");
    await click('[aria-label="Stop playback"]');
    await click('#studio-tab-source');
    await click('#producer-source');
    await evaluate("document.querySelector('#producer-source').focus()");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'X' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'X' });
    await delay(60);
    assert.equal(await evaluate("document.querySelector('#producer-source').value"), source);
    // A different chat bound to the same song must stay locked and refresh too.
    await click('[aria-label="New chat"]');
    await click('[aria-label="Beat Studio"]');
    await wait("document.querySelector('.producer-agent-banner')");
    await click('#studio-tab-sequencer');
    await click('[aria-label="Edit kick"]');
    await click('.producer-play');
    await wait("!document.querySelector('[aria-label=\"Stop playback\"]').disabled");
    for (let i = 0; i < 200 && !release; i++) await delay(25);
    assert.ok(release); release(); release = null;
    await wait("document.querySelector('#producer-source').value.includes('tempo 90')");
    assert.equal(await disabled('#producer-tempo'), true, 'still running after intermediate save');
    assert.equal(await disabled('[aria-label="Stop playback"]'), false, 'live edit keeps playback running');
    assert.equal(await evaluate("document.querySelector('#track-editor-0').checkVisibility()"), true, 'inspection stays open');
    assert.match(await readFile(join(directory, 'a-song.banger'), 'utf8'), /tempo 90/);
    assert.equal(await readFile(join(directory, 'b-song.banger'), 'utf8'), source);
    await writeFile(join(tmpdir(), 'banger-agent-edit-lock.png'), (await window.webContents.capturePage()).toPNG());
    for (let i = 0; i < 200 && !finish; i++) await delay(25);
    assert.ok(finish); finish(); finish = null;
    await wait("!document.querySelector('.producer-agent-banner')");
    assert.equal(await disabled('#producer-tempo'), false);
    assert.equal(await disabled('[aria-label="Stop playback"]'), false, 'completion keeps playback running');
    // Failure and cancellation also release the song.
    await click('.app-sidebar-chat');
    mode = 'cancel'; await setPrompt('Wait until cancelled'); await textClick('Send');
    await wait("document.querySelector('.ai-chat-working')");
    await click('[aria-label="Stop task"]');
    await wait("!document.querySelector('.ai-chat-working')");
    await click('[aria-label="Beat Studio"]');
    assert.equal(await disabled('#producer-tempo'), false);
    await click('.app-sidebar-chat');
    mode = 'error'; await setPrompt('Fail this request'); await textClick('Send');
    await wait("document.querySelector('.ai-chat-footer [role=alert]')");
    await wait("!document.querySelector('.ai-chat-working')");
    await click('[aria-label="Beat Studio"]');
    assert.equal(await disabled('#producer-tempo'), false);
    console.log('Agent editing lock smoke passed: editing blocked, browsing/playback available, live saved edits across chats, playback continuity, success/cancel/error unlock. Real IPC and project agent with fixture provider.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { release?.(); finish?.(); clearTimeout(timeout); for (const window of BrowserWindow.getAllWindows()) window.destroy(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); app.exit(process.exitCode ?? 0); }
}
