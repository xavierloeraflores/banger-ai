const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed preloads expose scoped operations without filesystem or generic IPC access.
contextBridge.exposeInMainWorld("bangerProjects", Object.freeze({
  openProject: () => ipcRenderer.invoke("banger:open-project"),
  saveProject: (source, name) => ipcRenderer.invoke("banger:save-project", source, name),
}));

contextBridge.exposeInMainWorld("bangerAI", Object.freeze({
  load: () => ipcRenderer.invoke("banger:ai-load"),
  saveElevenLabs: key => ipcRenderer.invoke("banger:elevenlabs-save", key),
  removeElevenLabs: () => ipcRenderer.invoke("banger:elevenlabs-remove"),
  select: option => ipcRenderer.invoke("banger:ai-select", option),
  save: (provider, model, key) => ipcRenderer.invoke("banger:ai-save", provider, model, key),
  remove: provider => ipcRenderer.invoke("banger:ai-remove", provider),
}));

contextBridge.exposeInMainWorld("bangerChat", Object.freeze({
  send: request => ipcRenderer.invoke("banger:chat", request),
  lyrics: request => ipcRenderer.invoke("banger:lyrics", request),
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

contextBridge.exposeInMainWorld("bangerWorkspace", Object.freeze({
  open: () => ipcRenderer.invoke("banger:workspace-open"),
  create: (name, source) => ipcRenderer.invoke("banger:workspace-create", name, source),
  activate: () => ipcRenderer.invoke("banger:workspace-activate"),
  list: () => ipcRenderer.invoke("banger:workspace-list"),
  read: path => ipcRenderer.invoke("banger:workspace-read", path),
  save: (path, source, expectedSource) => ipcRenderer.invoke("banger:workspace-save", path, source, expectedSource),
  run: (prompt, activeFile, resetHistory) => ipcRenderer.invoke("banger:workspace-run", prompt, activeFile, resetHistory),
  cancel: () => ipcRenderer.invoke("banger:workspace-cancel"),
  onEvent: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("banger:workspace-event", listener);
    return () => ipcRenderer.removeListener("banger:workspace-event", listener);
  },
}));

contextBridge.exposeInMainWorld("bangerStorage", Object.freeze({
  addToLibrary: (name, source, bytes) => ipcRenderer.invoke("banger:storage-add-library", name, source, bytes),
  prepare: (name, source) => ipcRenderer.invoke("banger:storage-prepare", name, source),
  audio: (token, bytes) => ipcRenderer.invoke("banger:storage-audio", token, bytes),
  history: token => ipcRenderer.invoke("banger:storage-history", token),
  copyToLibrary: (token, scope, selection) => ipcRenderer.invoke("banger:storage-library", token, scope, selection),
}));

contextBridge.exposeInMainWorld("bangerMusic", Object.freeze({
  addToLibrary: (id, version) => ipcRenderer.invoke("banger:music-add-library", id, version),
  list: token => ipcRenderer.invoke("banger:music-list", token),
  get: id => ipcRenderer.invoke("banger:music-get", id),
  versions: (id, before) => ipcRenderer.invoke("banger:music-versions", id, before),
  operations: token => ipcRenderer.invoke("banger:music-operations", token),
  operation: id => ipcRenderer.invoke("banger:music-operation", id),
  act: (id, action, key) => ipcRenderer.invoke("banger:music-act", id, action, key),
  importWav: (key, token) => ipcRenderer.invoke("banger:music-import", key, token),
  rendered: (bytes, name, key, token, beat) => ipcRenderer.invoke("banger:music-rendered", bytes, name, key, token, beat),
  audio: (id, version) => ipcRenderer.invoke("banger:music-audio", id, version),
  save: (id, version) => ipcRenderer.invoke("banger:music-save", id, version),
}));

contextBridge.exposeInMainWorld("bangerLibrary", {
  list: () => ipcRenderer.invoke("banger:library-list"),
  read: id => ipcRenderer.invoke("banger:library-read", id),
});
