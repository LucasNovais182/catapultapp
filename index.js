const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const https = require('https');

let mainWindow;
let gameDetectionInterval = null;
let isGameDetected = false;
let lastGameTime = 0;
let gameEndCheckInterval = null;
let isLoLRunning = false; // Flag para saber se o LoL está rodando

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 230, // Largura do overlay
    height: 50, // Altura do overlay
    transparent: true, // Torna o fundo da janela transparente
    frame: false, // Remove a barra de título, fechar, etc.
    alwaysOnTop: true, // SEMPRE fica por cima de outras janelas (o jogo)
    resizable: false,
    skipTaskbar: true, // Não aparece na barra de tarefas
    focusable: false, // Não recebe foco automaticamente (importante para overlay)
    show: false, // Não mostra a janela inicialmente
    webPreferences: {
      // 'preload.js' é essencial para a comunicação segura entre a janela e o main.js
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Configurações específicas para garantir que fique sobre o jogo
  // Windows: Funciona bem com fullscreen e borderless windowed
  // macOS: Precisa usar "Janela sem bordas" (fullscreen exclusivo bloqueia overlays)
  if (process.platform === 'win32') {
    // Windows - configuração otimizada
    mainWindow.setAlwaysOnTop(true, 'screen-saver'); // Nível mais alto no Windows
    mainWindow.setVisibleOnAllWorkspaces(true);
  } else if (process.platform === 'darwin') {
    // macOS - tenta o melhor possível
    try {
      mainWindow.setAlwaysOnTop(true, 'modal-panel');
    } catch (e) {
      try {
        mainWindow.setAlwaysOnTop(true, 'floating');
      } catch (e2) {
        mainWindow.setAlwaysOnTop(true);
      }
    }
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    // Linux e outros
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setVisibleOnAllWorkspaces(true);
  }
  mainWindow.setFullScreenable(false); // Não pode entrar em fullscreen
  mainWindow.setPosition(0, 0); // Posição inicial da janela
  
  // Garante que a janela nunca receba foco ou minimize outras janelas
  mainWindow.on('focus', () => {
    // Se por algum motivo receber foco, remove imediatamente
    mainWindow.blur();
  });

  // Carrega o seu arquivo HTML
  mainWindow.loadFile('index.html');
  
  // Por padrão, a janela pode ser clicada e arrastada
  mainWindow.setIgnoreMouseEvents(false);

  // Inicia a detecção de partida quando a janela estiver pronta
  mainWindow.webContents.once('did-finish-load', () => {
    startGameDetection();
  });
}

// Escuta a mensagem "set-ignore-mouse-events" do index.html
// Isso que permite o "click-through" (clicar através do overlay)
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  mainWindow.setIgnoreMouseEvents(ignore, options);
});

// Escuta mensagem para iniciar o timer
ipcMain.on('start-timer', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer-start');
  }
});

// Escuta mensagem para parar o timer
ipcMain.on('stop-timer', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer-stop');
  }
});

// Função para verificar se uma partida de LoL está em andamento
function checkGameStatus() {
  const options = {
    hostname: '127.0.0.1',
    port: 2999,
    path: '/liveclientdata/gamestats',
    method: 'GET',
    rejectUnauthorized: false // Ignora certificado SSL inválido da API local
  };

  const req = https.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      try {
        const gameStats = JSON.parse(data);
        const gameTime = gameStats?.gameTime || 0;

        // Se a API respondeu, o LoL está rodando
        if (!isLoLRunning) {
          isLoLRunning = true;
          console.log('League of Legends detectado rodando.');
        }

        // Se o tempo de jogo for maior que 0, a partida começou
        if (gameTime > 0 && !isGameDetected) {
          isGameDetected = true;
          lastGameTime = gameTime;
          console.log('Partida detectada! Mostrando overlay e iniciando timer...');
          if (process.platform === 'darwin') {
            console.log('⚠️ macOS: Se o overlay não aparecer, use "Janela sem bordas" no LoL (fullscreen exclusivo bloqueia overlays).');
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            // Mostra a janela quando a partida começar
            if (!mainWindow.isVisible()) {
              // Reforça alwaysOnTop antes de mostrar
              if (process.platform === 'win32') {
                // Windows - melhor suporte para overlays
                mainWindow.setAlwaysOnTop(true, 'screen-saver');
                mainWindow.setVisibleOnAllWorkspaces(true);
              } else if (process.platform === 'darwin') {
                // macOS
                try {
                  mainWindow.setAlwaysOnTop(true, 'modal-panel');
                } catch (e) {
                  try {
                    mainWindow.setAlwaysOnTop(true, 'floating');
                  } catch (e2) {
                    mainWindow.setAlwaysOnTop(true);
                  }
                }
                mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
              } else {
                mainWindow.setAlwaysOnTop(true);
                mainWindow.setVisibleOnAllWorkspaces(true);
              }
              mainWindow.show(); // Mostra a janela
              // Remove foco imediatamente se por acaso ganhar
              setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.blur();
                }
              }, 100);
            }
            mainWindow.webContents.send('timer-start');
            startGameEndDetection();
          }
        } else if (isGameDetected && gameTime > 0) {
          // Atualiza o último tempo conhecido se o jogo ainda estiver rodando
          lastGameTime = gameTime;
        }
      } catch (error) {
        // API não disponível ou resposta inválida (jogo não está rodando ou partida não começou)
        if (isLoLRunning) {
          isLoLRunning = false;
          hideOverlayIfVisible();
        }
      }
    });
  });

  req.on('error', (error) => {
    // Erro ao conectar - LoL não está rodando ou partida não começou
    if (isLoLRunning) {
      // Se o LoL estava rodando e agora não está mais
      isLoLRunning = false;
      console.log('League of Legends não está mais rodando. Escondendo overlay...');
      hideOverlayIfVisible();
    }
    
    if (isGameDetected) {
      // Se estava detectado e agora não está mais, o jogo terminou
      isGameDetected = false;
      console.log('Partida terminada. Escondendo overlay...');
      stopGameEndDetection();
      hideOverlayIfVisible();
    }
  });

  req.setTimeout(2000, () => {
    req.destroy();
  });

  req.end();
}

// Inicia a verificação periódica do estado do jogo
function startGameDetection() {
  // Verifica a cada 2 segundos se a partida começou
  gameDetectionInterval = setInterval(checkGameStatus, 2000);
  // Faz a primeira verificação imediatamente
  checkGameStatus();
}

function stopGameDetection() {
  if (gameDetectionInterval) {
    clearInterval(gameDetectionInterval);
    gameDetectionInterval = null;
  }
  stopGameEndDetection();
  isGameDetected = false;
}

// Verifica se o jogo terminou (API não responde mais ou tempo parou)
function startGameEndDetection() {
  stopGameEndDetection(); // Garante que não há múltiplos intervalos
  let stuckTimeCount = 0;
  
  gameEndCheckInterval = setInterval(() => {
    const options = {
      hostname: '127.0.0.1',
      port: 2999,
      path: '/liveclientdata/gamestats',
      method: 'GET',
      rejectUnauthorized: false,
      timeout: 2000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const gameStats = JSON.parse(data);
          const gameTime = gameStats?.gameTime || 0;
          
          // Se o tempo não mudou por 10 segundos, o jogo pode ter terminado
          if (gameTime === lastGameTime && gameTime > 0) {
            stuckTimeCount++;
            if (stuckTimeCount >= 5) { // 5 verificações = ~10 segundos
              console.log('Jogo parece ter terminado (tempo parado). Fechando timer...');
              handleGameEnd();
            }
          } else {
            lastGameTime = gameTime;
            stuckTimeCount = 0;
          }
        } catch (error) {
          // Se não conseguir ler a API, o jogo pode ter terminado
          if (isLoLRunning) {
            // Verifica novamente se o LoL ainda está rodando
            isLoLRunning = false;
          }
          handleGameEnd();
        }
      });
    });

    req.on('error', () => {
      // Erro ao conectar = LoL não está mais rodando
      if (isLoLRunning) {
        isLoLRunning = false;
      }
      handleGameEnd();
    });

    req.on('timeout', () => {
      req.destroy();
      // Timeout pode ser temporário, então verificamos novamente
      if (isLoLRunning) {
        // Deixa o timeout continuar verificando antes de esconder
      } else {
        handleGameEnd();
      }
    });

    req.end();
  }, 2000); // Verifica a cada 2 segundos
}

function stopGameEndDetection() {
  if (gameEndCheckInterval) {
    clearInterval(gameEndCheckInterval);
    gameEndCheckInterval = null;
  }
}

function hideOverlayIfVisible() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.webContents.send('timer-stop');
    // Esconde a janela após 2 segundos
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
    }, 2000);
  }
}

function handleGameEnd() {
  stopGameEndDetection();
  isGameDetected = false;
  hideOverlayIfVisible();
}

// Suprime avisos de certificado no console do Electron
app.commandLine.appendSwitch('ignore-certificate-errors');

// Configurações para garantir que o overlay apareça sobre jogos em fullscreen (macOS)
if (process.platform === 'darwin') {
  app.dock.hide(); // Esconde o ícone do app do Dock no macOS
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopGameDetection();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopGameDetection();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});