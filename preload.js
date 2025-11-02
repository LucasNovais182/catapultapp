const { contextBridge, ipcRenderer } = require('electron');

// Expõe a função 'setIgnoreMouseEvents' para o seu index.html
// de uma maneira segura
contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  },
  // Escuta mensagens do processo principal para iniciar o timer
  onTimerStart: (callback) => {
    ipcRenderer.on('timer-start', callback);
  },
  // Escuta mensagens do processo principal para parar o timer
  onTimerStop: (callback) => {
    ipcRenderer.on('timer-stop', callback);
  }
});