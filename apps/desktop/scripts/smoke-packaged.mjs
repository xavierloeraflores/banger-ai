import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const suffix = process.arch === "arm64" ? "-arm64" : "";
const defaultBinary = {
  darwin: `mac${suffix}/Banger.app/Contents/MacOS/Banger`,
  win32: `win${suffix}-unpacked/banger.exe`,
  linux: `linux${suffix}-unpacked/banger`,
}[process.platform];
const binary = process.argv[2] ? resolve(process.argv[2]) : resolve(desktop, "release", defaultBinary);
await access(binary);
const profile = await mkdtemp(join(tmpdir(), "banger-packaged-smoke-"));
const env = { ...process.env, BANGER_DEV_URL: "http://127.0.0.1:1" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_PATH;
// Launch the real executable from outside the checkout, using a disposable profile.
const child = spawn(binary, [`--user-data-dir=${profile}`, "--remote-debugging-port=0"], {
  cwd: profile, env, stdio: ["ignore", "pipe", "pipe"],
});
const exited = once(child, "exit");
let logs = "";
child.stdout.on("data", value => { logs += value; });
child.stderr.on("data", value => { logs += value; });
let socket;
const deadline = Date.now() + 120_000;
const pending = new Map();
let sequence = 0;
async function until(operation) {
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Packaged app exited before verification");
    const value = await operation();
    if (value) return value;
    await delay(200);
  }
  throw new Error("Packaged app smoke timed out");
}
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 30_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  const port = await until(async () => {
    const text = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
    return Number(text.split("\n")[0]);
  });
  const target = await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    return (await response.json()).find(target => target.type === "page" && target.url === "banger://app/");
  });
  socket = new globalThis.WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  await until(() => evaluate("Boolean(document.querySelector('.producer-start button') && window.bangerWorkspace)"));
  const result = await evaluate(`(async () => {
    const assets = [...document.scripts].map(script => script.src).filter(Boolean);
    assets.push(...[...document.querySelectorAll('link[rel="stylesheet"]')].map(link => link.href));
    assets.push(new URL('/banger-sidechain.js', location.href).href);
    const statuses = await Promise.all(assets.map(async url => ({ url, status: (await fetch(url)).status })));
    const context = new AudioContext();
    await context.audioWorklet.addModule('/banger-sidechain.js');
    const worklet = new AudioWorkletNode(context, 'banger-sidechain', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2] });
    worklet.disconnect(); await context.close();
    const recent = await window.bangerWorkspace.recent();
    const library = await window.bangerLibrary.list();
    const local = await window.bangerLocal.status();
    return { url: location.href, secure: isSecureContext, node: typeof require,
      bridge: typeof window.bangerProjects.openProject, assets: statuses, recent, library,
      localPhase: local.phase, buttons: [...document.querySelectorAll('.producer-start button')].map(button => button.textContent) };
  })()`);
  assert.equal(result.url, "banger://app/");
  assert.equal(result.secure, true);
  assert.equal(result.node, "undefined");
  assert.equal(result.bridge, "function");
  assert.ok(result.assets.length > 2);
  assert.ok(result.assets.every(asset => asset.status === 200), JSON.stringify(result.assets));
  assert.ok(result.buttons.includes("Load Sample Project"));
  assert.equal(result.localPhase, "missing");
  console.log(`Packaged app smoke passed (${process.platform}/${process.arch}): bundled UI, sandboxed preload, workspace/library/model IPC, and AudioWorklet.\n${binary}`);
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else child.kill("SIGTERM");
  }
  await exited;
  for (const request of pending.values()) clearTimeout(request.timeout);
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
