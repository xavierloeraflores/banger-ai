import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { basename } from "node:path";
import { openProject, ProjectSession, type ProjectWorkspace, type SelectedModel, type HarnessEvent } from "@banger/harness";

// Model errors can contain provider headers, and filesystem errors contain absolute paths.
function safeError(error: unknown, fallback: string): string {
  if (error instanceof Error && !('code' in error) && !/[\\/]|https?:|Bearer|api.?key/i.test(error.message)) return error.message.slice(0, 400);
  return fallback;
}

type State = { workspace: ProjectWorkspace; session?: ProjectSession; controller?: AbortController; };
export function installWorkspaceHandlers(options: {
  senderWindow(event: IpcMainInvokeEvent): BrowserWindow;
  selectModel(): Promise<SelectedModel>;
}) {
  const states = new Map<number, State>();
  const opening = new Set<number>();
  function state(window: BrowserWindow) {
    const value = states.get(window.id);
    if (!value) throw new Error("Open a project folder first.");
    return value;
  }
  const send = (window: BrowserWindow, event: HarnessEvent) => {
    if (window.isDestroyed()) return;
    const visible = { ...event };
    if ("path" in visible && visible.path && (visible.path.startsWith("/") || visible.path.includes("..") || visible.path.includes("\\"))) delete visible.path;
    if (visible.type === "tool-result" && visible.error) visible.error = safeError(new Error(visible.error), "Project operation failed. Inspect the music file and retry.");
    window.webContents.send("banger:workspace-event", visible);
  };
  ipcMain.handle("banger:workspace-open", async event => {
    const window = options.senderWindow(event);
    if (opening.has(window.id) || states.get(window.id)?.controller) throw new Error("Stop the current task before opening another project.");
    opening.add(window.id);
    try {
      const picked = await dialog.showOpenDialog(window, { title: "Open music project folder", properties: ["openDirectory"] });
      if (picked.canceled || !picked.filePaths[0]) return null;
      const workspace = await openProject(picked.filePaths[0]);
      const paths = await workspace.list();
      if (window.isDestroyed()) return null;
      if (!states.has(window.id)) {
        window.once("closed", () => { states.get(window.id)?.controller?.abort(); states.delete(window.id); });
        window.webContents.on("did-start-navigation", (_event, _url, _inPlace, main) => { if (main) states.get(window.id)?.controller?.abort(); });
      }
      states.set(window.id, { workspace });
      return { name: basename(workspace.root), paths };
    } catch (error) { throw new Error(safeError(error, "Could not open the music folder.")); }
    finally { opening.delete(window.id); }
  });
  ipcMain.handle("banger:workspace-list", async event => {
    const current = state(options.senderWindow(event));
    try { return await current.workspace.list(); }
    catch (error) { throw new Error(safeError(error, "Could not list the project files. Reopen the folder.")); }
  });
  ipcMain.handle("banger:workspace-read", async (event, path: unknown) => {
    const current = state(options.senderWindow(event));
    if (typeof path !== "string") throw new Error("Choose a music file.");
    try { return await current.workspace.read(path); }
    catch (error) { throw new Error(safeError(error, "Could not read the project file.")); }
  });
  ipcMain.handle("banger:workspace-save", async (event, path: unknown, source: unknown, expected: unknown) => {
    const current = state(options.senderWindow(event));
    if (current.controller) throw new Error("Stop the project task before saving manual edits.");
    if (typeof path !== "string" || typeof source !== "string" || (expected !== null && typeof expected !== "string")) throw new Error("Invalid project edit.");
    try { return await current.workspace.write(path, source, expected); }
    catch (error) { throw new Error(safeError(error, "Could not save the file. Reload it to check for external changes.")); }
  });
  ipcMain.handle("banger:workspace-cancel", event => { state(options.senderWindow(event)).controller?.abort(); });
  ipcMain.handle("banger:workspace-run", async (event, prompt: unknown, activeFile: unknown) => {
    const window = options.senderWindow(event);
    const current = state(window);
    if (current.controller || opening.has(window.id)) return { ok: false, error: "A project operation is already running." };
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 16000 || (activeFile !== undefined && typeof activeFile !== "string")) return { ok: false, error: "Enter a task under 16,000 characters and choose a music file." };
    const controller = new AbortController();
    current.controller = controller;
    try {
      const selected = await options.selectModel();
      controller.signal.throwIfAborted();
      // Keep task history, but refresh provider credentials and model selection each run.
      if (!current.session) current.session = new ProjectSession({ workspace: current.workspace, selected, onEvent: event => send(window, event) });
      else Object.assign(current.session.selected, selected);
      return { ok: true, reply: await current.session.run(prompt, { signal: controller.signal, activeFile }) };
    } catch (error) {
      return { ok: false, error: controller.signal.aborted ? "Project task stopped. Completed saves are kept." : safeError(error, "Project task failed. Check the selected model and connection.") };
    } finally { delete current.controller; }
  });
  return { cancelAll: () => { for (const current of states.values()) current.controller?.abort(); } };
}
