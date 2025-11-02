const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const https = require('https');

let mainWindow;
let gameDetectionInterval = null;
let isGameDetected = false;
let lastGameTime = 0;
let gameEndCheckInterval = null;

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
  // No macOS, usa 'floating' ou 'tornado-menu' para maior prioridade
  if (process.platform === 'darwin') {
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // Visível em fullscreen
  } else {
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setVisibleOnAllWorkspaces(true);
  }
  mainWindow.setFullScreenable(false); // Não pode entrar em fullscreen
  mainWindow.setPosition(0, 0); // Posição inicial da janela
  
  // Força a janela a permanecer no topo periodicamente (workaround para alguns casos)
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true);
    }
  }, 1000);

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

        // Se o tempo de jogo for maior que 0, a partida começou
        if (gameTime > 0 && !isGameDetected) {
          isGameDetected = true;
          lastGameTime = gameTime;
          console.log('Partida detectada! Mostrando overlay e iniciando timer...');
          if (mainWindow && !mainWindow.isDestroyed()) {
            // Mostra a janela quando a partida começar
            if (!mainWindow.isVisible()) {
              mainWindow.show();
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
      }
    });
  });

  req.on('error', (error) => {
    // Erro ao conectar (normal quando jogo não está rodando)
    if (isGameDetected) {
      // Se estava detectado e agora não está mais, o jogo terminou
      isGameDetected = false;
      console.log('Partida terminada. Escondendo overlay...');
      stopGameEndDetection();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('timer-stop');
        // Esconde a janela após 2 segundos (mas mantém a janela criada para próxima partida)
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide();
          }
        }, 2000);
      }
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
          // Se não conseguir ler a API, o jogo terminou
          handleGameEnd();
        }
      });
    });

    req.on('error', () => {
      // Erro ao conectar = jogo terminou
      handleGameEnd();
    });

    req.on('timeout', () => {
      req.destroy();
      handleGameEnd();
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

function handleGameEnd() {
  stopGameEndDetection();
  isGameDetected = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer-stop');
    // Fecha a janela após 2 segundos
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide(); // Esconde em vez de fechar para permitir recriar na próxima partida
      }
    }, 2000);
  }
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