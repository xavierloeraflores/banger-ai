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
      if (await evaluate(script)) return;
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
  await waitFor("document.querySelector('.byok-dialog')?.open && !document.querySelector('.byok-form fieldset').disabled");
  assert.equal(await evaluate("document.querySelectorAll('.byok-providers button').length"), 5);
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
  assert.equal(await evaluate("document.querySelector('#producer-source').value.includes('fake-smoke-key')"), false);
  if (desktop) {
    const bytes = await readFile(join(directory, "ai-settings.enc"));
    assert.equal(bytes.includes(Buffer.from("fake-smoke-key")), false);
    assert.equal(JSON.stringify(await evaluate("window.bangerAI.load()")).includes("fake-smoke-key"), false);
    assert.equal(JSON.parse((await safeStorage.decryptStringAsync(bytes)).result).providers.grok.key, "fake-smoke-key");
  }
  await evaluate("document.querySelector('[aria-label=\"Close AI settings\"]').click()");
  assert.equal(await evaluate("document.activeElement.textContent"), "BYOK");
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
  await evaluate("document.querySelector('.byok-dialog').dispatchEvent(new Event('cancel', { cancelable: true }))");
  assert.equal(await evaluate("document.querySelector('.byok-dialog').open"), false);
}

async function run(desktopWindow) {
  try {
    await exercise(desktopWindow, true);
    const webWindow = new BrowserWindow({ width: 390, height: 844, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await webWindow.loadURL("banger://app/");
    await exercise(webWindow, false);
    webWindow.destroy();
    console.log("BYOK smoke passed: five providers, masked keys, save/replace/remove, reload persistence, encrypted desktop storage, web session storage, mobile layout, and focus restoration.");
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
