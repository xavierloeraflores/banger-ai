const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed preloads use CommonJS and expose only dialog-based project operations.
contextBridge.exposeInMainWorld("bangerProjects", Object.freeze({
  openProject: () => ipcRenderer.invoke("banger:open-project"),
  saveProject: (source, name) => ipcRenderer.invoke("banger:save-project", source, name),
}));
