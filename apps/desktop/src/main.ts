import { app, BrowserWindow, dialog, ipcMain, protocol, session, safeStorage, shell, type IpcMainInvokeEvent } from "electron";
import { access, open, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_URL, getDevelopmentUrl, isAppUrl, serveApp } from "./static-app.js";
import { MAX_PROJECT_BYTES, projectName, requireProjectExtension, validateSource } from "./project-files.js";
import { parseChatRequest, selectModel, selectLocalModel, runBangerAgent, publicAIError } from "@banger/agent";
import { createAISettingsStore } from "./ai-settings.js";
import { createChatGPTAuth, ChatGPTError, publicChatGPTError } from "./chatgpt-auth.js";
import { createLocalModel } from "./local-model.js";

import { installWorkspaceHandlers } from "./project-workspace.js";

protocol.registerSchemesAsPrivileged([{ scheme: "banger", privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

const developmentUrl = getDevelopmentUrl(process.env.BANGER_DEV_URL, app.isPackaged);
const windows = new Set<BrowserWindow>();
const pendingDialogs = new Set<number>();
const pendingChats = new Map<number, AbortController>();
const filters = [{ name: "Banger project", extensions: ["banger"] }];

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !windows.has(window) || event.senderFrame !== event.sender.mainFrame ||
      !isAppUrl(event.senderFrame.url, developmentUrl)) {
    throw new Error("This operation is available only from the Banger app.");
  }
  return window;
}

function installProjectHandlers() {
  ipcMain.handle("banger:open-project", async (event) => {
    const window = senderWindow(event);
    if (pendingDialogs.has(window.id)) throw new Error("A project dialog is already open.");
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
    if (pendingDialogs.has(window.id)) throw new Error("A project dialog is already open.");
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
  window.on("closed", () => {
    pendingChats.get(window.id)?.abort();
    pendingChats.delete(window.id);
    windows.delete(window);
  });
  window.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) pendingChats.get(window.id)?.abort();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: "question", title: "Unsaved project",
      message: "Discard unsaved changes?",
      detail: "Your project has changes that have not been saved.",
      buttons: ["Cancel", "Discard"], defaultId: 0, cancelId: 0,
    });
    // This event's default preserves the page. Only explicit discard permits unloading.
    if (choice === 1) event.preventDefault();
  });
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
  if (!hasSingleInstanceLock) return;
  app.on("second-instance", () => {
    const window = [...windows][0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  const localModel = createLocalModel(join(app.getPath("userData"), "local-model"));
  app.on("before-quit", () => localModel.dispose());
  protocol.handle("banger", (request) => serveApp(request, fileURLToPath(new URL("./web/", import.meta.url))));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const encryption = {
    isAvailable: async () => await safeStorage.isAsyncEncryptionAvailable() &&
      (process.platform !== "linux" || (safeStorage.isEncryptionAvailable() &&
        safeStorage.getSelectedStorageBackend() !== "basic_text")),
    encrypt: (value: string) => safeStorage.encryptStringAsync(value),
    decrypt: async (value: Buffer) => (await safeStorage.decryptStringAsync(value)).result,
  };
  const aiSettings = createAISettingsStore(join(app.getPath("userData"), "ai-settings.enc"), encryption);
  const chatgpt = createChatGPTAuth(join(app.getPath("userData"), "chatgpt-accounts.enc"), encryption, { openExternal: url => shell.openExternal(url) });
  app.on("before-quit", () => chatgpt.dispose());
  function cancelAI() {
    for (const controller of pendingChats.values()) controller.abort();
    projectWorkspace.cancelAll();
  }
  ipcMain.handle("banger:chatgpt-status", event => { senderWindow(event); return chatgpt.status(); });
  ipcMain.handle("banger:chatgpt-sign-in", async (event, id: unknown) => {
    senderWindow(event);
    try {
      const result = await chatgpt.signIn(id);
      if (result.selected) { cancelAI(); await localModel.select(false); }
      return result;
    } catch { throw new Error("ChatGPT sign-in did not complete. Check your browser and system keychain, then try again."); }
  });
  ipcMain.handle("banger:chatgpt-cancel", event => { senderWindow(event); chatgpt.cancelSignIn(); });
  ipcMain.handle("banger:chatgpt-account", async (event, id: unknown) => {
    senderWindow(event);
    cancelAI();
    const result = await chatgpt.selectAccount(id);
    await localModel.select(false);
    return result;
  });
  ipcMain.handle("banger:chatgpt-model", (event, model: unknown) => { senderWindow(event); cancelAI(); return chatgpt.selectModel(model); });
  ipcMain.handle("banger:chatgpt-sign-out", (event, id: unknown) => { senderWindow(event); cancelAI(); return chatgpt.signOut(id); });
  ipcMain.handle("banger:chatgpt-usage", event => { senderWindow(event); return shell.openExternal("https://chatgpt.com/settings/usage"); });
  ipcMain.handle("banger:local-status", event => { senderWindow(event); return localModel.status(); });
  ipcMain.handle("banger:local-download", event => { senderWindow(event); return localModel.download(); });
  ipcMain.handle("banger:local-choose", (event, variant: unknown) => { senderWindow(event); return localModel.choose(variant); });
  ipcMain.handle("banger:local-start", event => { senderWindow(event); return localModel.start(); });
  ipcMain.handle("banger:local-stop", async event => {
    senderWindow(event);
    for (const controller of pendingChats.values()) controller.abort();
    projectWorkspace.cancelAll();
    await localModel.stop();
  });
  ipcMain.handle("banger:local-select", async (event, selected: unknown) => {
    senderWindow(event);
    if (typeof selected !== "boolean") throw new Error("Choose local AI or an API provider.");
    cancelAI();
    if (selected) await chatgpt.select(false).catch(() => undefined);
    return localModel.select(selected);
  });
  async function loadAISettings() {
    const local = await localModel.status();
    const chatgptStatus = await chatgpt.status().catch(() => ({ selected: false, activeAccountId: null, accounts: [], models: [], signingIn: false,
      error: "Saved ChatGPT accounts are unavailable. Unlock your system keychain to load them." }));
    const localSettings = { chatgpt: chatgptStatus, localSelected: local.selected, localVariant: local.variant,
      localModels: local.installedVariants.map(variant => ({ id: `local:${variant}`, label: `Muse Glimmer 30B · ${variant === "small" ? "16 GB" : "20 GB Dynamic"} · local` })) };
    try { return { ...await aiSettings.load(), ...localSettings }; }
    catch {
      // A locked keychain must not prevent selecting an installed local model.
      return { activeProvider: null, providers: {}, ...localSettings,
        settingsError: "Saved API providers are unavailable. Unlock your system keychain to load them." };
    }
  }
  let settingsQueue = Promise.resolve();
  function changeAISettings<T>(action: () => Promise<T>) {
    const result = settingsQueue.then(action);
    settingsQueue = result.then(() => undefined, () => undefined);
    return result;
  }
  ipcMain.handle("banger:ai-load", async event => { senderWindow(event); await settingsQueue; return loadAISettings(); });
  ipcMain.handle("banger:ai-select", (event, option: unknown) => {
    senderWindow(event);
    return changeAISettings(async () => {
      if (option === "chatgpt") {
        await chatgpt.select(true);
        await localModel.select(false);
      } else if (option === "local:small" || option === "local:dynamic") {
        const variant = option === "local:small" ? "small" : "dynamic";
        const local = await localModel.status();
        if (!local.installedVariants.includes(variant)) throw new Error("Download this local model before selecting it.");
        if (["downloading", "verifying", "starting"].includes(local.phase)) throw new Error("Wait for the current model operation to finish before switching.");
        if (local.variant !== variant) {
          await localModel.stop();
          await localModel.choose(variant);
        }
        // Local models remain usable while the system keychain is locked.
        await chatgpt.select(false).catch(() => undefined);
        await localModel.select(true);
        await localModel.start();
      } else {
        await aiSettings.select(option);
        await chatgpt.select(false);
        await localModel.select(false);
      }
      cancelAI();
      return loadAISettings();
    });
  });
  ipcMain.handle("banger:ai-save", (event, provider: unknown, model: unknown, key: unknown) => {
    senderWindow(event);
    return changeAISettings(async () => {
      cancelAI();
      await aiSettings.save(provider, model, key);
      await chatgpt.select(false);
      await localModel.select(false);
      return loadAISettings();
    });
  });
  ipcMain.handle("banger:ai-remove", eventRemove);
  function eventRemove(event: IpcMainInvokeEvent, provider: unknown) {
    senderWindow(event);
    return changeAISettings(async () => { cancelAI(); await aiSettings.remove(provider); return loadAISettings(); });
  }
  ipcMain.handle("banger:chat-cancel", event => { pendingChats.get(senderWindow(event).id)?.abort(); });
  ipcMain.handle("banger:chat", async (event, request: unknown) => {
    const window = senderWindow(event);
    if (pendingChats.has(window.id)) return { ok: false, error: "A reply is already being generated." };
    const controller = new AbortController();
    pendingChats.set(window.id, controller);
    try {
      const input = parseChatRequest(request);
      if ((await localModel.status()).selected) {
        try {
          const { port, token } = localModel.connection();
          return { ok: true, reply: await runBangerAgent(input, selectLocalModel(port, token), controller.signal) };
        } catch {
          return { ok: false, error: controller.signal.aborted ? "Generation stopped." :
            "Local generation failed. Check that Muse Glimmer is running in AI settings, then try a smaller request." };
        }
      }
      if ((await chatgpt.status()).selected) {
        try { return { ok: true, reply: await runBangerAgent(input, await chatgpt.model(), controller.signal) }; }
        catch (error) { return { ok: false, error: controller.signal.aborted ? "Generation stopped." : publicChatGPTError(error) }; }
      }
      const credentials = await aiSettings.credentials();
      if (!credentials) return { ok: false, error: "Add a provider key and model in BYOK to start chatting." };
      const selected = selectModel(credentials);
      try { return { ok: true, reply: await runBangerAgent(input, selected, controller.signal) }; }
      catch (error) { return { ok: false, error: publicAIError(error) }; }
    } catch {
      return { ok: false, error: controller.signal.aborted ? "Generation stopped." : "Could not start AI chat. Check your settings and connection." };
    } finally { pendingChats.delete(window.id); }
  });
  const projectWorkspace = installWorkspaceHandlers({ senderWindow,
    modelError: error => error instanceof ChatGPTError || (error instanceof Error && error.cause instanceof ChatGPTError)
      ? publicChatGPTError(error) : publicAIError(error),
    selectModel: async () => {
    await settingsQueue;
    if ((await localModel.status()).selected) {
      const { port, token } = localModel.connection();
      return selectLocalModel(port, token);
    }
    if ((await chatgpt.status()).selected) return chatgpt.model();
    const credentials = await aiSettings.credentials();
    if (!credentials) throw new Error("Choose a model in AI settings before running a project task.");
    return selectModel(credentials);
  } });
  installProjectHandlers();
  createWindow();
  app.on("activate", () => { if (windows.size === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
