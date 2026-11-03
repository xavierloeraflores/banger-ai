import assert from "node:assert/strict";
import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serveApp } from "../dist/static-app.js";
import { enterStudio } from "./smoke-startup.mjs";

const timeout = setTimeout(() => { console.error("Source editor smoke timed out"); app.exit(1); }, 45000);
async function run() {
const server = createServer(async (request, response) => {
  const result = await serveApp(new Request(`banger://app${request.url}`), resolve("../www/out"));
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const window = new BrowserWindow({ width: 1400, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
const evaluate = code => window.webContents.executeJavaScript(code, true);
const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
const setSource = async source => {
  await evaluate(`(() => { const input = document.querySelector('#producer-source');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(source)});
    input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await settle();
};
try {
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
  await enterStudio(window);
  await evaluate("document.querySelector('#studio-tab-source').click()");
  await settle();
  const fixture = '// A tempo variable\nlet speed = 112;\ntempo speed;\ntrack kick {\n  sound "drums/kick";\n  rhythm "x . . .";\n  gain .8;\n}\n';
  await setSource(fixture);
  assert.equal(await evaluate("document.querySelectorAll('.source-error').length"), 0);
  assert.ok(await evaluate("new Set(['keyword', 'string', 'number', 'identifier', 'comment'].map(kind => getComputedStyle(document.querySelector('.source-' + kind)).color)).size === 5"));
  for (const [source, marked] of [
    [fixture.replace("tempo speed", "tempo speeed"), "speeed"],
    [fixture.replace("gain .8", "gian .8"), "gian"],
    [fixture.replace("tempo speed", "tempo"), ";"],
    ["tempo 112 +", " "],
    ['track kick { sound "drums/kick', '"drums/kick'],
  ]) {
    await setSource(source);
    assert.equal(await evaluate("document.querySelector('.source-error').textContent"), marked);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.source-error')).textDecorationStyle"), "wavy");
    assert.equal(await evaluate("document.querySelector('#producer-source').getAttribute('aria-invalid')"), "true");
    assert.ok(await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Apply source').disabled"));
  }
  await setSource(fixture);
  assert.equal(await evaluate("document.querySelectorAll('.source-error').length"), 0);
  await evaluate("document.querySelector('#producer-source').focus()");
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter", modifiers: ["control"] });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter", modifiers: ["control"] });
  await settle();
  assert.equal(await evaluate("document.querySelector('.producer-source-status').textContent"), "In sync");
  // Exercise native input, selection replacement and undo through Chromium.
  await evaluate("document.querySelector('#producer-source').setSelectionRange(0, 0)");
  await window.webContents.insertText("// typed\n");
  await settle();
  assert.equal(await evaluate("document.querySelector('.producer-source-highlight').textContent"), "// typed\n" + fixture + " ");
  window.webContents.undo();
  await settle();
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), fixture);

  const longSource = "// " + "long comment ".repeat(120) + "\n" + "// more lines\n".repeat(80) + fixture.replace("tempo speed", "tempo speeed");
  await setSource(longSource);
  for (const width of [1400, 390]) {
    window.setContentSize(width, 1000);
    await settle();
    await evaluate("(() => { const input = document.querySelector('#producer-source'); input.style.height = '380px'; input.scrollTop = 900; input.scrollLeft = 130; input.dispatchEvent(new Event('scroll')); })()");
    await settle();
    assert.ok(await evaluate(`(() => { const input = document.querySelector('#producer-source'), pre = document.querySelector('.producer-source-highlight');
      return input.scrollTop > 0 && input.scrollLeft > 0 && input.scrollTop === pre.scrollTop && input.scrollLeft === pre.scrollLeft
        && ['fontFamily', 'fontSize', 'lineHeight', 'padding', 'whiteSpace', 'tabSize'].every(key => getComputedStyle(input)[key] === getComputedStyle(pre)[key]); })()`));
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
  }
  window.setContentSize(1400, 1000);
  await setSource(fixture.replace("tempo speed", "tempo speeed"));
  await evaluate("document.querySelector('#producer-source').scrollTop = 0; document.querySelector('#producer-source').scrollLeft = 0; document.querySelector('#producer-source').dispatchEvent(new Event('scroll')); document.querySelector('#source-title').scrollIntoView({block: 'start'})");
  await settle();
  await writeFile("/tmp/banger-source-editor.png", (await window.webContents.capturePage()).toPNG());
  console.log("Source editor smoke passed: syntax colors, compiler squiggles, correction, apply shortcut, native typing/undo, scrolling, resizing and narrow layout.");
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  clearTimeout(timeout); window.destroy(); server.close(); app.exit(process.exitCode ?? 0);
}
}
void app.whenReady().then(run);
