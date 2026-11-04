import { projectRecord } from './library-records.js';
import type { EditPermissions } from "@banger/agent";
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { basename, join } from "node:path";
import { mkdir, rmdir, readFile, writeFile, rename } from "node:fs/promises";
import { projectName } from "./project-files.js";
import { openProject, ProjectSession, type ProjectWorkspace, type SelectedModel, type HarnessEvent } from "@banger/harness";

// Model errors can contain provider headers, and filesystem errors contain absolute paths.
function safeError(error: unknown, fallback: string): string {
  if (error instanceof Error && !('code' in error) && !/[\\/]|https?:|Bearer|api.?key/i.test(error.message)) return error.message.slice(0, 400);
  return fallback;
}

type State = { id: string; workspace: ProjectWorkspace; sessions: Map<string, ProjectSession>; controllers: Map<string, AbortController> };
export function installWorkspaceHandlers(options: {
  senderWindow(event: IpcMainInvokeEvent): BrowserWindow;
  selectModel(): Promise<SelectedModel>;
  onOpen?(window: BrowserWindow, root: string): void;
  modelError?(error: unknown): string;
}) {
  const states = new Map<number, State>();
  const projects = new Map<number, Map<string, State>>();
  type Recent = { id: string; root: string; name: string; openedAt: number };
  const recentPath = join(app.getPath("userData"), "recent-projects.json");
  let recents: Recent[] = [];
  const ready = readFile(recentPath, "utf8").then(text => {
    const value = JSON.parse(text);
    if (Array.isArray(value)) recents = value.filter(item => typeof item?.id === "string" && typeof item.root === "string" && typeof item.name === "string" && Number.isFinite(item.openedAt));
  }).catch(() => {});
  let writing = Promise.resolve();
  async function remember(workspace: ProjectWorkspace) {
    await ready;
    const existing = recents.find(item => item.root === workspace.root);
    const item = { id: existing?.id ?? crypto.randomUUID(), root: workspace.root, name: basename(workspace.root), openedAt: Date.now() };
    recents = [item, ...recents.filter(value => value.id !== item.id)];
    const text = JSON.stringify(recents);
    writing = writing.catch(() => {}).then(async () => {
      await mkdir(app.getPath("userData"), { recursive: true });
      await writeFile(`${recentPath}.tmp`, text, { mode: 0o600 });
      await rename(`${recentPath}.tmp`, recentPath);
    });
    await writing;
    return item.id;
  }
  const opening = new Set<number>();
  function state(window: BrowserWindow, id?: unknown) {
    const value = id === undefined ? states.get(window.id) : typeof id === "string" ? projects.get(window.id)?.get(id) : undefined;
    if (!value) throw new Error("Open a project folder first.");
    return value;
  }
  const send = (window: BrowserWindow, event: HarnessEvent, projectId: string, threadId: string) => {
    if (window.isDestroyed()) return;
    const visible = { ...event, projectId, threadId };
    if ("path" in visible && visible.path && (visible.path.startsWith("/") || visible.path.includes("..") || visible.path.includes("\\"))) delete visible.path;
    if (visible.type === "tool-result" && visible.error && visible.error !== `${visible.path} is being edited in another chat.`) visible.error = safeError(new Error(visible.error), "Project operation failed. Inspect the music file and retry.");
    // The studio file picker accepts music only; lyric tool activity still reaches chat.
    if (visible.type === "file-changed" && !visible.file.path.endsWith(".banger")) return;
    window.webContents.send("banger:workspace-event", visible);
  };
  async function adopt(window: BrowserWindow, workspace: ProjectWorkspace) {
    const id = await remember(workspace);
    if (!projects.has(window.id)) {
      projects.set(window.id, new Map());
      const cancel = () => { for (const item of projects.get(window.id)?.values() ?? []) for (const controller of item.controllers.values()) controller.abort(); };
      window.once("closed", () => { cancel(); states.delete(window.id); projects.delete(window.id); });
      window.webContents.on("did-start-navigation", (_event, _url, _inPlace, main) => { if (main) cancel(); });
    }
    const known = projects.get(window.id)!;
    if (!known.has(id)) known.set(id, { id, workspace, sessions: new Map(), controllers: new Map() });
    states.set(window.id, known.get(id)!);
    options.onOpen?.(window, workspace.root);
    return id;
  }
  ipcMain.handle("banger:workspace-recent", async event => {
    options.senderWindow(event); await ready;
    return recents.slice(0, 30).map(({ id, name, openedAt }) => ({ id, name, openedAt }));
  });
  ipcMain.handle("banger:workspace-restore", async (event, id: unknown) => {
    const window = options.senderWindow(event); await ready;
    const recent = recents.find(item => item.id === id);
    if (!recent) throw new Error("Open this project folder again to reconnect it.");
    try {
      const workspace = projects.get(window.id)?.get(recent.id)?.workspace ?? await openProject(recent.root);
      const paths = await workspace.list();
      const file = paths[0] ? await workspace.read(paths[0]) : null;
      await adopt(window, workspace);
      return { id: recent.id, name: recent.name, paths, file };
    } catch { throw new Error("This project is unavailable. Open its folder again if it moved."); }
  });
  ipcMain.handle("banger:workspace-create", async (event, name: unknown, source: unknown) => {
    const window = options.senderWindow(event);
    if (opening.has(window.id)) throw new Error("Stop the current task before creating another project.");
    if (!(name === undefined && source === undefined) && (typeof name !== "string" || typeof source !== "string")) throw new Error("Invalid project song.");
    opening.add(window.id);
    try {
      const picked = await dialog.showSaveDialog(window, { title: "Create project folder", buttonLabel: "Create project", defaultPath: typeof name === "string" ? projectName(name).replace(/\.banger$/, "") : "New Project", properties: ["createDirectory"] });
      if (picked.canceled || !picked.filePath) return null;
      try { await mkdir(picked.filePath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("That folder already exists. Choose a new project folder name.");
        throw error;
      }
      try {
        const workspace = await openProject(picked.filePath);
        const file = typeof name === "string" && typeof source === "string" ? await workspace.write(projectName(name), source, null) : null;
        if (window.isDestroyed()) return null;
        const id = await adopt(window, workspace);
        return { id, name: basename(workspace.root), paths: file ? [file.path] : [], file };
      } catch (error) {
        // Only remove a failed, empty creation. Never remove user files.
        await rmdir(picked.filePath).catch(() => {});
        throw error;
      }
    } catch (error) { throw new Error(safeError(error, "Could not create the project folder.")); }
    finally { opening.delete(window.id); }
  });
  ipcMain.handle("banger:workspace-open", async event => {
    const window = options.senderWindow(event);
    if (opening.has(window.id)) throw new Error("Stop the current task before opening another project.");
    opening.add(window.id);
    try {
      const picked = await dialog.showOpenDialog(window, { title: "Open music project folder", properties: ["openDirectory"] });
      if (picked.canceled || !picked.filePaths[0]) return null;
      const workspace = await openProject(picked.filePaths[0]);
      const paths = await workspace.list();
      if (window.isDestroyed()) return null;
      const file = paths[0] ? await workspace.read(paths[0]) : null;
      const id = await adopt(window, workspace);
      return { id, name: basename(workspace.root), paths, file };
    } catch (error) { throw new Error(safeError(error, "Could not open the music folder.")); }
    finally { opening.delete(window.id); }
  });
  ipcMain.handle("banger:workspace-activate", (event, id: unknown) => {
    const window = options.senderWindow(event);
    const current = state(window, id);
    states.set(window.id, current);
    options.onOpen?.(window, current.workspace.root);
  });
  ipcMain.handle("banger:workspace-list", async event => {
    const current = state(options.senderWindow(event));
    try { return await current.workspace.list(); }
    catch (error) { throw new Error(safeError(error, "Could not list the project files. Reopen the folder.")); }
  });
  ipcMain.handle("banger:workspace-read", async (event, path: unknown, id: unknown) => {
    const current = state(options.senderWindow(event), id);
    if (typeof path !== "string") throw new Error("Choose a music file.");
    try { return await current.workspace.read(path); }
    catch (error) { throw new Error(safeError(error, "Could not read the project file.")); }
  });
  ipcMain.handle("banger:workspace-save", async (event, path: unknown, source: unknown, expected: unknown) => {
    const current = state(options.senderWindow(event));
    if (current.controllers.size) throw new Error("Stop the project task before saving manual edits.");
    if (typeof path !== "string" || typeof source !== "string" || (expected !== null && typeof expected !== "string")) throw new Error("Invalid project edit.");
    try { return await current.workspace.write(path, source, expected); }
    catch (error) { throw new Error(safeError(error, "Could not save the file. Reload it to check for external changes.")); }
  });
  ipcMain.handle("banger:workspace-cancel", (event, id: unknown, threadId: unknown) => {
    const current = state(options.senderWindow(event), id);
    if (typeof threadId === 'string') current.controllers.get(threadId)?.abort();
    else for (const controller of current.controllers.values()) controller.abort();
  });
  ipcMain.handle("banger:workspace-run", async (event, prompt: unknown, activeFile: unknown, resetHistory: unknown, permissions: unknown, id: unknown, threadId: unknown, history: unknown) => {
    const window = options.senderWindow(event);
    const current = state(window, id);
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 16000 || (activeFile !== undefined && typeof activeFile !== "string")) return { ok: false, error: "Enter a task under 16,000 characters and choose a music file." };
    const thread = typeof threadId === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(threadId) ? threadId : "default";
    if (current.controllers.has(thread) || opening.has(window.id)) return { ok: false, error: "A project operation is already running." };
    const controller = new AbortController();
    current.controllers.set(thread, controller);
    if (resetHistory === true) current.sessions.delete(thread);
    try {
      const selected = await options.selectModel();
      await projectRecord(current.workspace.root, prompt);
      controller.signal.throwIfAborted();
      // Keep task history, but refresh provider credentials and model selection each run.
      let session = current.sessions.get(thread);
      if (!session) { session = new ProjectSession({ workspace: current.workspace, selected, history: Array.isArray(history) ? history.slice(-10).filter(item => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string").map(item => ({ role: item.role as "user" | "assistant", content: item.content.slice(0, 16000) })) : undefined, onEvent: event => send(window, event, current.id, thread) }); current.sessions.set(thread, session); }
      else Object.assign(session.selected, { timeoutMs: undefined, providerOptions: undefined, ...selected });
      return { ok: true, reply: await session.run(prompt, { signal: controller.signal, activeFile, permissions: permissions as EditPermissions | undefined }) };
    } catch (error) {
      return { ok: false, error: controller.signal.aborted ? "Project task stopped. Completed saves are kept." : (options.modelError?.(error) ?? "Project task failed. Check the selected model and connection.") };
    } finally { current.controllers.delete(thread); }
  });
  return { cancelAll: () => { for (const group of projects.values()) for (const current of group.values()) for (const controller of current.controllers.values()) controller.abort(); } };
}
