const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  getMousePosition: () => ipcRenderer.invoke('get-mouse-position'),
  closeApp: () => ipcRenderer.send('close-app'),
  minimizeApp: () => ipcRenderer.send('minimize-app'),
  hideToolbar: () => ipcRenderer.send('hide-toolbar'),
  showToolbar: () => ipcRenderer.send('show-toolbar'),
  expandWindow: () => ipcRenderer.send('expand-window'),
  shrinkWindow: () => ipcRenderer.send('shrink-window'),
  maximizeTargetWindow: (handle) => ipcRenderer.invoke('maximize-target-window', handle),
  startRecording: (options) => ipcRenderer.invoke('start-recording', options),
  stopRecording: () => ipcRenderer.invoke('stop-recording')
});
