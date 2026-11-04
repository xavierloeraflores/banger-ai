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
    await evaluate(`(document.querySelector('.app-sidebar-chat[aria-current="page"]') || [...document.querySelectorAll('.app-sidebar-chat')].at(-1) || document.querySelector('[aria-label="Start a new chat"]')).click()`);
    await waitFor("document.querySelector('#ai-chat-view')");
  };
  const closeChat = async () => {
    await evaluate(`document.querySelector('[aria-label="Beat Studio"]').click()`);
    await waitFor("!document.querySelector('#ai-chat-view')");
  };
  const newChat = () => evaluate(`document.querySelector('[aria-label="New chat"]').click()`);
  const openMenu = async id => {
    await evaluate(`document.getElementById(${JSON.stringify(id)}).dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}))`);
    await waitFor("document.querySelector('[role=menu]')");
    await delay(150);
  };
  const menuChoice = async text => {
    await evaluate(`([...document.querySelectorAll('[role=menuitemradio]')].find(item => item.textContent.trim() === ${JSON.stringify(text)})).click()`);
    await waitFor("!document.querySelector('[role=menu]')");
  };
  await openChat();
  assert.equal(await evaluate("document.querySelector('[aria-label=Send]').disabled"), true);
  assert.equal(await evaluate("document.querySelector('#ai-chat-view button[aria-label=\"New chat\"]')"), null);
  await openMenu('chat-ai-model');
  assert.match(await evaluate("document.querySelector('[role=menu]').textContent"), /Add a model/);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
  await waitFor("!document.querySelector('[role=menu]')");
  await closeChat();
  await evaluate("document.querySelector('[aria-label=Settings]').click()");
  await waitFor("!document.querySelector('.byok-form fieldset').disabled");
  await input("byok-model", "anthropic/claude-opus-5-5");
  await input("byok-key", "fake-chat-key");
  await click("Save and select");
  await waitFor("document.querySelector('.byok-feedback [role=status]')");
  await evaluate(`document.querySelector('[aria-label="Close settings"]').click()`);

  await openChat();
  await waitFor("document.activeElement.id === 'ai-chat-prompt'");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.ai-chat-permissions [role=checkbox]')].map(input => [input.parentElement.textContent, (input.getAttribute('aria-checked') === 'true')])"), [["Edit beat", true], ["Edit lyrics", false], ["Produce and Add to Library", false]]);
  assert.equal(await evaluate("!!document.querySelector('[aria-label=\"AI editing target\"]')"), false);
  await input("ai-chat-prompt", "Keep this draft");
  await closeChat();
  await openChat();
  assert.equal(await evaluate("document.querySelector('#ai-chat-prompt').value"), "Keep this draft");
  await openMenu('chat-ai-model');
  assert.equal(await evaluate(`document.querySelector('[role=menuitemradio][title="Vercel AI Gateway · anthropic/claude-opus-5-5"]').getAttribute('aria-checked')`), 'true');
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitFor("!document.querySelector('[role=menu]') && document.activeElement.id === 'chat-ai-model'");
  assert.equal(await evaluate("!!document.querySelector('#ai-chat-view')"), true);
  await evaluate(`(() => {
    const key = 'banger.ai-settings.v1';
    const settings = JSON.parse(sessionStorage.getItem(key));
    settings.providers.openai = { model: 'gpt-4.1', key: 'unused-fixture-key' };
    sessionStorage.setItem(key, JSON.stringify(settings));
    window.dispatchEvent(new Event('banger:ai-settings-changed'));
  })()`);
  await openMenu('chat-ai-model');
  await evaluate("[...document.querySelectorAll('[role=menuitemradio]')].find(item => item.title === 'OpenAI · gpt-4.1').click()");
  await waitFor("document.querySelector('#chat-ai-model').textContent === 'GPT-4.1' && document.querySelector('#chat-ai-reasoning').disabled");
  await openMenu('chat-ai-model');
  await evaluate("[...document.querySelectorAll('[role=menuitemradio]')].find(item => item.title === 'Vercel AI Gateway · anthropic/claude-opus-5-5').click()");
  await waitFor("document.querySelector('#chat-ai-model').textContent === 'Claude Opus 5.5' && !document.querySelector('#chat-ai-reasoning').disabled");
  await writeFile(join(tmpdir(), 'banger-chat-empty.png'), (await window.webContents.capturePage()).toPNG());
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
  await waitFor("!document.querySelector('#chat-ai-reasoning').disabled");
  assert.match(await evaluate("document.querySelector('#chat-ai-reasoning').textContent"), /Default/);
  await openMenu('chat-ai-reasoning');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[role=menuitemradio]')].map(option => option.textContent.trim())"), ["Provider default", "Low", "Medium", "High"]);
  await menuChoice('Provider default');
  const reasoning = async value => {
    await openMenu('chat-ai-reasoning');
    await menuChoice(value === 'high' ? 'High' : 'Provider default');
    await waitFor(`!document.querySelector('#chat-ai-reasoning').disabled && document.querySelector('#chat-ai-reasoning').textContent.includes(${JSON.stringify(value === 'high' ? 'High' : 'Default')})`);
  };
  const latestEffort = () => desktop ? calls.at(-1)?.providerOptions?.anthropic?.effort : evaluate("window.__chatCalls.at(-1)?.providerOptions?.anthropic?.effort");
  await reasoning("high");
  await openMenu('chat-ai-model');
  await evaluate("[...document.querySelectorAll('[role=menuitemradio]')].find(item => item.title === 'Vercel AI Gateway · meta/muse-spark-1.3').click()");
  await waitFor("document.querySelector('#chat-ai-model').textContent === 'Muse Spark 1.3' && !document.querySelector('#chat-ai-reasoning').disabled");
  assert.match(await evaluate("document.querySelector('#chat-ai-reasoning').textContent"), /Default/);
  await openMenu('chat-ai-reasoning');
  await menuChoice('Low');
  await openMenu('chat-ai-model');
  await evaluate("[...document.querySelectorAll('[role=menuitemradio]')].find(item => item.title === 'Vercel AI Gateway · anthropic/claude-opus-5-5').click()");
  await waitFor("document.querySelector('#chat-ai-model').textContent === 'Claude Opus 5.5' && document.querySelector('#chat-ai-reasoning').textContent.includes('High')");
  await input("ai-chat-prompt", "Create two loops");
  await waitFor("document.querySelector('#chat-ai-model').textContent === 'Claude Opus 5.5'");
  const originalSource = await evaluate("document.querySelector('#producer-source').value");
  await click("Send");
  await waitFor("document.querySelectorAll('.ai-chat-file').length === 2");
  assert.equal(await latestEffort(), "high");
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
  await closeChat();
  await evaluate("document.querySelector('[aria-label=\"Add project\"]').click()");
  await waitFor("document.querySelector('#project-controls')?.getAttribute('data-state') === 'open'");
  assert.equal(await evaluate("[...document.querySelectorAll('.producer-file-actions button')].find(b => b.textContent === 'Save').disabled"), false);
  await evaluate("document.querySelector('[aria-label=\"Close project controls\"]').click()");
  await openChat();
  await evaluate("document.querySelectorAll('.ai-chat-file button')[3].click()");
  await waitFor("document.querySelector('#producer-tempo').value === '85'");
  await openChat();
  assert.match(await evaluate("document.querySelector('#chat-ai-reasoning').textContent"), /High/);
  await reasoning("");
  await input("ai-chat-prompt", "Make the second loop softer");
  await click("Send");
  await waitFor("document.querySelectorAll('.ai-chat-file').length === 3");
  assert.equal(await latestEffort(), undefined);
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
  assert.equal(await evaluate("document.querySelector('#ai-chat-view').scrollHeight === document.querySelector('#ai-chat-view').clientHeight"), true);
  await writeFile(join(tmpdir(), desktop ? "banger-chat-desktop.png" : "banger-chat-web.png"), (await window.webContents.capturePage()).toPNG());
  await input("ai-chat-prompt", "slow request");
  await click("Send");
  await waitFor("document.querySelector('.ai-chat-working')");
  await delay(100);
  assert.equal(await evaluate("document.querySelector('#chat-ai-model').disabled && document.querySelector('#chat-ai-reasoning').disabled"), true);
  await closeChat();
  await openChat();
  assert.equal(await evaluate("Boolean(document.querySelector('.ai-chat-working'))"), true);
  await click("Stop generating");
  await waitFor("document.querySelector('.ai-chat-footer [role=status]')?.textContent.includes('Generation stopped')");
  assert.equal(await evaluate("document.querySelectorAll('.ai-chat-file').length"), 9);
  await newChat();
  assert.equal(await evaluate("document.querySelectorAll('.ai-chat-file').length"), 0);
  const beforeReadOnly = await evaluate("document.querySelector('#producer-source').value");
  await evaluate("document.querySelector('.ai-chat-controls summary').click(); document.querySelector('.ai-chat-permissions [role=checkbox]').click()");
  await waitFor("document.querySelector('.ai-chat-permissions').textContent.includes('Reply only')");
  await input("ai-chat-prompt", "Please edit the beat and write lyrics anyway");
  await click("Send");
  await waitFor("document.querySelector('.ai-chat-answer')?.textContent.includes('Your song is unchanged')");
  assert.equal(await evaluate("document.querySelectorAll('.ai-chat-file').length"), 0);
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), beforeReadOnly);
  const readOnlyCalls = desktop ? calls : await evaluate("window.__chatCalls");
  assert.equal((readOnlyCalls.at(-1).tools ?? []).length, 0);
  await closeChat();
  await openChat();
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.ai-chat-permissions [role=checkbox]')].map(input => (input.getAttribute('aria-checked') === 'true'))"), [false, false, false]);
  await evaluate("document.querySelectorAll('.ai-chat-permissions [role=checkbox]')[0].click(); document.querySelectorAll('.ai-chat-permissions [role=checkbox]')[1].click()");
  await input("ai-chat-prompt", "Create three more loops with both permissions enabled");
  await click("Send");
  await waitFor("document.querySelectorAll('.ai-chat-file').length === 3");
  const bothCalls = desktop ? calls : await evaluate("window.__chatCalls");
  assert.deepEqual(bothCalls.at(-2).tools.map(tool => tool.name).sort(), ["create_banger_file", "edit_banger_file", "request_lyrics"]);
  await newChat();
  // Menus, composer, and transcript stay inside a narrow viewport.
  window.setContentSize(390, 700);
  await delay(100);
  const fits = selector => evaluate(`(() => { const bounds = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight; })()`);
  assert.equal(await fits('#ai-chat-view'), true);
  assert.equal(await fits('.ai-chat-compose'), true);
  await writeFile(join(tmpdir(), 'banger-chat-mobile.png'), (await window.webContents.capturePage()).toPNG());
  await openMenu('chat-ai-reasoning');
  assert.match(await evaluate("getComputedStyle(document.querySelector('[role=menu]')).fontFamily"), /Arial/);
  assert.equal(await fits('[role=menu]'), true);
  await writeFile(join(tmpdir(), 'banger-chat-mobile-menu.png'), (await window.webContents.capturePage()).toPNG());
  await menuChoice('High');

}

async function run(desktop) {
  try {
    // Desktop project chat is covered by smoke:workspace. This exercises the browser proposal fallback.
    desktop.hide();
    const web = new BrowserWindow({ width: 1100, height: 900, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    await web.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await exercise(web, false);
    console.log("Chat smoke passed on static web: dedicated view, menu keyboard navigation and focus restoration, draft and request persistence, mobile bounds, missing key, generation, follow-up context, preview, save, draft protection, load, cancellation, and new chat. Provider responses were mocked; no paid calls.");
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    clearTimeout(timeout);
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    server.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    app.exit(process.exitCode ?? 0);
  }
}
