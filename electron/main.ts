import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { AnkiConnectService } from './services/anki-connect.service';
import { AnkiFileService } from './services/anki-file.service';
import { AudioService } from './services/audio.service';
import { SettingsService } from './services/settings.service';
import { LyricsService } from './services/lyrics.service';
import { CardPayload, AppSettings, SaveCardResult } from './types/anki';

let mainWindow: BrowserWindow | null = null;

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 850,
    minHeight: 600,
    title: 'Anki Audio Card Creator',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
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
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
