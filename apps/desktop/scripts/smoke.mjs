import { app, dialog } from "electron";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import "../dist/main.js";
import { smokeProducer } from "./smoke-producer.mjs";

const timeout = setTimeout(() => { console.error("Desktop smoke test timed out."); app.exit(1); }, 45_000);
// Keep the smoke process alive for assertions and cleanup after the final window closes.
app.on("before-quit", (event) => event.preventDefault());
app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", () => { void run(window); });
});

async function run(window) {
  const directory = await mkdtemp(join(tmpdir(), "banger-smoke-"));
  try {
    assert.equal(window.webContents.getURL(), "banger://app/");
    const state = await window.webContents.executeJavaScript(`({
      bridge: Object.keys(window.bangerProjects).sort(),
      node: typeof require,
      secure: window.isSecureContext,
      scripts: [...document.scripts].map(script => script.src).filter(Boolean),
      body: document.body.innerHTML.length,
    })`);
    assert.deepEqual(state.bridge, ["openProject", "saveProject"]);
    assert.equal(state.node, "undefined");
    assert.equal(state.secure, true);
    assert.ok(state.body > 0);
    assert.ok(state.scripts.length > 0, "The real Next.js export must load scripts.");
    const assets = await window.webContents.executeJavaScript(`Promise.all(
      [...document.scripts].filter(script => script.src).map(async script => {
        const result = await fetch(script.src);
        return { status: result.status, type: result.headers.get('content-type') };
      })
    )`);
    assert.ok(assets.every(asset => asset.status === 200 && asset.type.includes("javascript")));
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    assert.equal(await window.webContents.executeJavaScript("window.bangerProjects.openProject()"), null);
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
    assert.equal(await window.webContents.executeJavaScript("window.bangerProjects.saveProject('tempo 120', 'song')"), null);
    const path = join(directory, "雪の曲 🎵.banger");
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    const saved = await window.webContents.executeJavaScript("window.bangerProjects.saveProject('♪ 雪', '雪の曲 🎵')");
    assert.deepEqual(saved, { name: "雪の曲 🎵.banger" });
    assert.equal(await readFile(path, "utf8"), "♪ 雪");
    const extensionlessPath = join(directory, "song");
    await writeFile(`${extensionlessPath}.banger`, "keep this", "utf8");
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: extensionlessPath });
    dialog.showMessageBox = async () => ({ response: 0 });
    assert.equal(await window.webContents.executeJavaScript("window.bangerProjects.saveProject('replace', 'song')"), null);
    assert.equal(await readFile(`${extensionlessPath}.banger`, "utf8"), "keep this");
    dialog.showMessageBox = async () => ({ response: 1 });
    assert.equal((await window.webContents.executeJavaScript("window.bangerProjects.saveProject('replace', 'song')")).name, "song.banger");
    assert.equal(await readFile(`${extensionlessPath}.banger`, "utf8"), "replace");
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    assert.deepEqual(await window.webContents.executeJavaScript("window.bangerProjects.openProject()"), { name: "雪の曲 🎵.banger", source: "♪ 雪" });
    await writeFile(path, new Uint8Array([0xff, 0xfe]));
    await assert.rejects(window.webContents.executeJavaScript("window.bangerProjects.openProject()"), /UTF-8/);
    await assert.rejects(window.webContents.executeJavaScript("window.bangerProjects.saveProject({}, 'song')"), /text/);
    await smokeProducer(window, directory);
    console.log("Desktop smoke passed: static Next assets, secure sandbox, scoped bridge, native Unicode round trip, cancellation, invalid input.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await rm(directory, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
}
