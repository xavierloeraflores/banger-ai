import { compileMusic } from "@banger/compiler";
import type { ProjectFolder, WorkspaceBridge } from "./project-workspace";

type FileHandle = { kind: "file"; getFile(): Promise<File>; createWritable(): Promise<{ write(source: string): Promise<void>; close(): Promise<void> }> };
type Directory = {
  kind: "directory";
  name: string;
  values(): AsyncIterable<Directory | (FileHandle & { name: string })>;
  getDirectoryHandle(name: string, options?: { create: boolean }): Promise<Directory>;
  getFileHandle(name: string, options?: { create: boolean }): Promise<FileHandle>;
};
declare global { interface Window { showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<Directory> } }
let root: Directory | undefined;
async function pick() {
  if (!window.showDirectoryPicker) throw new Error("Folder projects need a browser with folder access, such as Chrome or Edge, or the desktop app.");
  try { return await window.showDirectoryPicker({ mode: "readwrite" }); }
  catch (error) { if ((error as Error).name === "AbortError") return null; throw error; }
}
function current() { if (!root) throw new Error("Open a project folder first."); return root; }
async function target(path: string) {
  const parts = path.split("/");
  if (!path.endsWith(".banger") || parts.some(part => !part || part.startsWith(".") || /[\\\0]/.test(part))) throw new Error("Choose a song inside this project.");
  let directory = current();
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  return { directory, name: parts.at(-1)! };
}
async function list(directory = current(), prefix = "", depth = 0): Promise<string[]> {
  if (depth > 12) throw new Error("The project has too many nested folders.");
  const paths: string[] = [];
  for await (const entry of directory.values()) {
    if (entry.name.startsWith(".") || ["node_modules", "dist"].includes(entry.name)) continue;
    if (entry.kind === "directory") paths.push(...await list(entry, `${prefix}${entry.name}/`, depth + 1));
    else if (entry.name.endsWith(".banger")) paths.push(`${prefix}${entry.name}`);
    if (paths.length > 256) throw new Error("Open a smaller project with at most 256 songs.");
  }
  return paths.sort();
}
async function read(path: string) {
  const { directory, name } = await target(path);
  const file = await (await directory.getFileHandle(name)).getFile();
  if (file.size > 65536) throw new Error("Songs must be under 64 KiB.");
  return { path, source: await file.text() };
}
async function adopt(directory: Directory): Promise<ProjectFolder> {
  const previous = root;
  root = directory;
  try { const paths = await list(); return { name: directory.name, paths, file: paths[0] ? await read(paths[0]) : null }; }
  catch (error) { root = previous; throw error; }
}
const browserWorkspace: WorkspaceBridge = {
  async open() { const directory = await pick(); return directory ? adopt(directory) : null; },
  async create(name, source) {
    const folderName = window.prompt("Project folder name", name ? name.replace(/\.banger$/i, "") + " Project" : "New Project")?.trim();
    if (!folderName) return null;
    if (folderName.startsWith(".") || /[\\/:*?"<>|\0]/.test(folderName)) throw new Error("Use a folder name without slashes or special characters.");
    if (source !== undefined) compileMusic(source);
    const parent = await pick();
    if (!parent) return null;
    try { await parent.getDirectoryHandle(folderName); throw new Error("That folder already exists. Choose a new project folder name."); }
    catch (error) { if ((error as Error).name !== "NotFoundError") throw error; }
    const directory = await parent.getDirectoryHandle(folderName, { create: true });
    const previous = root;
    root = directory;
    try {
      const file = name !== undefined && source !== undefined ? await browserWorkspace.save(name, source, null) : null;
      return { name: directory.name, paths: file ? [file.path] : [], file };
    }
    catch (error) { root = previous; throw error; }
  },
  activate: async () => {},
  list: () => list(),
  read,
  async save(path, source, expected) {
    if (new TextEncoder().encode(source).length > 65536 || source.includes("\0")) throw new Error("Songs must be text under 64 KiB.");
    compileMusic(source);
    const { directory, name } = await target(path);
    let previous: string | null = null;
    try { previous = (await read(path)).source; }
    catch (error) { if ((error as Error).name !== "NotFoundError") throw error; }
    if (previous !== expected) throw new Error("The file changed. Reload it before saving.");
    const stream = await (await directory.getFileHandle(name, { create: true })).createWritable();
    await stream.write(source); await stream.close();
    return { path, source };
  },
  run: async () => ({ ok: false, error: "The project agent is available in the desktop app." }),
  cancel: async () => {},
  onEvent: () => () => {},
};
export function getProjectWorkspace(): WorkspaceBridge { return window.bangerWorkspace ?? browserWorkspace; }
