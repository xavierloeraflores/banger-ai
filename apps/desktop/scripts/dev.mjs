import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import electron from "electron";

const url = process.env.BANGER_DEV_URL ?? "http://127.0.0.1:3000";
const deadline = Date.now() + 120_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    if (response.ok) { ready = true; break; }
  } catch { /* Next may still be starting. */ }
  await setTimeout(500);
}
if (!ready) throw new Error(`Next.js did not start at ${url}. Run pnpm dev:desktop from the workspace root.`);
const child = spawn(electron, ["."], { stdio: "inherit", env: { ...process.env, BANGER_DEV_URL: url } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 0; });
