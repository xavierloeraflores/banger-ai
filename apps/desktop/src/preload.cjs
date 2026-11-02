const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed preloads expose scoped operations without filesystem or generic IPC access.
contextBridge.exposeInMainWorld("bangerProjects", Object.freeze({
  openProject: () => ipcRenderer.invoke("banger:open-project"),
  saveProject: (source, name) => ipcRenderer.invoke("banger:save-project", source, name),
}));

contextBridge.exposeInMainWorld("bangerAI", Object.freeze({
  load: () => ipcRenderer.invoke("banger:ai-load"),
  save: (provider, model, key) => ipcRenderer.invoke("banger:ai-save", provider, model, key),
  remove: provider => ipcRenderer.invoke("banger:ai-remove", provider),
}));

contextBridge.exposeInMainWorld("bangerChat", Object.freeze({
  send: request => ipcRenderer.invoke("banger:chat", request),
  cancel: () => ipcRenderer.invoke("banger:chat-cancel"),
}));
