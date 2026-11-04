import { compileMusic } from "@banger/compiler";
import type { ProjectFolder, WorkspaceBridge, RecentProject } from "./project-workspace";

type FileHandle = { kind: "file"; getFile(): Promise<File>; createWritable(): Promise<{ write(source: string): Promise<void>; close(): Promise<void> }> };
type Directory = {
  kind: "directory";
  isSameEntry?(other: Directory): Promise<boolean>;
  requestPermission?(options: { mode: "readwrite" }): Promise<string>;
  name: string;
  values(): AsyncIterable<Directory | (FileHandle & { name: string })>;
  getDirectoryHandle(name: string, options?: { create: boolean }): Promise<Directory>;
  getFileHandle(name: string, options?: { create: boolean }): Promise<FileHandle>;
};
declare global { interface Window { showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<Directory> } }
let root: Directory | undefined;
type StoredProject = RecentProject & { directory: Directory };
const directories = new Map<string, StoredProject>();
async function database(): Promise<IDBDatabase | null> {
  if (!window.indexedDB) return null;
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open("banger-projects", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("recent", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function recent() {
  const db = await database();
  if (db) try {
    const stored = await new Promise<StoredProject[]>((resolve, reject) => {
      const request = db.transaction("recent").objectStore("recent").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const item of stored) directories.set(item.id, item);
  } finally { db.close(); }
  return [...directories.values()].sort((a, b) => b.openedAt - a.openedAt);
}
async function remember(directory: Directory) {
  const previous = await recent();
  let known: StoredProject | undefined;
  for (const item of previous) if (item.directory === directory || await directory.isSameEntry?.(item.directory)) { known = item; break; }
  const item = { id: known?.id ?? (window.crypto?.randomUUID() ?? `${Date.now()}-${Math.random()}`), name: directory.name, directory, openedAt: Date.now() };
  directories.set(item.id, item);
  const db = directory.isSameEntry ? await database() : null;
  if (db) try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("recent", "readwrite");
      transaction.objectStore("recent").put(item);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
  return item.id;
}
async function pick() {
  if (!window.showDirectoryPicker) throw new Error("Folder projects need a browser with folder access, such as Chrome or Edge, or the desktop app.");
  try { return await window.showDirectoryPicker({ mode: "readwrite" }); }
  catch (error) { if ((error as Error).name === "AbortError") return null; throw error; }
}
function current() { if (!root) throw new Error("Open a project folder first."); return root; }
async function target(path: string, projectId?: string) {
  const parts = path.split("/");
  if (!path.endsWith(".banger") || parts.some(part => !part || part.startsWith(".") || /[\\\0]/.test(part))) throw new Error("Choose a song inside this project.");
  let directory = projectId ? directories.get(projectId)?.directory : current();
  if (!directory) throw new Error("Reopen this project first.");
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
async function read(path: string, projectId?: string) {
  const { directory, name } = await target(path, projectId);
  const file = await (await directory.getFileHandle(name)).getFile();
  if (file.size > 65536) throw new Error("Songs must be under 64 KiB.");
  return { path, source: await file.text() };
}
async function adopt(directory: Directory): Promise<ProjectFolder> {
  const previous = root;
  root = directory;
  try { const paths = await list(); return { id: await remember(directory), name: directory.name, paths, file: paths[0] ? await read(paths[0]) : null }; }
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
      return { id: await remember(directory), name: directory.name, paths: file ? [file.path] : [], file };
    }
    catch (error) { root = previous; throw error; }
  },
  recent: async () => (await recent()).slice(0, 30).map(({ id, name, openedAt }) => ({ id, name, openedAt })),
  async restore(id) {
    const item = (await recent()).find(item => item.id === id);
    if (!item) throw new Error("Open this project folder again to reconnect it.");
    if (item.directory.requestPermission && await item.directory.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("Allow folder access to reopen this project.");
    return adopt(item.directory);
  },
  activate: async id => { if (id) { const item = directories.get(id); if (!item) throw new Error("Reopen this project first."); root = item.directory; } },
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
