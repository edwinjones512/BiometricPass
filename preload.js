const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  authenticate: () => ipcRenderer.invoke('authenticate'),
  lock: () => ipcRenderer.invoke('lock'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  loadData: () => ipcRenderer.invoke('load-data'),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  exportDeviceKey: () => ipcRenderer.invoke('export-device-key'),
  importDeviceKey: (key) => ipcRenderer.invoke('import-device-key', key),
  exportVault: () => ipcRenderer.invoke('export-vault'),
  getFilePaths: () => ipcRenderer.invoke('get-file-paths'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s) => ipcRenderer.invoke('set-settings', s),
  onLocked: (callback) => ipcRenderer.on('locked-state', callback)
});
