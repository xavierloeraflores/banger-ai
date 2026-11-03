import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));

export function readWorkspaces(directory = root) {
  return ["apps", "packages"].flatMap(parent =>
    readdirSync(resolve(directory, parent), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => {
        const path = `${parent}/${entry.name}`;
        const manifest = JSON.parse(readFileSync(resolve(directory, path, "package.json"), "utf8"));
        return { path, ...manifest };
      }));
}

export const suites = {
  tooling: { paths: ["scripts/"], description: "Development launcher and test selection" },
  compiler: { workspace: "@banger/compiler", description: "Parser, songs, mixer, synth and performance" },
  engine: { workspace: "@banger/engine", description: "Audio engine unit tests" },
  stage: { workspace: "@banger/stage", description: "Character rig and music-driven performance" },
  agent: { workspace: "@banger/agent", description: "Model adapters and generation" },
  harness: { workspace: "@banger/harness", description: "Project files and agent CLI" },
  elevenlabs: { workspace: "@banger/elevenlabs", description: "Music provider and fixtures" },
  desktop: {
    workspace: "@banger/desktop",
    paths: ["apps/www/src/lib/ai-providers.ts"],
    description: "Native files, security, accounts and providers",
  },
  web: { workspace: "@banger/www", description: "Browser files, lint and TypeScript" },
  "api-unit": {
    workspace: "@banger/api",
    excludeDependencies: ["@banger/www", "@banger/shadcn", "@banger/engine"],
    description: "Authentication, validation, sessions and sandbox runner without a database",
  },
  "api-integration": {
    workspace: "@banger/api", database: true,
    description: "PostgreSQL, jobs, permissions and production HTTP routes",
  },
};

function dependencies(workspace, workspaces, excluded = [], found = new Set()) {
  if (found.has(workspace) || excluded.includes(workspace)) return found;
  found.add(workspace);
  const manifest = workspaces.find(item => item.name === workspace);
  for (const name of Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies, ...manifest?.peerDependencies })) {
    if (workspaces.some(item => item.name === name)) dependencies(name, workspaces, excluded, found);
  }
  return found;
}

const matches = (file, path) => path.endsWith("/") ? file.startsWith(path) : file === path;
// Only known prose is ignored. LANGUAGE.md is loaded by agents at runtime.
const documentation = file => /(^|\/)(README|AGENTS)\.md$/.test(file) || file.startsWith("docs/") && /\.md$/.test(file);

export function selectSuites(files, workspaces = readWorkspaces()) {
  const selected = new Set();
  for (const file of files) {
    if (documentation(file)) continue;
    if (["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json", "scripts/test-suites.mjs", "scripts/test-suites.test.mjs"].includes(file)
      || file.startsWith(".github/") || file.endsWith("/package.json")) return Object.keys(suites);
    const owner = workspaces.find(item => file.startsWith(`${item.path}/`));
    let covered = false;
    for (const [name, suite] of Object.entries(suites)) {
      if ((suite.paths ?? []).some(path => matches(file, path))
        || owner && suite.workspace && dependencies(suite.workspace, workspaces, suite.excludeDependencies).has(owner.name)
        || file.startsWith("examples/") && suite.workspace) {
        selected.add(name);
        covered = true;
      }
    }
    // New or unclassified code must never silently bypass tests.
    if (!covered) return Object.keys(suites);
  }
  return Object.keys(suites).filter(name => selected.has(name));
}

export function changedFiles({ base = "main", head, cwd = root } = {}) {
  const git = args => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
  // Disable rename detection so both the old and new owners get tested.
  const files = git(["diff", "--name-only", "--no-renames", "-z", `${base}...${head ?? "HEAD"}`, "--"]);
  if (!head) {
    files.push(...git(["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"]));
    files.push(...git(["ls-files", "--others", "--exclude-standard", "-z"]));
  }
  return [...new Set(files)];
}

export function buildWorkspaces(names, workspaces = readWorkspaces()) {
  const required = new Set();
  for (const name of names) {
    const suite = suites[name];
    if (suite.workspace) {
      for (const dependency of dependencies(suite.workspace, workspaces, suite.excludeDependencies)) required.add(dependency);
    }
  }
  return workspaces.filter(item => required.has(item.name) && item.path.startsWith("packages/") && item.scripts?.build).map(item => item.name);
}

function run(command, args, env = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with ${result.signal ?? result.status}`);
}

export function runSuites(names) {
  if (names.includes("api-integration") && !process.env.DATABASE_URL) {
    throw new Error("api-integration requires DATABASE_URL pointing to a dedicated test database. The suite applies migrations. See docs/testing.md.");
  }
  const libraries = buildWorkspaces(names);
  if (libraries.length) run("pnpm", [...libraries.flatMap(name => ["--filter", name]), "-r", "run", "build"], { NODE_ENV: "production" });
  for (const name of names) {
    console.log(`\nRunning ${name}: ${suites[name].description}`);
    if (name === "tooling") {
      const files = readdirSync(resolve(root, "scripts")).filter(file => file.endsWith(".test.mjs")).map(file => `scripts/${file}`);
      run(process.execPath, ["--test", ...files]);
    } else if (name === "web") {
      for (const task of ["test", "lint", "typecheck"]) run("pnpm", ["--filter", "@banger/www", task], { NODE_ENV: "production" });
    } else if (name === "api-unit") {
      run("pnpm", ["--filter", "@banger/api", "test:unit"], { DATABASE_URL: "", BANGER_HTTP_TEST: "" });
    } else if (name === "api-integration") {
      run("pnpm", ["--filter", "@banger/api", "build"], { NODE_ENV: "production" });
      run("pnpm", ["--filter", "@banger/api", "migrate"]);
      run("pnpm", ["--filter", "@banger/api", "test"], { NODE_ENV: "production", BANGER_HTTP_TEST: "1" });
    } else {
      run("pnpm", ["--filter", suites[name].workspace, "test"]);
    }
  }
}

export function main(args = process.argv.slice(2)) {
  let base = "main", head, all = false, list = false, json = false;
  const requested = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (["--base", "--head", "--suite"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--base") base = value;
      if (arg === "--head") head = value;
      if (arg === "--suite") requested.push(value);
    } else if (arg === "--all") all = true;
    else if (arg === "--list") list = true;
    else if (arg === "--json") { json = true; list = true; }
    else throw new Error(`Unknown option: ${arg}`);
  }
  for (const name of requested) if (!suites[name]) throw new Error(`Unknown suite: ${name}. Choose ${Object.keys(suites).join(", ")}`);
  if (all && requested.length) throw new Error("Use --all or --suite, not both");
  const names = all ? Object.keys(suites) : requested.length ? [...new Set(requested)] : selectSuites(changedFiles({ base, head }));
  if (json) console.log(JSON.stringify(names));
  else {
    console.log(names.length ? `Selected suites: ${names.join(", ")}` : "No relevant tests for these changes.");
    if (!list) runSuites(names);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
