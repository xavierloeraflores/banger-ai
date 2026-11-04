import { enterStudio } from "./smoke-startup.mjs";
// Live integration test. Downloads the real model if needed; never calls a cloud provider.
// --keep-open leaves the desktop and local runtime running for manual use.
import { app, BrowserWindow, dialog } from "electron";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { compileMusic } from "../../../packages/compiler/dist/index.js";

app.setName("@banger/desktop");
const keepOpen = process.argv.includes("--keep-open");
if (process.env.BANGER_LOCAL_SMOKE_HOME) app.setPath("userData", process.env.BANGER_LOCAL_SMOKE_HOME);
const timeout = setTimeout(() => { console.error("Local smoke timed out."); if (!keepOpen) app.exit(1); }, 30 * 60_000);
app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", () => { void run(window); });
});
await import("../dist/main.js");

async function run(window) {
  await enterStudio(window);
  const evaluate = script => window.webContents.executeJavaScript(script, true).catch(error => { throw new Error(`${error.message} Script: ${script}`); });
  async function waitFor(script, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(`Boolean(${script})`)) return;
      await delay(250);
    }
    throw new Error(`UI state did not arrive: ${script}. ${await evaluate("document.querySelector('.ai-chat-footer')?.textContent")}`);
  }
  const click = text => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) throw new Error('Unavailable button: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  const input = value => evaluate(`(() => {
    const input = document.getElementById('ai-chat-prompt');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  try {
    await waitFor("window.bangerLocal && document.querySelector('#producer-source')?.value");
    await evaluate("document.querySelector('[aria-label=Settings]').click()");
    await waitFor("[...document.querySelectorAll('.byok-providers button span')].some(span => span.textContent === 'Local model')");
    await evaluate("[...document.querySelectorAll('.byok-providers button')].find(button => button.querySelector('span').textContent === 'Local model').click()");
    await waitFor("document.querySelector('.local-model-settings')");
    let status = await evaluate("window.bangerLocal.status()");
    if (!status.installed) {
      await click("Download model");
      await delay(1000);
      status = await evaluate("window.bangerLocal.status()");
      while (["downloading", "verifying"].includes(status.phase)) {
        console.log(`${status.message} ${(status.completed / 1e9).toFixed(2)} GB`);
        await delay(10_000);
        status = await evaluate("window.bangerLocal.status()");
      }
      assert.equal(status.phase, "ready", status.message);
    }
    await waitFor("document.querySelector('#active-ai-model option[value=\"local:small\"]')");
    await evaluate(`(() => {
      const select = document.getElementById('active-ai-model');
      select.value = 'local:small';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor("document.querySelector('.ai-chat-heading-actions')?.textContent.includes('Muse Glimmer')");

    const startupDeadline = Date.now() + 320_000;
    do {
      await delay(1000);
      status = await evaluate("window.bangerLocal.status()");
      if (status.phase === "error") throw new Error(status.message);
    } while (status.phase !== "running" && Date.now() < startupDeadline);
    assert.equal(status.phase, "running");
    await writeFile(join(tmpdir(), "banger-local-selector.png"), (await window.webContents.capturePage()).toPNG());
    console.log("Live Muse Glimmer loaded through the model selector. Generating through desktop chat.");
    await evaluate(`document.querySelector('[aria-label="Close settings"]').click()`);
    await evaluate("document.querySelector('[aria-label=\"Open AI chat\"]').click()");
    await evaluate("(() => { const s = document.querySelector('[aria-label=\"Chat scope\"]'); s.value = 'studio'; s.dispatchEvent(new Event('change', {bubbles:true})); })()");
    await waitFor("(document.querySelector('#ai-chat-dialog')?.getAttribute('data-state') === 'open' && document.querySelector('#ai-chat-dialog')?.getAttribute('aria-modal') === 'true')");
    await input("Create one warm lo-fi loop at 85 BPM with kick, snare, hats and a C minor bass line. Use create_banger_file to produce a playable file.");
    await click("Send");
    await waitFor("document.querySelector('.ai-chat-file') || document.querySelector('.ai-chat-footer [role=alert]')", 650_000);
    const error = await evaluate("document.querySelector('.ai-chat-footer [role=alert]')?.textContent");
    assert.equal(error, undefined);
    const source = await evaluate("document.querySelector('.ai-chat-file pre').textContent");
    const program = compileMusic(source);
    assert.equal(program.tempo, 85);
    assert.ok(program.tracks.length >= 3);
    assert.match(await evaluate("document.querySelector('.ai-chat-model').textContent"), /local/);
    const output = join(tmpdir(), "muse-glimmer-live.banger");
    const originalSave = dialog.showSaveDialog;
    try {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
      await click("Save file");
      await waitFor("document.querySelector('.ai-chat-footer [role=status]')?.textContent.includes('Saved')");
      assert.equal(await readFile(output, "utf8"), source);
    } finally { dialog.showSaveDialog = originalSave; }
    await click("Load in studio");
    await waitFor(`document.querySelector('#producer-source')?.value === ${JSON.stringify(source)}`);
    await writeFile(join(tmpdir(), "banger-local-live.png"), (await window.webContents.capturePage()).toPNG());
    console.log(`Local smoke passed: real Muse Glimmer generated ${program.tracks.length} tracks at ${program.tempo} BPM, compiled, saved ${output}, and loaded into the studio.`);
    if (keepOpen) { window.show(); window.focus(); console.log("Desktop and local model left running."); }
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    clearTimeout(timeout);
    if (!keepOpen) { for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.quit(); }
  }
}
