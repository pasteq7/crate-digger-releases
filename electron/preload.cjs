const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("crate", {
  releaseCount: (item) => ipcRenderer.invoke("crate:release-count", item),
  externalRunUrl: (url, scope, item) =>
    ipcRenderer.invoke("crate:external-run-url", url, scope, item),
  soundcloudSearch: (item) =>
    ipcRenderer.invoke("crate:soundcloud-search", item),
  soundcloudResolve: (url) =>
    ipcRenderer.invoke("crate:soundcloud-resolve", url),
  youtubeSearch: (item) => ipcRenderer.invoke("crate:youtube-search", item),
  onYoutubeSuspend: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("crate:youtube-suspend", handler);
    return () => ipcRenderer.removeListener("crate:youtube-suspend", handler);
  },
  updateState: () => ipcRenderer.invoke("crate:update-state"),
  checkUpdates: () => ipcRenderer.invoke("crate:update-check"),
  installUpdate: () => ipcRenderer.invoke("crate:update-install"),
  automaticUpdates: (value) =>
    ipcRenderer.invoke("crate:update-automatic", value),
  onUpdate: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("crate:update-progress", handler);
    return () => ipcRenderer.removeListener("crate:update-progress", handler);
  },
  state: () => ipcRenderer.invoke("crate:state"),
  externalFolder: () => ipcRenderer.invoke("crate:external-folder"),
  externalRun: (item, scope) =>
    ipcRenderer.invoke("crate:external-run", item, scope),
  externalCancel: (id) => ipcRenderer.invoke("crate:external-cancel", id),
  externalClear: (id) => ipcRenderer.invoke("crate:external-clear", id),
  externalImport: (id, options) =>
    ipcRenderer.invoke("crate:external-import", id, options),
  onExternal: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("crate:external-progress", handler);
    return () => ipcRenderer.removeListener("crate:external-progress", handler);
  },
  onExternalClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("crate:external-close", handler);
    return () => ipcRenderer.removeListener("crate:external-close", handler);
  },
  onImportClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("crate:import-close", handler);
    return () => ipcRenderer.removeListener("crate:import-close", handler);
  },
  filePath: (file) => webUtils.getPathForFile(file),
  importDestination: () => ipcRenderer.invoke("crate:import-destination"),
  importRoutes: () => ipcRenderer.invoke("crate:import-routes"),
  chooseZips: () => ipcRenderer.invoke("crate:choose-zips"),
  chooseImportFolder: () => ipcRenderer.invoke("crate:choose-import-folder"),
  importFiles: (files, options) =>
    ipcRenderer.invoke("crate:import-zips", files, options),
  importZips: (files, options) =>
    ipcRenderer.invoke("crate:import-zips", files, options),
  musicLink: (item, action) =>
    ipcRenderer.invoke("crate:music-link", item, action),
  refreshPreview: (item) => ipcRenderer.invoke("crate:refresh-preview", item),
  onImports: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("crate:import-progress", handler);
    return () => ipcRenderer.removeListener("crate:import-progress", handler);
  },
  chooseFolder: () => ipcRenderer.invoke("crate:choose-folder"),
  removeFolder: (root) => ipcRenderer.invoke("crate:remove-folder", root),
  scan: () => ipcRenderer.invoke("crate:scan"),
  discover: (options) => ipcRenderer.invoke("crate:discover", options),
  aiContext: (scope) => ipcRenderer.invoke("crate:ai-context", scope),
  aiDiscover: (options) => ipcRenderer.invoke("crate:ai-discover", options),
  cancelAi: () => ipcRenderer.invoke("crate:cancel-ai"),
  shelf: (item, status) => ipcRenderer.invoke("crate:shelf", item, status),
  settings: (value) => ipcRenderer.invoke("crate:settings", value),
  export: (items, format) => ipcRenderer.invoke("crate:export", items, format),
  explain: (item) => ipcRenderer.invoke("crate:explain", item),
  testAi: (options) => ipcRenderer.invoke("crate:test-ai", options),
  external: (url) => ipcRenderer.invoke("crate:external", url),
  onFinds: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("crate:finds-progress", handler);
    return () => ipcRenderer.removeListener("crate:finds-progress", handler);
  },
  onScan: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("crate:scan-progress", handler);
    return () => ipcRenderer.removeListener("crate:scan-progress", handler);
  },
});
