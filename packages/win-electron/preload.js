'use strict';

// Security bridge: the renderer (settings page) can talk to the main process
// only through this small, audited surface. No Node APIs are leaked.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dsh', {
  openExternal: (url) => ipcRenderer.send('dsh:open-external', url),
  isReady: () => ipcRenderer.invoke('dsh:is-ready'),
  onStatus: (cb) => ipcRenderer.on('dsh:status', (_, s) => cb(s)),
});
