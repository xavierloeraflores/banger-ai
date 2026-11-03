import { enterStudio } from "./smoke-startup.mjs";
import { app, BrowserWindow, dialog } from "electron";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { serveApp } from "../dist/static-app.js";
import { chatFixture } from "./chat-fixture.mjs";

const directory = await mkdtemp(join(tmpdir(), "banger-chat-smoke-"));
app.setPath("userData", directory);
const timeout = setTimeout(() => { console.error("Chat smoke timed out."); app.exit(1); }, 55_000);
app.on("before-quit", event => event.preventDefault());
const calls = [];
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), "https://ai-gateway.vercel.sh/v4/ai/language-model");
  assert.equal(new Headers(options.headers).get("authorization"), "Bearer fake-chat-key");
  const body = JSON.parse(options.body);
  assert.equal(options.body.includes("fake-chat-key"), false);
  calls.push(body);
  if (options.body.includes("slow request")) {
    await new Promise((resolve, reject) => {
      if (options.signal.aborted) reject(options.signal.reason);
      else options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    });
  }
  return Response.json(chatFixture(body));
};
const server = createServer(async (request, response) => {
  const result = await serveApp(new Request(`banger://app${request.url}`), fileURLToPath(new URL("../dist/web/", import.meta.url)));
  response.writeHead(result.status, { "Content-Type": result.headers.get("Content-Type") });
  response.end(new Uint8Array(await result.arrayBuffer()));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let started = false;
app.on("browser-window-created", (_event, window) => {
  if (started) return;
  started = true;
  window.webContents.once("did-finish-load", () => { void run(window); });
});
await import("../dist/main.js");

async function exercise(window, desktop) {
  await enterStudio(window);
  const evaluate = script => window.webContents.executeJavaScript(script, true).catch(error => { throw new Error(`${error.message} Script: ${script}`); });
  async function waitFor(script) {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await evaluate(`Boolean(${script})`)) return;
      await delay(25);
    }
    throw new Error(`UI state did not arrive: ${script}. ${await evaluate("document.querySelector('.ai-chat-footer')?.textContent")}`);
  }
  const click = text => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) throw new Error('Unavailable button: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  const input = (id, value) => evaluate(`(() => {
    const input = document.getElementById(${JSON.stringify(id)});
    Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('#producer-source')?.value");
  const openChat = async () => {
    await evaluate("document.querySelector('[aria-label=\"Open AI chat\"]').click()");
    await waitFor("document.querySelector('#ai-chat-dialog').matches(':modal')");
  };
  const closeChat = async () => {
    await evaluate("document.querySelector('[aria-label=\"Close AI chat\"]').click()");
    await waitFor("!document.querySelector('#ai-chat-dialog').open");
  };
  assert.equal(await evaluate("document.querySelector('#ai-chat-dialog').open"), false);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.ai-chat-launcher-hint')).position"), "fixed");
  assert.equal(await evaluate("document.querySelector('.ai-chat-launcher').disabled"),true);
  await evaluate("document.querySelector('.ai-chat-launcher').click()");
  assert.equal(await evaluate("document.querySelector('#ai-chat-dialog').open"),false);
  await evaluate("document.querySelector('[aria-label=Settings]').click()");
  await waitFor("!document.querySelector('.byok-form fieldset').disabled");
  await input("byok-model", "anthropic/test-model");
  await input("byok-key", "fake-chat-key");
  await click("Save and select");
  await waitFor("document.querySelector('.byok-feedback [role=status]')");
  await evaluate(`document.querySelector('[aria-label="Close settings"]').click()`);
  await waitFor("!document.querySelector('.ai-chat-launcher').disabled");
  await openChat();
  await waitFor("document.activeElement.id === 'ai-chat-prompt'");
  await input("ai-chat-prompt", "Keep this draft");
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitFor("!document.querySelector('#ai-chat-dialog').open");
  await waitFor("document.activeElement.getAttribute('aria-label') === 'Open AI chat'");
  await openChat();
  assert.equal(await evaluate("document.querySelector('#ai-chat-prompt').value"), "Keep this draft");
  // Native modal focus cannot escape into the studio controls.
  for (let index = 0; index < 12; index++) {
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    await delay(10);
    assert.equal(await evaluate("document.activeElement === document.body || document.querySelector('#ai-chat-dialog').contains(document.activeElement)"), true);
  }
  if (!desktop) {
    await evaluate(`(() => {
      const fixture = ${chatFixture.toString()};
      window.__chatCalls = [];
      window.__downloads = [];
      const originalCreateURL = URL.createObjectURL;
      URL.createObjectURL = function(blob) { window.__downloads.push(blob); return originalCreateURL.call(this, blob); };
      const originalFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (!String(url).startsWith('https://ai-gateway.vercel.sh/')) return originalFetch(url, options);
        if (new Headers(options.headers).get('authorization') !== 'Bearer fake-chat-key') throw new Error('Wrong key');
        if (options.body.includes('fake-chat-key')) throw new Error('Key in prompt');
        const body = JSON.parse(options.body);
        window.__chatCalls.push(body);
        if (options.body.includes('slow request')) {
          await new Promise((resolve, reject) => {
            if (options.signal.aborted) reject(options.signal.reason);
            else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
          });
        }
        return Response.json(fixture(body));
      };
    })()`);
  }
  if (desktop) await evaluate("(() => { const s = document.querySelector('[aria-label=\"Chat scope\"]'); s.value = 'studio'; s.dispatchEvent(new Event('change', {bubbles:true})); })()");
  await input("ai-chat-prompt", "Create two loops");
  await waitFor("document.querySelector('.ai-chat-heading-actions .producer-tag').textContent === 'Vercel AI Gateway · anthropic/test-model'");
  const originalSource = await evaluate("document.querySelector('#producer-source').value");
  await click("Send");
  await waitFor("document.querySelectorAll('.ai-chat-file').length === 2");
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), originalSource);
  await evaluate("document.querySelector('.ai-chat-file details').open = true");
  assert.ok((await evaluate("document.querySelector('.ai-chat-file pre').textContent")).includes("agent_kick"));
  // Save a generated file without replacing the user's current project.
  if (desktop) dialog.showSaveDialog = async () => ({ canceled: false, filePath: join(directory, "warm-loop.banger") });
  else window.webContents.session.on("will-download", event => event.preventDefault());
  await click("Save file");
  await waitFor("document.querySelector('.ai-chat-footer [role=status]')?.textContent === 'Saved warm-loop.banger.'");
  const saved = desktop ? await readFile(join(directory, "warm-loop.banger"), "utf8") : await evaluate("window.__downloads[0].text()");
  assert.ok(saved.includes("agent_kick"));
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), originalSource);
  // Edits made after generation require an explicit decision before loading.
  const newer = `${originalSource}\n// newer manual edit\n`;
  await closeChat();
  await click("Raw .banger");
  await input("producer-source", newer);
  await openChat();
  await evaluate("void (window.confirm = () => false)");
  await click("Load in studio");
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), newer);
  await evaluate("void (window.confirm = () => true)");
  await click("Load in studio");
  await waitFor("document.querySelector('#producer-tempo').value === '105'");
  assert.ok((await evaluate("document.querySelector('.producer-project').textContent")).includes("warm-loop.banger"));
  assert.equal(await evaluate("document.querySelector('.project-file-identity p').textContent"), "Unsaved changes");
  await evaluate("document.querySelectorAll('.ai-chat-file button')[3].click()");
  await waitFor("document.querySelector('#producer-tempo').value === '85'");
  await input("ai-chat-prompt", "Make the second loop softer");
  await click("Send");
  await waitFor("document.querySelectorAll('.ai-chat-file').length === 3");
  assert.equal(await evaluate("document.querySelectorAll('.ai-chat-file strong')[2].textContent"), "slow-loop.banger");
  assert.match(await evaluate("document.querySelectorAll('.ai-chat-file pre')[2].textContent"), /gain 0.25;/);
  assert.equal(await evaluate("document.querySelectorAll('.ai-chat-file-heading span')[2].textContent"), "Revision compiled");
  // Choosing an old card edits its latest proposal, even when it shares the editor name.
  await evaluate("document.querySelectorAll('.ai-chat-file button')[4].click()");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"File to edit\"]').value"), "slow-loop.banger");
  await input("ai-chat-prompt", "Slow the selected loop again");
  await click("Send");
  await waitFor("document.querySelectorAll('.ai-chat-file').length === 4");
  const secondRevision = await evaluate("document.querySelectorAll('.ai-chat-file pre')[3].textContent");
  assert.match(secondRevision, /tempo 75;/);
  assert.match(secondRevision, /gain 0.25;/);
  assert.equal(await evaluate("document.querySelector('[aria-label=\"File to edit\"]').value"), "slow-loop.banger");
  // Load the revision, then explicitly target the editor to preserve manual source changes.
  await evaluate("document.querySelectorAll('.ai-chat-file button')[9].click()");
  await closeChat();
  await input("producer-source", `${secondRevision}\n// preserve my manual arrangement\n`);
  await openChat();
  await evaluate(`(() => {
    const select = document.querySelector('[aria-label="File to edit"]');
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await input("ai-chat-prompt", "Keep my manual edit and soften the editor");
  await click("Send");
  await waitFor("document.querySelectorAll('.ai-chat-file').length === 5");
  const editorRevision = await evaluate("document.querySelectorAll('.ai-chat-file pre')[4].textContent");
  assert.equal(editorRevision, `${secondRevision}\n// preserve my manual arrangement\n`.replace('gain 0.25;', 'gain 0.15;'));
  const recorded = desktop ? calls : await evaluate("window.__chatCalls");
  assert.ok(JSON.stringify(recorded.at(-2).prompt).includes("slow-loop.banger"));
  assert.ok(JSON.stringify(recorded.at(-2).prompt).includes("Keep my manual edit and soften the editor"));
  // More than four distinct proposals must not make an older card silently target the editor.
  await input("ai-chat-prompt", "Create three more loops");
  await click("Send");
  await waitFor("document.querySelectorAll('.ai-chat-file').length === 8");
  await evaluate("document.querySelectorAll('.ai-chat-file button')[1].click()");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"File to edit\"]').value"), "warm-loop.banger");
  await input("ai-chat-prompt", "Edit the older selected loop");
  await click("Send");
  await waitFor("document.querySelectorAll('.ai-chat-file').length === 9");
  assert.equal(await evaluate("document.querySelectorAll('.ai-chat-file strong')[8].textContent"), "warm-loop.banger");
  assert.match(await evaluate("document.querySelectorAll('.ai-chat-file pre')[8].textContent"), /tempo 100;/);
  assert.equal(await evaluate("document.querySelector('#ai-chat-dialog').scrollHeight === document.querySelector('#ai-chat-dialog').clientHeight"), true);
  await writeFile(join(tmpdir(), desktop ? "banger-chat-desktop.png" : "banger-chat-web.png"), (await window.webContents.capturePage()).toPNG());
  await input("ai-chat-prompt", "slow request");
  await click("Send");
  await waitFor("document.querySelector('.ai-chat-working')");
  await delay(100);
  await closeChat();
  await openChat();
  assert.equal(await evaluate("Boolean(document.querySelector('.ai-chat-working'))"), true);
  await click("Stop generating");
  await waitFor("document.querySelector('.ai-chat-footer [role=status]')?.textContent.includes('Generation stopped')");
  assert.equal(await evaluate("document.querySelectorAll('.ai-chat-file').length"), 9);
  await click("New chat");
  assert.equal(await evaluate("document.querySelectorAll('.ai-chat-file').length"), 0);
  // The popup stays inside a narrow viewport, and its backdrop dismisses it.
  window.setContentSize(390, 700);
  await delay(100);
  assert.equal(await evaluate(`(() => {
    const bounds = document.querySelector('#ai-chat-dialog').getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
  })()`), true);
  await writeFile(join(tmpdir(), desktop ? "banger-chat-modal-mobile-desktop.png" : "banger-chat-modal-mobile-web.png"), (await window.webContents.capturePage()).toPNG());
  window.webContents.sendInputEvent({ type: "mouseDown", x: 2, y: 2, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x: 2, y: 2, button: "left", clickCount: 1 });
  await waitFor("!document.querySelector('#ai-chat-dialog').open");
  await waitFor("document.activeElement.getAttribute('aria-label') === 'Open AI chat'");
}

async function run(desktop) {
  try {
    await exercise(desktop, true);
    const web = new BrowserWindow({ width: 1100, height: 900, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    await web.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await exercise(web, false);
    console.log("Chat smoke passed on desktop and static web: modal opening, Escape, focus containment and restoration, draft and request persistence, mobile bounds, backdrop dismissal, missing key, generation, follow-up context, preview, save, draft protection, load, cancellation, and new chat. Provider responses were mocked; no paid calls.");
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    clearTimeout(timeout);
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    server.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    app.exit(process.exitCode ?? 0);
  }
}
