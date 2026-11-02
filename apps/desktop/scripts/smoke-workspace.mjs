import { app, BrowserWindow, dialog } from "electron";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const directory = await mkdtemp(join(tmpdir(), "banger-workspace-smoke-"));
app.setPath("userData", directory);
const source = 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain 0.5; }';
await writeFile(join(directory, "verse.banger"), source);
await writeFile(join(directory, "chorus.banger"), source);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
const calls = [];
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), "https://ai-gateway.vercel.sh/v4/ai/language-model");
  const body = JSON.parse(options.body); calls.push(body);
  const messages = body.prompt;
  const index = messages.findLastIndex(message => message.role === "user");
  const current = messages.slice(index);
  const user = JSON.stringify(current[0]);
  if (user.includes("slow task")) await new Promise((_resolve, reject) => {
    if (options.signal.aborted) reject(options.signal.reason);
    else options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  });
  const tools = current.filter(message => message.role === "tool");
  const call = (name, input) => ({ type: "tool-call", toolCallId: `${name}-${calls.length}`, toolName: name, input: JSON.stringify(input) });
  let content;
  if (user.includes("softer again")) content = tools.length ? [{ type: "text", text: "Revised chorus again." }] : [call("edit_file", { path: "chorus.banger", search: "gain 0.4;", replacement: "gain 0.2;" })];
  else if (!tools.length) content = [call("read_file", { path: "verse.banger" })];
  else if (tools.length === 1) content = [call("edit_file", { path: "verse.banger", search: "tempo 120;", replacement: "tempo 110;" }), call("edit_file", { path: "chorus.banger", search: "gain 0.5;", replacement: "gain 0.4;" })];
  else content = [{ type: "text", text: "Updated verse and chorus." }];
  const reason = content[0].type === "text" ? "stop" : "tool-calls";
  return Response.json({ content, finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } }, warnings: [] });
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
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function wait(script) {
    for (let count = 0; count < 250; count++) { if (await evaluate(`Boolean(${script})`)) return; await delay(30); }
    throw new Error(`Missing UI state: ${script}; ${await evaluate("document.querySelector('.project-workspace')?.textContent")}`);
  }
  const click = async label => {
    await wait(`[...document.querySelectorAll('.project-workspace button')].some(button => button.textContent === ${JSON.stringify(label)} && !button.disabled)`);
    return evaluate(`(() => { const button = [...document.querySelectorAll('.project-workspace button')].find(b => b.textContent === ${JSON.stringify(label)}); if (!button || button.disabled) throw new Error('Missing enabled button'); button.click(); })()`);
  };
  const input = (id, text) => evaluate(`(() => { const field = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)}); field.dispatchEvent(new Event('input', { bubbles:true })); })()`);
  try {
    await wait("window.bangerWorkspace && document.querySelector('.project-workspace')");
    await evaluate("window.bangerAI.save('vercel', 'anthropic/test-model', 'fake-project-key')");
    await click("Open project folder");
    await wait("document.querySelector('#workspace-source')?.value.includes('tempo 120')");
    assert.equal(await evaluate("document.querySelector('#workspace-file').value"), "chorus.banger");
    await input("workspace-source", source + "\n// unsaved");
    await input("workspace-prompt", "Change both files");
    assert.equal(await evaluate("[...document.querySelectorAll('.project-workspace button')].find(b=>b.textContent==='Run project task').disabled"), true);
    await evaluate("void (window.confirm = () => false)");
    await click("Reload files");
    assert.match(await evaluate("document.querySelector('#workspace-source').value"), /unsaved/);
    await click("Save project file");
    await wait("document.querySelector('.project-workspace-notice')?.textContent.includes('Saved chorus')");
    // An external edit rejects stale manual saves instead of losing the external content.
    await writeFile(join(directory, "chorus.banger"), source);
    await input("workspace-source", source + "\n// conflicting draft");
    await click("Save project file");
    await wait("document.querySelector('.project-workspace-notice')?.textContent.includes('changed')");
    assert.equal(await readFile(join(directory, "chorus.banger"), "utf8"), source);
    await evaluate("void (window.confirm = () => true)");
    await click("Reload files");
    await wait("document.querySelector('#workspace-source').value === " + JSON.stringify(source));
    await click("Run project task");
    await wait("document.querySelector('.project-workspace-notice')?.textContent.includes('Updated verse and chorus')");
    assert.match(await readFile(join(directory, "verse.banger"), "utf8"), /tempo 110/);
    assert.match(await readFile(join(directory, "chorus.banger"), "utf8"), /gain 0.4/);
    assert.match(await evaluate("document.querySelector('#workspace-source').value"), /gain 0.4/);
    assert.ok(await evaluate("document.querySelector('.project-workspace-events').textContent.includes('Saved verse.banger')"));
    await input("workspace-prompt", "Make it softer again");
    await click("Run project task");
    await wait("document.querySelector('.project-workspace-notice')?.textContent.includes('Revised chorus again')");
    assert.match(await readFile(join(directory, "chorus.banger"), "utf8"), /gain 0.2/);
    assert.ok(calls.at(-1).prompt.filter(message => message.role === "user").length >= 2);
    await input("workspace-prompt", "slow task");
    await click("Run project task");
    await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Stop project task')");
    await delay(100);
    assert.equal(await evaluate("document.querySelector('#workspace-source').disabled"), true);
    await click("Stop project task");
    await wait("document.querySelector('.project-workspace-notice')?.textContent.includes('stopped')");
    // Renderer receives relative names, and traversal is rejected by the real IPC handler.
    await assert.rejects(evaluate("window.bangerWorkspace.read('../secret.banger')"));
    assert.deepEqual(await evaluate("window.bangerWorkspace.list()"), ["chorus.banger", "verse.banger"]);
    await evaluate("(() => { const select = document.querySelector('#workspace-file'); select.value = 'verse.banger'; select.dispatchEvent(new Event('change', { bubbles:true })); })()");
    await wait("document.querySelector('#workspace-source').value.includes('tempo 110')");
    await click("Reload files");
    await wait("document.querySelector('#workspace-file').value === 'verse.banger' && !document.querySelector('#workspace-source').disabled");
    await evaluate("document.querySelector('.project-workspace').scrollIntoView({ block:'start' })");
    await delay(100);
    await writeFile(join(tmpdir(), "banger-workspace-desktop.png"), (await window.webContents.capturePage()).toPNG());
    console.log("Workspace Electron smoke passed: native folder open, manual edits, dirty draft protection, external save conflict, cross-file harness edits, repeated same-file edit, continued history, real events, cancellation, and path confinement. Model network responses mocked; real harness and IPC used.");
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timeout); for (const window of BrowserWindow.getAllWindows()) window.destroy(); await rm(directory, { recursive: true, force: true }); app.exit(process.exitCode ?? 0); }
}
