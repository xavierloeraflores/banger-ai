import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function findAvailablePort(firstPort = 3000) {
  if (!Number.isInteger(firstPort) || firstPort < 1 || firstPort > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  for (let port = firstPort; port <= Math.min(firstPort + 99, 65535); port++) {
    const available = await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE") resolve(false);
        else reject(error);
      });
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error(`No available development port starting at ${firstPort}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = await findAvailablePort(Number(process.env.PORT ?? 3000));
  const url = `http://127.0.0.1:${port}`;
  console.log(`Banger development URL: ${url}`);
  const require = createRequire(import.meta.url);
  const child = spawn(process.execPath, [require.resolve("turbo/bin/turbo"), "run", "dev", ...process.argv.slice(2)], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "inherit",
    env: { ...process.env, PORT: String(port), BANGER_DEV_URL: url },
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", (error) => { console.error(error); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1); });
}
