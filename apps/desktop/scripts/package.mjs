import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const root = resolve(desktop, "../..");

export function releaseVersion(version, tag) {
  // Numeric SemVer with optional prerelease; metadata is excluded from installer versions.
  const number = "(?:0|[1-9][0-9]*)";
  const identifier = `(?:${number}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
  const semver = new RegExp(`^${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?$`);
  if (!semver.test(version)) throw new Error(`Invalid desktop release version: ${version}`);
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} must match apps/desktop/package.json version v${version}`);
  }
  return version;
}

function pnpm(args, cwd) {
  if (!process.env.npm_execpath) throw new Error("Run packaging through pnpm desktop:dist or pnpm desktop:pack.");
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd, stdio: "inherit", env: { ...process.env, NODE_ENV: "production" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(" ")} failed: ${result.signal ?? result.status}`);
}

export async function stageApp(destination = resolve(desktop, ".packaging/app")) {
  const manifest = JSON.parse(await readFile(resolve(desktop, "package.json"), "utf8"));
  releaseVersion(manifest.version, process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
  await rm(destination, { recursive: true, force: true });
  await mkdir(resolve(destination, "dist"), { recursive: true });
  // Bundle the compiled main process and all runtime packages. No workspace links,
  // source files, environment files, or development node_modules enter the app.
  const result = await build({
    absWorkingDir: desktop,
    entryPoints: ["dist/main.js"],
    outfile: resolve(destination, "dist/main.js"),
    bundle: true, platform: "node", format: "esm", target: "node22",
    // Resolve explicitly supplied optional SDK dependencies from this workspace.
    nodePaths: [resolve(desktop, "node_modules")],
    // ws has complete JS fallbacks. Omit its optional native acceleration addons.
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.WS_NO_BUFFER_UTIL": '"1"',
      "process.env.WS_NO_UTF_8_VALIDATE": '"1"',
    },
    external: ["electron"], metafile: true, legalComments: "linked",
    banner: { js: 'import { createRequire as __bangerCreateRequire } from "node:module"; const require = __bangerCreateRequire(import.meta.url);' },
  });
  for (const output of Object.values(result.metafile.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external && dependency.path !== "electron" && !isBuiltin(dependency.path)) {
        throw new Error(`Unbundled runtime dependency: ${dependency.path}`);
      }
    }
  }
  await cp(resolve(desktop, "dist/icon.png"), resolve(destination, "dist/icon.png"));
  await cp(resolve(desktop, "dist/preload.cjs"), resolve(destination, "dist/preload.cjs"));
  await cp(resolve(desktop, "dist/web"), resolve(destination, "dist/web"), { recursive: true });
  await readFile(resolve(destination, "dist/web/index.html"));
  await readFile(resolve(destination, "dist/web/banger-sidechain.js"));
  const { version, description, author, homepage, type, main } = manifest;
  await writeFile(resolve(destination, "package.json"), JSON.stringify({
    name: "banger", version, description, author, homepage, type, main,
    private: true,
  }, null, 2) + "\n");
  await writeFile(resolve(destination, "../bundle-meta.json"), JSON.stringify(result.metafile, null, 2));
}

async function main(args) {
  const allowed = new Set(["--dir", "--mac", "--win", "--linux", "--arm64", "--x64"]);
  for (const arg of args) if (!allowed.has(arg)) throw new Error(`Unknown packaging option: ${arg}`);
  const platformFlags = args.filter(arg => ["--mac", "--win", "--linux"].includes(arg));
  const nativeFlag = { darwin: "--mac", win32: "--win", linux: "--linux" }[process.platform];
  if (platformFlags.length > 1 || platformFlags.some(flag => flag !== nativeFlag)) {
    throw new Error("Build each platform on its native operating system. See docs/desktop-distribution.md.");
  }
  const manifest = JSON.parse(await readFile(resolve(desktop, "package.json"), "utf8"));
  releaseVersion(manifest.version, process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
  pnpm(["exec", "turbo", "run", "build", "--filter=@banger/desktop..."], root);
  await stageApp();
  // Never discover a developer's personal signing identity by accident.
  process.env.CSC_IDENTITY_AUTO_DISCOVERY ??= "false";
  pnpm(["exec", "electron-builder", "--config", "electron-builder.mjs", "--publish", "never", ...args], desktop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
