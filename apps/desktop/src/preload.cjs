const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed preloads expose scoped operations without filesystem or generic IPC access.
contextBridge.exposeInMainWorld("bangerProjects", Object.freeze({
  openProject: () => ipcRenderer.invoke("banger:open-project"),
  saveProject: (source, name) => ipcRenderer.invoke("banger:save-project", source, name),
}));

contextBridge.exposeInMainWorld("bangerAI", Object.freeze({
  load: () => ipcRenderer.invoke("banger:ai-load"),
  select: option => ipcRenderer.invoke("banger:ai-select", option),
  save: (provider, model, key) => ipcRenderer.invoke("banger:ai-save", provider, model, key),
  remove: provider => ipcRenderer.invoke("banger:ai-remove", provider),
}));

contextBridge.exposeInMainWorld("bangerChat", Object.freeze({
  send: request => ipcRenderer.invoke("banger:chat", request),
  cancel: () => ipcRenderer.invoke("banger:chat-cancel"),
}));

contextBridge.exposeInMainWorld("bangerLocal", Object.freeze({
  status: () => ipcRenderer.invoke("banger:local-status"),
  download: () => ipcRenderer.invoke("banger:local-download"),
  choose: variant => ipcRenderer.invoke("banger:local-choose", variant),
  start: () => ipcRenderer.invoke("banger:local-start"),
  stop: () => ipcRenderer.invoke("banger:local-stop"),
  select: selected => ipcRenderer.invoke("banger:local-select", selected),
}));

contextBridge.exposeInMainWorld("bangerChatGPT", Object.freeze({
  status: () => ipcRenderer.invoke("banger:chatgpt-status"),
  signIn: accountId => ipcRenderer.invoke("banger:chatgpt-sign-in", accountId),
  cancelSignIn: () => ipcRenderer.invoke("banger:chatgpt-cancel"),
  selectAccount: accountId => ipcRenderer.invoke("banger:chatgpt-account", accountId),
  selectModel: model => ipcRenderer.invoke("banger:chatgpt-model", model),
  signOut: accountId => ipcRenderer.invoke("banger:chatgpt-sign-out", accountId),
  usage: () => ipcRenderer.invoke("banger:chatgpt-usage"),
}));
