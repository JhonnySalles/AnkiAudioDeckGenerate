import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CardPayload, AppSettings } from './types/anki';

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => ipcRenderer.invoke('app:ping'),

  // Utilitários de Arquivo / Drag & Drop
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return (file as any).path || '';
    }
  },

  // AnkiConnect & Cards
  checkAnkiConnect: () => ipcRenderer.invoke('anki:check-status'),
  getAnkiDecks: () => ipcRenderer.invoke('anki:get-decks'),
  saveCard: (card: CardPayload) => ipcRenderer.invoke('anki:save-card', card),

  // Audio
  saveRecordedAudio: (payload: { buffer: ArrayBuffer; prefix?: string }) =>
    ipcRenderer.invoke('audio:save-buffer', payload),
  selectAudioFile: () => ipcRenderer.invoke('dialog:select-audio-file'),

  // Dialogs & System
  selectDirectory: (title?: string) => ipcRenderer.invoke('dialog:select-directory', title),
  selectFile: (title?: string) => ipcRenderer.invoke('dialog:select-file', title),
  openPath: (targetPath: string) => ipcRenderer.invoke('shell:open-path', targetPath),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:save', settings),

  // Lyrics Extraction
  fetchUrl: (url: string) => ipcRenderer.invoke('lyrics:fetch-url', url),
  searchLrclib: (params: { track?: string; artist?: string; q?: string }) =>
    ipcRenderer.invoke('lyrics:search-lrclib', params),
  getLrclib: (artist: string, track: string) =>
    ipcRenderer.invoke('lyrics:get-lrclib', artist, track),
  selectLyricsFile: () => ipcRenderer.invoke('dialog:select-lyrics-file'),

  // Subtitle & Media Mode
  probeMedia: (filePath: string) => ipcRenderer.invoke('media:probe', filePath),
  cutAudio: (options: any) => ipcRenderer.invoke('media:cut-audio', options),
  extractSnapshot: (options: any) => ipcRenderer.invoke('media:snapshot', options),
  extractEmbeddedSubtitle: (filePath: string, subStreamIndex: number) =>
    ipcRenderer.invoke('media:extract-sub', filePath, subStreamIndex),
  selectVideoFile: () => ipcRenderer.invoke('dialog:select-video-file'),
  selectSubFiles: () => ipcRenderer.invoke('dialog:select-sub-files'),
  exportSubtitleProject: (project: any, options?: any) =>
    ipcRenderer.invoke('subs:export-project', { project, options }),
  cancelSubtitleExport: () => ipcRenderer.invoke('subs:cancel-export'),
  onExportProgress: (callback: (progress: any) => void) => {
    const sub = (_: any, data: any) => callback(data);
    ipcRenderer.on('subs:export-progress', sub);
    return () => ipcRenderer.removeListener('subs:export-progress', sub);
  },
  saveProjectDialog: (project: any, defaultPath?: string) =>
    ipcRenderer.invoke('project:save-dialog', project, defaultPath),
  saveProjectToPath: (filePath: string, project: any) =>
    ipcRenderer.invoke('project:save-to-path', filePath, project),
  loadProjectDialog: () => ipcRenderer.invoke('project:load-dialog'),
  loadProjectFromPath: (filePath: string) => ipcRenderer.invoke('project:load-from-path', filePath),
  registerRecentProject: (filePath: string, name?: string) =>
    ipcRenderer.invoke('project:register-recent', filePath, name),

  // DevTools & Window Menu
  toggleDevTools: () => ipcRenderer.invoke('app:toggle-devtools'),
  onMenuSwitchMode: (callback: (mode: string) => void) => {
    const sub = (_: any, mode: string) => callback(mode);
    ipcRenderer.on('menu:switch-mode', sub);
    return () => ipcRenderer.removeListener('menu:switch-mode', sub);
  },
  onMenuTriggerAction: (callback: (action: string) => void) => {
    const sub = (_: any, action: string) => callback(action);
    ipcRenderer.on('menu:action', sub);
    return () => ipcRenderer.removeListener('menu:action', sub);
  },
  onMenuOpenRecentProject: (callback: (filePath: string) => void) => {
    const sub = (_: any, filePath: string) => callback(filePath);
    ipcRenderer.on('menu:open-recent-project', sub);
    return () => ipcRenderer.removeListener('menu:open-recent-project', sub);
  },
  onMainLog: (callback: (log: any) => void) => {
    const sub = (_: any, log: any) => callback(log);
    ipcRenderer.on('app:main-log', sub);
    return () => ipcRenderer.removeListener('app:main-log', sub);
  }
});
