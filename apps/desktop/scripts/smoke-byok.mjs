import { Buffer } from "node:buffer";
import { app, BrowserWindow, safeStorage } from "electron";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const directory = await mkdtemp(join(tmpdir(), "banger-byok-smoke-"));
app.setPath("userData", directory);
const timeout = setTimeout(() => { console.error("BYOK smoke timed out."); app.exit(1); }, 45_000);
app.on("before-quit", event => event.preventDefault());
let started = false;
app.on("browser-window-created", (_event, window) => {
  if (started) return;
  started = true;
  window.webContents.once("did-finish-load", () => { void run(window); });
});
await import("../dist/main.js");

async function exercise(window, desktop) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function waitFor(script) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate(`Boolean(${script})`)) return;
      await delay(25);
    }
    throw new Error(`UI state did not arrive: ${script}. ${await evaluate("document.querySelector('.byok-feedback')?.textContent")}`);
  }
  const click = text => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) throw new Error('Unavailable button');
    button.click();
  })()`);
  const input = (id, value) => evaluate(`(() => {
    const input = document.getElementById(${JSON.stringify(id)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('#producer-source')?.value");
  await click("BYOK");
  await waitFor("document.querySelector('#studio-tab-byok')?.getAttribute('aria-selected') === 'true' && !document.querySelector('.byok-form fieldset').disabled");
  assert.equal(await evaluate("document.querySelectorAll('.byok-providers button').length"), desktop ? 7 : 5);
  const providers = ["Vercel AI Gateway", "Anthropic", "OpenAI", "Meta Muse", "Grok"];
  for (const name of providers) {
    await evaluate(`([...document.querySelectorAll('.byok-providers button')].find(button => button.querySelector('span').textContent === ${JSON.stringify(name)})).click()`);
    await input("byok-model", "test-model");
    await input("byok-key", "fake-smoke-key");
    assert.equal(await evaluate("document.querySelector('#byok-key').type"), "password");
    await click("Show");
    assert.equal(await evaluate("document.querySelector('#byok-key').type"), "text");
    await click("Hide");
    await click("Save and select");
    await waitFor(`document.querySelector('.byok-feedback [role="status"]')?.textContent.includes(${JSON.stringify(name + " settings saved")})`);
    assert.equal(await evaluate("document.querySelector('#byok-key').value"), "");
  }
  assert.equal(await evaluate("document.querySelectorAll('#active-ai-model option:not([disabled])').length"), 5);
  for (const id of ["openai", "anthropic", "grok"]) {
    await evaluate(`(() => {
      const select = document.getElementById('active-ai-model');
      select.value = ${JSON.stringify(id)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('#active-ai-model')?.value === ${JSON.stringify(id)} && !document.querySelector('#active-ai-model').disabled`);
    if (desktop) assert.equal((await evaluate("window.bangerAI.load()")).activeProvider, id);
    else assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('banger.ai-settings.v1')).activeProvider"), id);
  }
  if (desktop) {
    await evaluate("[...document.querySelectorAll('.byok-providers button')].find(button => button.querySelector('span').textContent === 'Local model').click()");
    await waitFor("document.querySelector('.byok-layout > .local-model-settings')");
    assert.equal(await evaluate("document.querySelector('.byok-form')"), null);
    assert.equal(await evaluate("document.querySelectorAll('#local-model-size option').length"), 2);
    await assert.rejects(evaluate("window.bangerAI.select('local:small')"), /Download/);
    assert.equal((await evaluate("window.bangerAI.load()")).activeProvider, "grok");
    await evaluate("[...document.querySelectorAll('.byok-providers button')].find(button => button.querySelector('span').textContent === 'Grok').click()");
    await waitFor("document.querySelector('#byok-model')");
  }
  assert.equal(await evaluate("document.querySelector('#producer-source').value.includes('fake-smoke-key')"), false);
  if (desktop) {
    const bytes = await readFile(join(directory, "ai-settings.enc"));
    assert.equal(bytes.includes(Buffer.from("fake-smoke-key")), false);
    assert.equal(JSON.stringify(await evaluate("window.bangerAI.load()")).includes("fake-smoke-key"), false);
    assert.equal(JSON.parse((await safeStorage.decryptStringAsync(bytes)).result).providers.grok.key, "fake-smoke-key");
  }
  await click("Sequencer");
  assert.equal(await evaluate("document.querySelector('#byok-key')"), null);
  await window.loadURL("banger://app/");
  await waitFor("document.querySelector('#producer-source')?.value");
  await click("BYOK");
  await waitFor("document.querySelector('#byok-model')?.value === 'test-model'");
  assert.equal(await evaluate("document.querySelector('.byok-form h3').textContent"), "Grok");
  await input("byok-model", "second-model");
  await click("Save and select");
  await waitFor("document.querySelector('.byok-feedback [role=\"status\"]')?.textContent.includes('settings saved')");
  await writeFile(join(tmpdir(), desktop ? "banger-byok-desktop.png" : "banger-byok-web.png"), (await window.webContents.capturePage()).toPNG());
  await click("Remove key");
  await waitFor("document.querySelector('.byok-feedback [role=\"status\"]')?.textContent === 'Grok key removed.'");
  assert.equal(await evaluate("document.querySelector('#byok-key').required"), true);
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Remove key').disabled"), true);
  await click("Sequencer");
  assert.equal(await evaluate("document.querySelector('#studio-panel-byok').hidden"), true);
}

async function run(desktopWindow) {
  try {
    await exercise(desktopWindow, true);
    const webWindow = new BrowserWindow({ width: 390, height: 844, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await webWindow.loadURL("banger://app/");
    await exercise(webWindow, false);
    webWindow.destroy();
    console.log("BYOK smoke passed: provider menu with local models, configured-model dropdown, saved-key switching, masked keys, save/replace/remove, reload persistence, encrypted desktop storage, web session storage, mobile layout, and tab navigation.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    await rm(directory, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
}
