import { app, BrowserWindow, dialog, ipcMain, protocol, session, type IpcMainInvokeEvent } from "electron";
import { access, open, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_URL, isAppUrl, serveApp } from "./static-app.js";
import { MAX_PROJECT_BYTES, projectName, requireProjectExtension, validateSource } from "./project-files.js";

protocol.registerSchemesAsPrivileged([{ scheme: "banger", privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

const developmentUrl = !app.isPackaged && process.env.BANGER_DEV_URL === "http://127.0.0.1:3000"
  ? process.env.BANGER_DEV_URL : undefined;
const windows = new Set<BrowserWindow>();
const pendingDialogs = new Set<number>();
const filters = [{ name: "Banger project", extensions: ["banger"] }];

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !windows.has(window) || event.senderFrame !== event.sender.mainFrame ||
      !isAppUrl(event.senderFrame.url, developmentUrl)) {
    throw new Error("Project files are available only from the Banger app.");
  }
  if (pendingDialogs.has(window.id)) throw new Error("A project dialog is already open.");
  return window;
}

function installProjectHandlers() {
  ipcMain.handle("banger:open-project", async (event) => {
    const window = senderWindow(event);
    pendingDialogs.add(window.id);
    try {
      const result = await dialog.showOpenDialog(window, { title: "Open Banger project", filters, properties: ["openFile"] });
      if (result.canceled || !result.filePaths[0]) return null;
      const path = result.filePaths[0];
      requireProjectExtension(path);
      const file = await open(path, "r");
      try {
        const stat = await file.stat();
        if (!stat.isFile()) throw new Error("Choose a regular project file.");
        if (stat.size > MAX_PROJECT_BYTES) throw new Error("Projects must be 5 MB or smaller.");
        const buffer = Buffer.alloc(MAX_PROJECT_BYTES + 1);
        let size = 0;
        while (size < buffer.length) {
          const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
          if (!bytesRead) break;
          size += bytesRead;
        }
        if (size > MAX_PROJECT_BYTES) throw new Error("Projects must be 5 MB or smaller.");
        let source: string;
        try { source = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)); }
        catch { throw new Error("The project must contain valid UTF-8 text."); }
        return { name: basename(path), source: validateSource(source) };
      } finally { await file.close(); }
    } catch (error) {
      throw new Error(readableError(error, "Could not open the project."));
    } finally { pendingDialogs.delete(window.id); }
  });
  ipcMain.handle("banger:save-project", async (event, source: unknown, name: unknown) => {
    const window = senderWindow(event);
    const text = validateSource(source);
    const defaultPath = projectName(name);
    pendingDialogs.add(window.id);
    try {
      const result = await dialog.showSaveDialog(window, { title: "Save Banger project", defaultPath, filters });
      if (result.canceled || !result.filePath) return null;
      // The renderer receives a filename, never the privileged path.
      const path = extname(result.filePath) ? result.filePath : `${result.filePath}.banger`;
      requireProjectExtension(path);
      if (path !== result.filePath) {
        let exists = false;
        try { await access(path); exists = true; }
        catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        }
        if (exists) {
          const confirmation = await dialog.showMessageBox(window, {
            type: "question", title: "Replace project?",
            message: `Replace "${basename(path)}"?`,
            detail: "A project with this name already exists.",
            buttons: ["Cancel", "Replace"], defaultId: 0, cancelId: 0,
          });
          if (confirmation.response !== 1) return null;
        }
      }
      await writeFile(path, text, "utf8");
      return { name: basename(path) };
    } catch (error) {
      throw new Error(readableError(error, "Could not save the project."));
    } finally { pendingDialogs.delete(window.id); }
  });
}

function readableError(error: unknown, fallback: string): string {
  // Node filesystem errors contain absolute paths. Keep those in the main process.
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "EACCES" || error.code === "EPERM") return `${fallback} Permission denied.`;
    if (error.code === "ENOENT") return `${fallback} The file no longer exists.`;
    if (error.code === "ENOSPC") return `${fallback} The disk is full.`;
    return fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 960, minHeight: 640,
    backgroundColor: "#0b0d12", title: "Banger",
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  });
  windows.add(window);
  window.on("closed", () => windows.delete(window));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url, developmentUrl)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isAppUrl(url, developmentUrl)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  void window.loadURL(developmentUrl ?? APP_URL).catch((error: unknown) => {
    console.error("Failed to load the Banger UI:", error);
    dialog.showErrorBox("Banger could not start", "Build the application with pnpm fullbuild, or start development with pnpm dev:desktop.");
  });
}

void app.whenReady().then(() => {
  protocol.handle("banger", (request) => serveApp(request, fileURLToPath(new URL("./web/", import.meta.url))));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  installProjectHandlers();
  createWindow();
  app.on("activate", () => { if (windows.size === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
