import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { totalmem } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { MODELS, RUNTIMES } from "./local-model-manifest.js";

export type LocalStatus = {
  phase: "missing" | "downloading" | "verifying" | "ready" | "starting" | "running" | "error";
  installedVariants: ("small" | "dynamic")[]; variant: "small" | "dynamic"; selected: boolean; installed: boolean; completed: number; total: number; message: string;
  supported: boolean; memoryGB: number;
};
type Artifact = { url: string; size: number; sha256: string };
async function size(path: string) { try { return (await stat(path)).size; } catch { return 0; } }

// Partial downloads survive cancellation. Only verified complete files get their final name.
export async function downloadArtifact(artifact: Artifact, path: string, signal: AbortSignal,
  progress: (bytes: number, verifying: boolean) => void, fetcher: typeof fetch = fetch) {
  if (await size(path) === artifact.size) return;
  const partial = `${path}.partial`;
  let offset = await size(partial);
  if (offset > artifact.size) { await rm(partial, { force: true }); offset = 0; }
  if (offset < artifact.size) {
    const response = await fetcher(artifact.url, {
      headers: offset ? { Range: `bytes=${offset}-` } : {},
      signal: AbortSignal.any([signal, AbortSignal.timeout(3_600_000)]),
    });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}). Try again to resume.`);
    if (response.status === 206) {
      const range = response.headers.get("content-range");
      if (range !== `bytes ${offset}-${artifact.size - 1}/${artifact.size}`) throw new Error("The download returned an invalid byte range. Try again.");
    } else if (response.status === 200) offset = 0;
    else throw new Error("The download returned an unexpected response.");
    const file = await open(partial, offset ? "a" : "w", 0o600);
    try {
      for await (const chunk of response.body) {
        signal.throwIfAborted();
        if (offset + chunk.byteLength > artifact.size) throw new Error("The download exceeded its expected size.");
        let written = 0;
        while (written < chunk.byteLength) written += (await file.write(chunk, written)).bytesWritten;
        offset += chunk.byteLength;
        progress(offset, false);
      }
    } finally { await file.close(); }
  }
  if (offset !== artifact.size) throw new Error("Download interrupted. Try again to resume.");
  progress(offset, true);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(partial)) { signal.throwIfAborted(); hash.update(chunk); }
  if (hash.digest("hex") !== artifact.sha256) {
    await rm(partial, { force: true });
    throw new Error("Download verification failed. Download again.");
  }
  await rename(partial, path);
}

async function findServer(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === (process.platform === "win32" ? "llama-server.exe" : "llama-server")) return path;
    if (entry.isDirectory()) { const found = await findServer(path); if (found) return found; }
  }
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export function createLocalModel(directory: string) {
  const runtime = RUNTIMES[`${process.platform}-${process.arch}`];
  const runtimeDirectory = join(directory, "runtime-b12034");
  let model: typeof MODELS[keyof typeof MODELS] = MODELS.small;
  let modelPath = join(directory, model.name);
  let changingVariant = false;
  const preferencePath = join(directory, "selection.json");
  let server: ChildProcess | undefined;
  let endpoint: { port: number; token: string } | undefined;
  let operation: AbortController | undefined;
  let job: Promise<void> | undefined;
  let preferenceQueue = Promise.resolve();
  const state: LocalStatus = { phase: "missing", installedVariants: [], variant: "small", selected: false, installed: false, completed: 0, total: model.size,
    message: "Download Muse Glimmer to generate music on this computer.", supported: Boolean(runtime), memoryGB: Math.round(totalmem() / 2 ** 30) };
  const initialized = (async () => {
    await mkdir(directory, { recursive: true });
    try {
      const preference = JSON.parse(await readFile(preferencePath, "utf8"));
      state.selected = preference.selected === true;
      state.variant = preference.variant === "dynamic" ? "dynamic" : "small";
      model = MODELS[state.variant]; modelPath = join(directory, model.name); state.total = model.size;
    } catch { /* First use. */ }
    try {
      if (await findServer(runtimeDirectory)) {
        for (const variant of ["small", "dynamic"] as const) {
          if (await size(join(directory, MODELS[variant].name)) === MODELS[variant].size) state.installedVariants.push(variant);
        }
      }
      state.installed = state.installedVariants.includes(state.variant);
    } catch { /* Not installed. */ }
    if (state.installed) { state.phase = "ready"; state.message = "Ready to start."; }
  })();
  async function stopServer() {
    endpoint = undefined;
    const child = server;
    if (!child || !child.pid) return;
    server = undefined;
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.kill();
    });
  }
  function begin(work: (signal: AbortSignal) => Promise<void>) {
    if (operation || changingVariant) throw new Error("A local model operation is already in progress.");
    const controller = new AbortController();
    operation = controller;
    job = (async () => {
      try { await work(controller.signal); }
      catch (error) {
        await stopServer();
        state.phase = controller.signal.aborted ? state.installed ? "ready" : "missing" : "error";
        state.message = controller.signal.aborted ? "Stopped. Download again to resume any partial download."
          : error instanceof Error && !('code' in error) ? error.message : "Local model operation failed. Check available disk space and try again.";
      } finally { operation = undefined; job = undefined; }
    })();
  }
  return {
    async status() { await initialized; return { ...state }; },
    async select(selected: boolean) {
      await initialized;
      const result = preferenceQueue.then(async () => {
        await writeFile(`${preferencePath}.tmp`, JSON.stringify({ selected, variant: state.variant }), { mode: 0o600 });
        await rename(`${preferencePath}.tmp`, preferencePath);
        state.selected = selected;
      });
      preferenceQueue = result.catch(() => {});
      await result;
    },
    async choose(variant: unknown) {
      await initialized;
      if (variant !== "small" && variant !== "dynamic") throw new Error("Choose one of the available model sizes.");
      if (operation || server || changingVariant) throw new Error("Stop the model or download before changing its size.");
      changingVariant = true;
      try {
        const next = MODELS[variant];
        const nextPath = join(directory, next.name);
        let installed = false;
        try { installed = await size(nextPath) === next.size && Boolean(await findServer(runtimeDirectory)); } catch { /* Missing runtime. */ }
        const result = preferenceQueue.then(async () => {
          await writeFile(`${preferencePath}.tmp`, JSON.stringify({ selected: state.selected, variant }), { mode: 0o600 });
          await rename(`${preferencePath}.tmp`, preferencePath);
          model = next; modelPath = nextPath;
          Object.assign(state, { variant, installed, phase: installed ? "ready" : "missing", completed: 0, total: next.size,
            message: installed ? "Ready to start." : "Download this model size to use it locally." });
        });
        preferenceQueue = result.catch(() => {});
        await result;
      } finally { changingVariant = false; }
    },
    async download() {
      await initialized;
      if (!runtime) throw new Error("Local model installation is unavailable on this operating system.");
      if (server) throw new Error("Stop the model before downloading.");
      begin(async signal => {
        state.phase = "downloading"; state.message = "Preparing download…";
        const disk = await statfs(directory);
        const needed = Math.max(0, model.size - await size(`${modelPath}.partial`) - await size(modelPath)) + runtime.size * 3 + 1024 ** 3;
        if (disk.bavail * disk.bsize < needed) throw new Error(`Free at least ${Math.ceil(model.size / 1e9) + 1} GB of disk space, then retry.`);
        state.phase = "downloading";
        const archive = join(directory, runtime.archive);
        await downloadArtifact(runtime, archive, signal, (completed, verifying) => {
          Object.assign(state, { phase: verifying ? "verifying" : "downloading", completed, total: runtime.size, message: verifying ? "Verifying inference runtime…" : "Downloading inference runtime…" });
        });
        await mkdir(runtimeDirectory, { recursive: true });
        // Fixed verified archive and destination; no renderer-provided executable, arguments, or paths.
        await new Promise<void>((resolve, reject) => {
          const child = spawn("tar", ["-xf", archive, "-C", runtimeDirectory], { signal, windowsHide: true, stdio: "ignore" });
          child.once("error", reject);
          child.once("exit", code => code === 0 ? resolve() : reject(new Error("Could not unpack the runtime. Retry the download.")));
        });
        if (!await findServer(runtimeDirectory)) throw new Error("The runtime archive is missing llama-server.");
        await downloadArtifact(model, modelPath, signal, (completed, verifying) => {
          Object.assign(state, { phase: verifying ? "verifying" : "downloading", completed, total: model.size, message: verifying ? "Verifying Muse Glimmer…" : "Downloading Muse Glimmer…" });
        });
        if (!state.installedVariants.includes(state.variant)) state.installedVariants.push(state.variant);
        Object.assign(state, { phase: "ready", installed: true, message: "Download complete. Start the model to use local AI." });
      });
    },
    async start() {
      await initialized;
      if (state.phase === "running") return;
      if (!state.installed) throw new Error("Download the model first.");
      begin(async signal => {
        state.phase = "starting"; state.message = "Loading Muse Glimmer into memory…";
        const executable = await findServer(runtimeDirectory);
        if (!executable) throw new Error("Download the runtime again.");
        const port = await freePort();
        const token = randomBytes(32).toString("hex");
        signal.throwIfAborted();
        const child = spawn(executable, ["--model", modelPath, "--host", "127.0.0.1", "--port", String(port),
          "--alias", "muse-glimmer", "--ctx-size", "16384", "--parallel", "1", "--n-gpu-layers", "99",
          "--jinja", "--temp", "1.0", "--top-p", "0.95", "--top-k", "64", "--no-webui"],
        { windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, LLAMA_API_KEY: token } });
        server = child;
        let failed = false;
        child.stderr?.on("data", () => { /* Drain diagnostics; paths never cross IPC. */ });
        child.once("error", () => { failed = true; });
        child.once("exit", () => {
          failed = true;
          if (server === child) {
            server = undefined; endpoint = undefined;
            state.phase = "error"; state.message = "The local runtime stopped. Close other memory-heavy apps and start it again.";
          }
        });
        const deadline = Date.now() + 300_000;
        while (Date.now() < deadline) {
          signal.throwIfAborted();
          if (failed) throw new Error("Muse Glimmer could not start. Close other memory-heavy apps and retry. If it persists, download the runtime again.");
          try {
            const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]) });
            if (response.ok && !failed) { endpoint = { port, token }; state.phase = "running"; state.message = "Muse Glimmer is running on this computer."; return; }
          } catch { /* Loading. */ }
          await delay(500, undefined, { signal });
        }
        throw new Error("Model startup timed out. Close other memory-heavy apps and retry.");
      });
    },
    async stop() {
      await initialized;
      operation?.abort();
      await job;
      await stopServer();
      state.phase = state.installed ? "ready" : "missing";
      state.message = state.installed ? "Model stopped. Start it again to use local AI." : "Download paused. Download again to resume.";
    },
    connection() { if (!endpoint || state.phase !== "running") throw new Error("Start Muse Glimmer in AI settings before sending a message."); return endpoint; },
    dispose() { operation?.abort(); server?.kill(); },
  };
}
