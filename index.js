const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 230, // Largura do overlay
    height: 80, // Altura do overlay
    transparent: true, // Torna o fundo da janela transparente
    frame: false, // Remove a barra de título, fechar, etc.
    alwaysOnTop: true, // SEMPRE fica por cima de outras janelas (o jogo)
    resizable: false,
    webPreferences: {
      // 'preload.js' é essencial para a comunicação segura entre a janela e o main.js
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setPosition(0, 0); // Posição inicial da janela

  // Carrega o seu arquivo HTML
  mainWindow.loadFile('index.html');
  
  // Por padrão, a janela pode ser clicada e arrastada
  mainWindow.setIgnoreMouseEvents(false);
}

// Escuta a mensagem "set-ignore-mouse-events" do index.html
// Isso que permite o "click-through" (clicar através do overlay)
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  mainWindow.setIgnoreMouseEvents(ignore, options);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});