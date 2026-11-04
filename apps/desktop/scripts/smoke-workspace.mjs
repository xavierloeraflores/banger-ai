import { gatewayFixtureResponse } from "./chat-fixture.mjs";
import { enterStudio, smokeStartup } from "./smoke-startup.mjs";
import { songStorage } from "@banger/harness";
import { app, BrowserWindow, dialog } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const chatOnly = process.argv.includes("--chat-only");
const directory = await mkdtemp(join(tmpdir(), "banger-workspace-smoke-"));
app.setPath("userData", directory);
const source = 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain 0.5; }';
await writeFile(join(directory, "verse.banger"), source);
await writeFile(join(directory, "chorus.banger"), source);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
await songStorage.saveLyrics({ root: directory, name: "chorus" }, { plan: { chunks: [{ text: "Original lyric" }] } });
const calls = [];
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), "https://ai-gateway.vercel.sh/v4/ai/language-model");
  const body = JSON.parse(options.body); calls.push(body);
  if (calls.length === 1) assert.equal(await readFile(join(directory, "chorus.banger"), "utf8"), source + "\n// unsaved");
  const messages = body.prompt;
  const index = messages.findLastIndex(message => message.role === "user");
  const current = messages.slice(index);
  const user = JSON.stringify(current[0]);
  const tools = current.filter(message => message.role === "tool");
  if (user.includes("slow task") && tools.length) await new Promise((_resolve, reject) => {
    if (options.signal.aborted) reject(options.signal.reason);
    else options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  });
  const call = (name, input) => ({ type: "tool-call", toolCallId: `${name}-${calls.length}`, toolName: name, input: JSON.stringify(input) });
  let content;
  if (user.includes("revise saved lyrics")) content = !tools.length
    ? [call("read_lyrics", { path: "chorus.lyric.json" })]
    : tools.length === 1 ? [call("edit_lyrics", { path: "chorus.lyric.json", search: "Original lyric", replacement: "Revised lyric" })]
    : [{ type: "text", text: "Saved the lyrics revision." }];
  else if (user.includes("slow task")) content = [call("edit_file", { path: "chorus.banger", search: "gain 0.2;", replacement: "gain 0.1;" })];
  else if (user.includes("fresh task")) content = [{ type: "text", text: "Fresh conversation." }];
  else if (user.includes("softer again")) content = tools.length ? [{ type: "text", text: "Revised chorus again." }] : [call("edit_file", { path: "chorus.banger", search: "gain 0.4;", replacement: "gain 0.2;" })];
  else if (!tools.length) content = [call("read_file", { path: "verse.banger" })];
  else if (tools.length === 1) content = [call("edit_file", { path: "verse.banger", search: "tempo 120;", replacement: "tempo 110;" }), call("edit_file", { path: "chorus.banger", search: "gain 0.5;", replacement: "gain 0.4;" })];
  else content = [{ type: "text", text: "Updated verse and chorus." }];
  const reason = content[0].type === "text" ? "stop" : "tool-calls";
  return gatewayFixtureResponse({ content, finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } }, warnings: [] }, options);
};
const timeout = setTimeout(() => { console.error("Workspace smoke timed out."); app.exit(1); }, 60000);
app.on("before-quit", event => event.preventDefault());
let started = false;
app.on("browser-window-created", (_event, window) => {
  if (started) return; started = true;
  window.webContents.once("did-finish-load", () => { void run(window); });
});
await import("../dist/main.js");
async function run(window) {
  const startupDirectory = join(directory, "startup-checks");
  await mkdir(startupDirectory);
  if (!chatOnly) await smokeStartup(window, startupDirectory);
  await rm(startupDirectory, { recursive: true, force: true });
  await enterStudio(window);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  const evaluate = script => window.webContents.executeJavaScript(script, true).catch(error => { throw new Error(`${error.message} Script: ${script}`); });
  async function wait(script) {
    for (let count = 0; count < 250; count++) { if (await evaluate(`Boolean(${script})`)) return; await delay(30); }
    throw new Error(`Missing UI state: ${script}; ${await evaluate("document.querySelector('.project-workspace')?.textContent")}`);
  }
  const click = async label => {
    await wait(`[...document.querySelectorAll('button')].some(button => button.textContent === ${JSON.stringify(label)} && !button.disabled)`);
    return evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)}); if (!button || button.disabled) throw new Error('Missing enabled button'); if (button.getAttribute('aria-haspopup') === 'menu') button.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true})); else button.click(); })()`);
  };
  const input = (id, text) => evaluate(`(() => { const field = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)}); field.dispatchEvent(new Event('input', { bubbles:true })); })()`);
  try {
    await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");
    await wait("window.bangerWorkspace && document.querySelector('#project-controls')");
    await evaluate("window.bangerAI.save('vercel', 'anthropic/claude-opus-5-5', 'fake-project-key')");
    await evaluate("window.dispatchEvent(new Event('banger:ai-settings-changed'))");
    await wait("(document.querySelector('#project-controls')?.getAttribute('data-state') === 'open')");
    await click("Open Project");
    assert.equal(await evaluate("Boolean(document.querySelector('#workspace-source, #workspace-prompt, .project-song-advanced'))"), false);
    await wait("document.querySelector('#producer-source')?.value.includes('tempo 120')");
    await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");
    await wait("document.querySelector('.app-sidebar-song')");
    assert.equal(await evaluate("document.querySelector('.app-sidebar-song[aria-current]').dataset.songPath"), "chorus.banger");
    await evaluate("document.querySelector('#project-controls [aria-label=\"Close project controls\"]')?.click()");
    await click("Raw .banger");
    await input("producer-source", source + "\n// unsaved");
    const openChat = () => evaluate(`(document.querySelector('.app-sidebar-chat[aria-current="page"]') || [...document.querySelectorAll('.app-sidebar-chat')].at(-1)).click()`);
    const closeChat = () => evaluate("document.querySelector('[aria-label=\"Beat Studio\"]').click()");
    await openChat();
    await input("ai-chat-prompt", "fresh task");
    assert.equal(await evaluate("Boolean(document.querySelector('[aria-label=\"Chat scope\"]'))"), false);
    assert.equal(await evaluate("[...document.querySelectorAll('.ai-chat-compose button')].find(b=>b.textContent==='Send').disabled"), false);
    // Enter and Send both ask how to handle edits before any provider request.
    await evaluate("document.querySelector('#ai-chat-prompt').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))");
    await wait("(document.querySelector('.ai-chat-edits-dialog')?.getAttribute('data-state') === 'open' && document.querySelector('.ai-chat-edits-dialog')?.getAttribute('aria-modal') === 'true')");
    assert.equal(calls.length, 0);
    await evaluate("[...document.querySelectorAll('.ai-chat-edits-dialog button')].find(b => b.textContent === 'Cancel').click()");
    await wait("!(document.querySelector('.ai-chat-edits-dialog')?.getAttribute('data-state') === 'open')");
    assert.equal(await evaluate("document.querySelector('#ai-chat-prompt').value"), "fresh task");
    assert.match(await evaluate("document.querySelector('#producer-source').value"), /unsaved/);
    assert.equal(calls.length, 0);
    await click("Send");
    await wait("(document.querySelector('.ai-chat-edits-dialog')?.getAttribute('data-state') === 'open' && document.querySelector('.ai-chat-edits-dialog')?.getAttribute('aria-modal') === 'true')");
    window.setMinimumSize(0, 0); window.setContentSize(390, 700);
    await delay(100);
    assert.equal(await evaluate("(() => { const b = document.querySelector('.ai-chat-edits-dialog').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; })()"), true);
    await writeFile(join(tmpdir(), "banger-ai-unsaved-mobile.png"), (await window.webContents.capturePage()).toPNG());
    window.setContentSize(1440, 1000);
    await evaluate("(() => { const button = [...document.querySelectorAll('.ai-chat-edits-dialog button')].find(b => b.textContent === 'Save and start'); button.click(); button.click(); })()");
    await wait("document.querySelector('.ai-chat-transcript')?.textContent.includes('Fresh conversation')");
    await wait("!document.querySelector('.ai-chat-working')");
    assert.equal(calls.length, 1);
    assert.equal(await readFile(join(directory, "chorus.banger"), "utf8"), source + "\n// unsaved");
    assert.equal(await evaluate("[...document.querySelectorAll('.producer-file-actions button')].find(b => b.textContent === 'Save').disabled"), true);
    // External edits reject a stale save and leave both versions intact.
    await closeChat();
    await writeFile(join(directory, "chorus.banger"), source);
    await input("producer-source", source + "\n// conflicting draft");
    await openChat();
    await wait("!document.querySelector('#chat-ai-reasoning').disabled");
    await evaluate("document.querySelector('#chat-ai-reasoning').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}))");
    await wait("document.querySelector('[role=menu]')");
    await evaluate("[...document.querySelectorAll('[role=menuitemradio]')].find(item => item.textContent.trim() === 'High').click()");
    await wait("!document.querySelector('#chat-ai-reasoning').disabled && document.querySelector('#chat-ai-reasoning').textContent.includes('High')");
    await input("ai-chat-prompt", "Change both files");
    await click("Send");
    await wait("(document.querySelector('.ai-chat-edits-dialog')?.getAttribute('data-state') === 'open')");
    await click("Save and start");
    await wait("document.querySelector('.ai-chat-edits-dialog [role=alert]')?.textContent.includes('changed')");
    assert.equal(calls.length, 1);
    assert.equal(await readFile(join(directory, "chorus.banger"), "utf8"), source);
    assert.match(await evaluate("document.querySelector('#producer-source').value"), /conflicting draft/);
    // Discard reloads the saved song before starting, including its new revision.
    await click("Discard and start");
    await wait("document.querySelector('.ai-chat-transcript')?.textContent.includes('Updated verse and chorus')");
    await wait("!document.querySelector('.ai-chat-working')");
    assert.match(await readFile(join(directory, "verse.banger"), "utf8"), /tempo 110/);
    assert.match(await readFile(join(directory, "chorus.banger"), "utf8"), /gain 0.4/);
    assert.match(await evaluate("document.querySelector('#producer-source').value"), /gain 0.4/);
    assert.ok(await evaluate("[...document.querySelectorAll('.ai-chat-activity')].some(panel => panel.textContent.includes('Saved verse.banger'))"));
    // An unchanged song starts immediately without another dialog.
    assert.equal(await evaluate("(document.querySelector('.ai-chat-edits-dialog')?.getAttribute('data-state') === 'open')"), false);
    assert.equal(await evaluate("Boolean(document.querySelector('[aria-label=\"File to edit\"]'))"), false);
    assert.equal(calls.at(-1).providerOptions?.anthropic?.effort, "high");
    await evaluate("document.querySelector('#chat-ai-reasoning').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}))");
    await wait("document.querySelector('[role=menu]')");
    await evaluate("[...document.querySelectorAll('[role=menuitemradio]')].find(item => item.textContent.trim() === 'Provider default').click()");
    await wait("!document.querySelector('#chat-ai-reasoning').disabled && document.querySelector('#chat-ai-reasoning').textContent.includes('Default')");
    await input("ai-chat-prompt", "Make it softer again");
    await click("Send");
    await wait("document.querySelector('.ai-chat-transcript')?.textContent.includes('Revised chorus again')");
    await wait("!document.querySelector('.ai-chat-working')");
    assert.match(await readFile(join(directory, "chorus.banger"), "utf8"), /gain 0.2/);
    assert.equal(calls.at(-1).providerOptions?.anthropic?.effort, undefined);
    assert.ok(calls.at(-1).prompt.filter(message => message.role === "user").length >= 2);
    await writeFile(join(tmpdir(), "banger-unified-chat.png"), (await window.webContents.capturePage()).toPNG());
    window.setMinimumSize(0, 0); window.setContentSize(390, 700);
    await delay(100);
    assert.equal(await evaluate("(() => { const b = document.querySelector('#ai-chat-view').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; })()"), true);
    await writeFile(join(tmpdir(), "banger-unified-chat-mobile.png"), (await window.webContents.capturePage()).toPNG());
    window.setContentSize(1440, 1000);
    await input("ai-chat-prompt", "slow task");
    await click("Send");
    await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Stop task')");
    await wait("document.querySelector('.ai-chat-working')?.textContent.includes('Saved chorus.banger')");
    await closeChat();
    await wait("document.querySelector('#producer-source').readOnly");
    const agentSource = await evaluate("document.querySelector('#producer-source').value");
    await input("producer-source", source + "\n// newer studio draft");
    assert.equal(await evaluate("document.querySelector('#producer-source').value"), agentSource, 'Agent editing blocks studio writes');
    await openChat();
    assert.equal(await evaluate("Boolean(document.querySelector('.ai-chat-working'))"), true);
    await click("Stop task");
    await wait("document.querySelector('.ai-chat-transcript')?.textContent.includes('stopped')");
    await wait("!document.querySelector('.ai-chat-working')");
    assert.match(await evaluate("document.querySelector('#producer-source').value"), /gain 0.1/);
    assert.equal(await evaluate("document.querySelector('#producer-source').readOnly"), false);
    assert.match(await readFile(join(directory, "chorus.banger"), "utf8"), /gain 0.1/);
    await closeChat();
    await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");
    await evaluate("void (window.confirm = () => true)");
    await evaluate("document.querySelector('[aria-label=\"Close project controls\"]')?.click()");
    await evaluate("[...document.querySelectorAll('.app-sidebar-song')].find(button => button.dataset.songPath === 'chorus.banger').click()");
    await wait("!document.querySelector('#producer-source').value.includes('newer studio draft')");
    await evaluate("document.querySelector('#project-controls [aria-label=\"Close project controls\"]')?.click()");
    await openChat();
    await evaluate(`document.querySelector('[aria-label="New chat"]').click()`);
    await input("ai-chat-prompt", "fresh task");
    await click("Send");
    await wait("document.querySelector('.ai-chat-transcript')?.textContent.includes('Fresh conversation')");
    await wait("!document.querySelector('.ai-chat-working')");
    assert.equal(calls.at(-1).prompt.filter(message => message.role === "user").length, 1);
    await closeChat();
    await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");
    await evaluate("document.querySelector('#project-controls [aria-label=\"Close project controls\"]')?.click()");
    await evaluate(`(() => { document.querySelector('[aria-label="Vocal Studio"]').click(); })()`);
    assert.equal(await evaluate("document.querySelector('.ai-chat-launcher').checkVisibility()"), true);
    await openChat();
    assert.ok(await evaluate("document.querySelector('.ai-chat-transcript').textContent.includes('Fresh conversation')"));
    await closeChat();
    await evaluate(`(() => { document.querySelector('[aria-label="Beat Studio"]').click(); })()`);
    await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");
    if (chatOnly) {
      console.log("AI chat smoke passed: automatic harness, save/discard/cancel, duplicate-send guard, save conflict, editor refresh, clean send, mobile bounds, conversation history, and cancellation. Real harness and IPC; mocked model responses.");
      return;
    }
    // Renderer receives relative names, and traversal is rejected by the real IPC handler.
    await assert.rejects(evaluate("window.bangerWorkspace.read('../secret.banger')"));
    assert.ok((await evaluate("window.bangerWorkspace.list()")).includes("verse.banger"));
    await evaluate("document.querySelector('[aria-label=\"Close project controls\"]')?.click()");
    await evaluate("[...document.querySelectorAll('.app-sidebar-song')].find(button => button.dataset.songPath === 'verse.banger').click()");
    await wait("document.querySelector('#producer-source').value.includes('tempo 110')");
    await wait("document.querySelector('.app-sidebar-song[aria-current]').dataset.songPath === 'verse.banger' && !document.querySelector('#producer-source').disabled");
    // Export twice through the header modal and verify both archived WAVs.
    await evaluate("document.querySelector('#project-controls [aria-label=\"Close project controls\"]')?.click()");
    window.webContents.session.on('will-download', event => event.preventDefault());
    await click("Export");
    await wait("document.querySelector('.studio-export-dialog')?.getAttribute('data-state') === 'open'");
    for (let version = 1; version <= 2; version++) {
      await click("Export and download");
      await wait("document.querySelector('.studio-export-status')?.textContent.includes('Exported stereo WAV')");
      const saved = await readFile(join(directory, `.banger/history/verse/instrumentals/verse.instrumental-v00${version}.wav`));
      assert.equal(saved.toString('ascii', 0, 4), 'RIFF');
    }
    await evaluate("document.querySelector('[aria-label=\"Close export options\"]').click()");
    assert.equal((await readdir(join(directory, '.banger/history/verse/instrumentals'))).length, 2);
    const readOnlyResult = await evaluate('window.bangerWorkspace.run("revise saved lyrics", "verse.banger", true, { beat: false, lyrics: false })');
    assert.equal(readOnlyResult.ok, true);
    assert.deepEqual(readOnlyResult.reply.changedPaths, []);
    assert.equal(JSON.parse(await readFile(join(directory, "chorus.lyric.json"))).plan.chunks[0].text, "Original lyric");
    assert.equal(calls.at(-1).tools.some(tool => /^(write|edit)_/.test(tool.name)), false);
    const lyricResult = await evaluate('window.bangerWorkspace.run("revise saved lyrics", "verse.banger", true, { beat: true, lyrics: true })');
    assert.equal(lyricResult.ok, true);
    assert.equal(lyricResult.reply.status, "completed");
    assert.deepEqual(lyricResult.reply.changedPaths, ["chorus.lyric.json"]);
    assert.equal(JSON.parse(await readFile(join(directory, "chorus.lyric.json"))).plan.chunks[0].text, "Revised lyric");
    assert.equal(JSON.parse(await readFile(join(directory, ".banger/history/chorus/lyrics/lyrics-v001.json"))).plan.chunks[0].text, "Original lyric");
    assert.equal(JSON.parse(await readFile(join(directory, ".banger/history/chorus/lyrics/lyrics-v002.json"))).plan.chunks[0].text, "Revised lyric");
    assert.equal(await evaluate("[...document.querySelectorAll('.app-sidebar-song')].some(button => button.dataset.songPath.endsWith('.json'))"), false);
    await evaluate("document.querySelector('.app-sidebar-songs').scrollIntoView({ block:'start' })");
    await delay(100);
    await writeFile(join(tmpdir(), "banger-workspace-desktop.png"), (await window.webContents.capturePage()).toPNG());
    console.log("Workspace Electron smoke passed: dedicated chat view, automatic harness, save/discard/cancel decisions, mobile bounds, new conversation reset, native folder open, manual edits, dirty draft protection, external save conflict, cross-file harness edits, repeated same-file edit, continued history, real events, cancellation, and path confinement. Model network responses mocked; real harness and IPC used.");
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timeout); for (const window of BrowserWindow.getAllWindows()) window.destroy(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); app.exit(process.exitCode ?? 0); }
}
