import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu, MenuItemConstructorOptions, Tray } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { AnkiConnectService } from './services/anki-connect.service';
import { AnkiFileService } from './services/anki-file.service';
import { AudioService } from './services/audio.service';
import { SettingsService } from './services/settings.service';
import { LyricsService } from './services/lyrics.service';
import { FfmpegService } from './services/ffmpeg.service';
import { SubtitleExportService } from './services/subtitle-export.service';
import { CardPayload, AppSettings, SaveCardResult } from './types/anki';
import {
  SubtitleProject,
  SUPPORTED_VIDEO_EXTENSIONS,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_SUBTITLE_EXTENSIONS
} from './types/subtitle-project';

// Registrar esquema de mídia antes de app ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function getAppIconPath(): string {
  const candidateIco = path.join(app.getAppPath(), 'assets', 'icons', 'icon.ico');
  if (fs.existsSync(candidateIco)) return candidateIco;

  const candidatePng = path.join(app.getAppPath(), 'assets', 'icons', 'icon.png');
  if (fs.existsSync(candidatePng)) return candidatePng;

  const fallbackIco = path.join(__dirname, '..', 'assets', 'icons', 'icon.ico');
  if (fs.existsSync(fallbackIco)) return fallbackIco;

  return path.join(__dirname, '..', 'assets', 'icons', 'icon.png');
}

function getTrayIconPath(): string {
  const candidateIco = path.join(app.getAppPath(), 'assets', 'icons', 'tray.ico');
  if (fs.existsSync(candidateIco)) return candidateIco;

  const candidatePng = path.join(app.getAppPath(), 'assets', 'icons', 'tray.png');
  if (fs.existsSync(candidatePng)) return candidatePng;

  return getAppIconPath();
}

// Sistema de captura e retransmissão de logs do processo principal para o Renderer
function broadcastMainLog(level: 'info' | 'warn' | 'error', message: string, details?: any): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('app:main-log', {
        level,
        source: 'Electron',
        message,
        details
      });
    }
  } catch {
    // Ignorar se a janela não estiver disponível
  }
}

const origLog = console.log;
const origInfo = console.info;
const origWarn = console.warn;
const origError = console.error;

console.log = (...args: any[]) => {
  origLog.apply(console, args);
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  broadcastMainLog('info', msg);
};

console.info = (...args: any[]) => {
  origInfo.apply(console, args);
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  broadcastMainLog('info', msg);
};

console.warn = (...args: any[]) => {
  origWarn.apply(console, args);
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  broadcastMainLog('warn', msg);
};

console.error = (...args: any[]) => {
  origError.apply(console, args);
  const msg = args.map(a => (typeof a === 'object' ? (a?.stack || JSON.stringify(a)) : String(a))).join(' ');
  broadcastMainLog('error', msg);
};

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Novo Projeto de Legendas',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:action', 'new-project')
        },
        {
          label: 'Abrir Projeto...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:action', 'open-project')
        },
        {
          label: 'Salvar Projeto',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:action', 'save-project')
        },
        {
          label: 'Salvar Projeto Como...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu:action', 'save-project-as')
        },
        { type: 'separator' },
        {
          label: 'Exportar para o Anki',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu:action', 'export-anki')
        },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' }
      ]
    },
    {
      label: 'Exibir',
      submenu: [
        {
          label: 'Modo: Legendas de Filmes / Séries',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow?.webContents.send('menu:switch-mode', 'subtitles')
        },
        {
          label: 'Modo: Músicas / Lyrics',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow?.webContents.send('menu:switch-mode', 'music')
        },
        { type: 'separator' },
        { role: 'reload', label: 'Recarregar Tela' },
        { role: 'togglefullscreen', label: 'Tela Cheia' }
      ]
    },
    {
      label: 'Console & Logs',
      submenu: [
        {
          label: 'Alternar Console DevTools (F12)',
          accelerator: 'F12',
          click: () => {
            if (mainWindow) {
              if (mainWindow.webContents.isDevToolsOpened()) {
                mainWindow.webContents.closeDevTools();
              } else {
                mainWindow.webContents.openDevTools({ mode: 'detach' });
              }
            }
          }
        },
        {
          label: 'Inspecionar Elemento',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.openDevTools({ mode: 'detach' })
        },
        { type: 'separator' },
        {
          label: 'Abrir Painel de Logs de Erros',
          accelerator: 'CmdOrCtrl+L',
          click: () => mainWindow?.webContents.send('menu:action', 'open-logs')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createTray(): void {
  if (tray) return;

  const trayIcon = getTrayIconPath();
  if (!fs.existsSync(trayIcon)) {
    console.warn('[tray] Ícone da bandeja não encontrado:', trayIcon);
    return;
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Anki Audio Card Creator');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Anki Audio Card Creator',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Novo Projeto',
      click: () => mainWindow?.webContents.send('menu:action', 'new-project')
    },
    { type: 'separator' },
    {
      label: 'Minimizar para a Bandeja',
      click: () => mainWindow?.hide()
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
        mainWindow.focus();
      } else {
        mainWindow.focus();
      }
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  tray.on('double-click', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function createWindow(): void {
  const iconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 850,
    minHeight: 600,
    title: 'Anki Audio Card Creator',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#0f172a',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged;

  if (isDev) {
    let devPort = process.env['DEV_PORT'];
    if (!devPort) {
      const envPath = path.join(app.getAppPath(), '.env');
      if (fs.existsSync(envPath)) {
        try {
          const envContent = fs.readFileSync(envPath, 'utf8');
          const match = envContent.match(/^\s*DEV_PORT\s*=\s*(\d+)/m);
          if (match && match[1]) {
            devPort = match[1];
          }
        } catch {
          // ignore
        }
      }
    }
    const targetPort = devPort || '4600';
    console.log(`[main] Carregando frontend Angular em http://localhost:${targetPort}`);
    mainWindow.loadURL(`http://localhost:${targetPort}`);
  } else {
    const indexHtml = path.join(
      app.getAppPath(),
      'dist/anki-card-creator/browser/index.html'
    );
    if (!fs.existsSync(indexHtml)) {
      console.error('[main] index.html not found:', indexHtml);
    }
    void mainWindow.loadFile(indexHtml);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:toggle-devtools', () => {
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });

  ipcMain.handle('app:ping', () => 'pong');

  // AnkiConnect
  ipcMain.handle('anki:check-status', async () => {
    return await AnkiConnectService.getInstance().checkStatus();
  });

  ipcMain.handle('anki:get-decks', async () => {
    return await AnkiConnectService.getInstance().getDecks();
  });

  // Save Card Handler
  ipcMain.handle('anki:save-card', async (_event, card: CardPayload): Promise<SaveCardResult> => {
    const settings = SettingsService.getInstance().getSettings();
    const result: SaveCardResult = { success: false };
    const errors: string[] = [];

    // 1. AnkiConnect direct insertion
    if (settings.saveMode === 'both' || settings.saveMode === 'ankiconnect') {
      try {
        const noteId = await AnkiConnectService.getInstance().addNote(card);
        result.ankiNoteId = noteId;
        result.success = true;
      } catch (ankiErr: any) {
        errors.push(`AnkiConnect: ${ankiErr.message || ankiErr}`);
      }
    }

    // 2. File export insertion
    if (settings.saveMode === 'both' || settings.saveMode === 'file') {
      try {
        const fileResult = await AnkiFileService.getInstance().saveToFile(card);
        result.savedToFile = fileResult.savedToFile;
        result.filePath = fileResult.filePath;
        result.audioSavedToMedia = fileResult.audioSavedToMedia;
        result.success = true;
      } catch (fileErr: any) {
        errors.push(`Arquivo: ${fileErr.message || fileErr}`);
      }
    }

    if (errors.length > 0 && !result.success) {
      result.error = errors.join(' | ');
    } else if (errors.length > 0) {
      result.error = `Parcial: ${errors.join(' | ')}`;
    }

    return result;
  });

  // Audio recording buffer save
  ipcMain.handle('audio:save-buffer', async (_event, payload: { buffer: ArrayBuffer; prefix?: string }) => {
    const buffer = Buffer.from(payload.buffer);
    return await AudioService.getInstance().saveAudioBuffer(buffer, undefined, payload.prefix);
  });

  // Dialog select audio file
  ipcMain.handle('dialog:select-audio-file', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Arquivo de Áudio',
      filters: [
        { name: 'Áudio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return null;
    const selected = filePaths[0];
    return await AudioService.getInstance().importLocalFile(selected);
  });

  // Dialog directory
  ipcMain.handle('dialog:select-directory', async (_event, title?: string) => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Selecionar Pasta',
      properties: ['openDirectory', 'createDirectory']
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });

  // Dialog file
  ipcMain.handle('dialog:select-file', async (_event, title?: string) => {
    if (!mainWindow) return null;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: title || 'Selecionar ou Criar Arquivo de Texto',
      defaultPath: 'anki_cards.txt',
      filters: [
        { name: 'Arquivo de Texto (*.txt)', extensions: ['txt'] },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ]
    });
    if (canceled || !filePath) return null;
    return filePath;
  });

  // Open directory in Explorer
  ipcMain.handle('shell:open-path', async (_event, targetPath: string) => {
    if (targetPath) {
      if (fs.existsSync(targetPath)) {
        await shell.showItemInFolder(targetPath);
      } else {
        const dir = path.dirname(targetPath);
        if (fs.existsSync(dir)) {
          await shell.openPath(dir);
        }
      }
    }
  });

  // Settings
  ipcMain.handle('settings:get', () => {
    return SettingsService.getInstance().getSettings();
  });

  ipcMain.handle('settings:save', (_event, newSettings: Partial<AppSettings>) => {
    return SettingsService.getInstance().saveSettings(newSettings);
  });

  // Lyrics Extraction & LRCLIB
  ipcMain.handle('lyrics:fetch-url', async (_event, targetUrl: string) => {
    return await LyricsService.getInstance().fetchUrl(targetUrl);
  });

  ipcMain.handle('lyrics:search-lrclib', async (_event, params: { track?: string; artist?: string; q?: string }) => {
    return await LyricsService.getInstance().searchLrclib(params);
  });

  ipcMain.handle('lyrics:get-lrclib', async (_event, artist: string, track: string) => {
    return await LyricsService.getInstance().getLrclib(artist, track);
  });

  ipcMain.handle('dialog:select-lyrics-file', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Arquivo de Letra / Legenda',
      filters: [
        { name: 'Letras e Legendas (*.lrc, *.srt, *.vtt, *.html, *.txt)', extensions: ['lrc', 'srt', 'vtt', 'html', 'htm', 'txt'] },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return null;
    const filePath = filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      filePath,
      filename: path.basename(filePath),
      content
    };
  });

  // ================= SUBTITLE & VIDEO IPC =================
  ipcMain.handle('media:probe', async (_event, filePath: string) => {
    return await FfmpegService.getInstance().probe(filePath);
  });

  ipcMain.handle('media:cut-audio', async (_event, options) => {
    return await FfmpegService.getInstance().cutAudio(options);
  });

  ipcMain.handle('media:snapshot', async (_event, options) => {
    return await FfmpegService.getInstance().extractSnapshot(options);
  });

  ipcMain.handle('media:extract-sub', async (_event, filePath: string, subStreamIndex: number) => {
    return await FfmpegService.getInstance().extractEmbeddedSubtitle(filePath, subStreamIndex);
  });

  ipcMain.handle('dialog:select-video-file', async () => {
    if (!mainWindow) return null;
    const allMediaExts = Array.from(new Set([...SUPPORTED_VIDEO_EXTENSIONS, ...SUPPORTED_AUDIO_EXTENSIONS]));

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Arquivo de Vídeo ou Áudio',
      filters: [
        { name: 'Todos os Arquivos de Vídeo e Áudio', extensions: allMediaExts },
        { name: 'Arquivos de Vídeo (*.mkv, *.mp4, *.avi, ...)', extensions: SUPPORTED_VIDEO_EXTENSIONS },
        { name: 'Arquivos de Áudio (*.wav, *.mp3, *.flac, ...)', extensions: SUPPORTED_AUDIO_EXTENSIONS },
        { name: 'Todos os Arquivos (*.*)', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return null;
    const filePath = filePaths[0];
    const probeData = await FfmpegService.getInstance().probe(filePath);
    return {
      filePath,
      filename: path.basename(filePath),
      probeData
    };
  });

  ipcMain.handle('dialog:select-sub-files', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Arquivos de Legenda',
      filters: [
        { name: 'Todos os Formatos de Legenda (*.srt, *.ass, *.vtt, *.sub, *.csv, ...)', extensions: SUPPORTED_SUBTITLE_EXTENSIONS },
        { name: 'Exportação Anki / Planilha (*.csv, *.txt)', extensions: ['csv', 'txt'] },
        { name: 'SubRip (*.srt)', extensions: ['srt'] },
        { name: 'Advanced SubStation (*.ass, *.ssa)', extensions: ['ass', 'ssa'] },
        { name: 'WebVTT (*.vtt)', extensions: ['vtt'] },
        { name: 'MicroDVD / YouTube / Lyrics (*.sub, *.sbv, *.lrc, *.txt)', extensions: ['sub', 'sbv', 'lrc', 'txt'] },
        { name: 'Todos os Arquivos (*.*)', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    });

    if (canceled || filePaths.length === 0) return null;
    return filePaths.map(fp => {
      // Leitura inteligente de encoding
      const buf = fs.readFileSync(fp);
      let content = '';
      try {
        // Tenta UTF-8
        content = buf.toString('utf-8');
        // Se houver caractere de substituição comum de Latin1 lido como utf8, ou formato corrompido
        if (content.includes('\uFFFD')) {
          content = buf.toString('latin1');
        }
      } catch {
        content = buf.toString('latin1');
      }
      return {
        filePath: fp,
        filename: path.basename(fp),
        content
      };
    });
  });

  ipcMain.handle('subs:export-project', async (_event, payload: any, legacyOptions?: any) => {
    try {
      const project = payload?.project || payload;
      const options = payload?.options || legacyOptions;

      if (!project) {
        throw new Error('Nenhum dado de projeto recebido para exportação.');
      }
      if (!Array.isArray(project.rows) || project.rows.length === 0) {
        throw new Error('O projeto não possui linhas de legenda para exportar.');
      }

      console.log(`[Export] Iniciando exportação de ${project.rows.length} falas para '${project.mediaName}'...`);

      const result = await SubtitleExportService.getInstance().exportProject(project, options, (progress) => {
        mainWindow?.webContents.send('subs:export-progress', progress);
      });

      if (result.cancelled) {
        console.log(`[Export] Exportação cancelada pelo usuário após ${result.exportedCount} cards.`);
      } else {
        console.log(`[Export] Concluído com sucesso: ${result.exportedCount} cards gerados.`);
      }
      return result;
    } catch (err: any) {
      console.error('[Export] Erro ao exportar projeto:', err);
      throw err;
    }
  });

  ipcMain.handle('subs:cancel-export', () => {
    console.log('[Export] Solicitação de cancelamento recebida.');
    SubtitleExportService.getInstance().cancelExport();
    return true;
  });

  ipcMain.handle('project:save-to-path', async (_event, filePath: string, project: SubtitleProject) => {
    try {
      if (!filePath) {
        throw new Error('Caminho de arquivo inválido para salvar o projeto.');
      }
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
      console.log(`[Project] Projeto salvo com sucesso em: ${filePath}`);
      return filePath;
    } catch (err: any) {
      console.error(`[Project] Erro ao salvar projeto em '${filePath}':`, err);
      throw err;
    }
  });

  ipcMain.handle('project:save-dialog', async (_event, project: SubtitleProject, defaultPath?: string) => {
    if (!mainWindow) return null;
    const defaultName = defaultPath || `${project?.mediaName || 'projeto'}.ankisubs.json`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar Projeto de Legendas Como...',
      defaultPath: defaultName,
      filters: [{ name: 'Projeto Anki Subs (*.ankisubs.json)', extensions: ['ankisubs.json', 'json'] }]
    });
    if (canceled || !filePath) return null;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
    console.log(`[Project] Projeto salvo como: ${filePath}`);
    return filePath;
  });

  ipcMain.handle('project:load-dialog', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Abrir Projeto de Legendas',
      filters: [{ name: 'Projeto Anki Subs (*.ankisubs.json, *.json)', extensions: ['ankisubs.json', 'json'] }],
      properties: ['openFile']
    });
    if (canceled || filePaths.length === 0) return null;
    const filePath = filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    const project = JSON.parse(content) as SubtitleProject;
    console.log(`[Project] Projeto carregado: ${filePath} (${project.mediaName})`);
    return {
      filePath,
      project
    };
  });
}

app.whenReady().then(() => {
  // Protocolo personalizado para carregar mídias de cache e locais de forma segura
  protocol.handle('media', (request) => {
    try {
      const urlObj = new URL(request.url);
      const cacheDir = FfmpegService.getInstance().getCacheDir();
      let targetFilePath = '';

      // 1. Suporte a query param explícito: media://file?path=...
      const queryPath = urlObj.searchParams.get('path');
      if (queryPath) {
        targetFilePath = queryPath;
      } else {
        // 2. Extrai pathname ou host (ex: media://preview_xyz.mp3 ou media://cache/preview_xyz.mp3)
        // No Chromium, se a URL for media://preview_xyz.mp3, 'preview_xyz.mp3' vira o hostname!
        let subPath = urlObj.pathname;
        if ((!subPath || subPath === '/' || subPath === '') && urlObj.hostname) {
          subPath = urlObj.hostname;
        } else if (urlObj.hostname && urlObj.hostname !== 'cache' && urlObj.hostname !== 'preview' && urlObj.hostname !== 'file') {
          // Trata caso de hostname windows como media://c/Users/...
          if (urlObj.hostname.length === 1 && /^[a-zA-Z]$/.test(urlObj.hostname)) {
            subPath = `${urlObj.hostname}:${urlObj.pathname}`;
          } else {
            subPath = `${urlObj.hostname}${urlObj.pathname}`;
          }
        }

        // Limpar barras iniciais desnecessárias
        let cleaned = decodeURIComponent(subPath).replace(/^\/+/, '');
        if (/^[a-zA-Z]:/.test(cleaned)) {
          targetFilePath = cleaned;
        } else {
          // Se tiver prefixo 'cache/' ou 'preview/', remover
          cleaned = cleaned.replace(/^(cache|preview)\//i, '');
          targetFilePath = path.join(cacheDir, cleaned);
        }
      }

      if (fs.existsSync(targetFilePath) && fs.statSync(targetFilePath).isFile()) {
        const ext = path.extname(targetFilePath).toLowerCase();
        let mimeType = 'application/octet-stream';
        if (ext === '.mp3') mimeType = 'audio/mpeg';
        else if (ext === '.wav') mimeType = 'audio/wav';
        else if (ext === '.ogg') mimeType = 'audio/ogg';
        else if (ext === '.opus') mimeType = 'audio/opus';
        else if (ext === '.aac') mimeType = 'audio/aac';
        else if (ext === '.flac') mimeType = 'audio/flac';
        else if (ext === '.m4a') mimeType = 'audio/mp4';
        else if (ext === '.mp4') mimeType = 'video/mp4';
        else if (ext === '.webm') mimeType = 'video/webm';
        else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
        else if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.webp') mimeType = 'image/webp';
        else if (ext === '.gif') mimeType = 'image/gif';
        else if (ext === '.bmp') mimeType = 'image/bmp';

        const stat = fs.statSync(targetFilePath);
        const fileSize = stat.size;
        const rangeHeader = request.headers.get('range');

        // Suporte completo a HTTP 206 Partial Content para áudio (Range Requests do Chromium)
        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunkSize = end - start + 1;

          const stream = fs.createReadStream(targetFilePath, { start, end });
          // Converte ReadStream para ReadableStream compatível com Response
          const readable = new ReadableStream({
            start(controller) {
              stream.on('data', (chunk) => controller.enqueue(chunk));
              stream.on('end', () => controller.close());
              stream.on('error', (err) => controller.error(err));
            }
          });

          return new Response(readable, {
            status: 206,
            headers: {
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunkSize.toString(),
              'Content-Type': mimeType
            }
          });
        }

        const buffer = fs.readFileSync(targetFilePath);
        return new Response(buffer, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Content-Length': fileSize.toString(),
            'Accept-Ranges': 'bytes'
          }
        });
      }

      console.warn('[media-protocol] Arquivo não encontrado:', targetFilePath, 'URL original:', request.url);
      return new Response('Not found', { status: 404 });
    } catch (err: any) {
      console.error('[media-protocol] Erro ao servir mídia:', err);
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  });

  registerIpcHandlers();
  createApplicationMenu();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (tray) {
    try {
      tray.destroy();
    } catch {
      // ignore
    }
    tray = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
