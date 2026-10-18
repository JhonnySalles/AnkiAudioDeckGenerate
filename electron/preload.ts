import { contextBridge, ipcRenderer } from 'electron';
import { CardPayload, AppSettings } from './types/anki';

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => ipcRenderer.invoke('app:ping'),

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
  selectLyricsFile: () => ipcRenderer.invoke('dialog:select-lyrics-file')
});
