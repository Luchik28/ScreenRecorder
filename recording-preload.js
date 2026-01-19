const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recordingAPI', {
  onStartRecording: (callback) => ipcRenderer.on('start-recording', callback)
});
