const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boostpad', {
  call: (method, ...args) => ipcRenderer.invoke('api', method, ...args),
  on: (channel, fn) => {
    if (!['state', 'overlay-config'].includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => fn(payload));
  },
});
