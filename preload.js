const { contextBridge, ipcRenderer } = require('electron');

// Expõe a função 'setIgnoreMouseEvents' para o seu index.html
// de uma maneira segura
contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  }
});