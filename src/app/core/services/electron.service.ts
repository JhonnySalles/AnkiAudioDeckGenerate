import { Injectable, NgZone } from '@angular/core';

export interface CardPayload {
  front: string;
  back: string;
  audioPath?: string;
  audioFileName?: string;
  tags: string[];
  deckName: string;
}

export interface AnkiConnectStatus {
  connected: boolean;
  version?: number;
  decks?: string[];
  error?: string;
}

export interface AppSettings {
  deckName: string;
  defaultTags: string;
  ankiCollectionMediaDir: string;
  exportTxtPath: string;
  ankiConnectUrl: string;
  saveMode: 'both' | 'ankiconnect' | 'file';
  // Áudio
  audioBitrate?: '64k' | '96k' | '128k' | '192k' | '256k' | '320k';
  audioFormat?: 'mp3' | 'aac' | 'ogg' | 'opus' | 'wav' | 'flac';
  normalizeAudio?: boolean;
  trimSilence?: boolean;
  // Imagem
  imageWidth?: number;
  imageHeight?: number;
  // Vídeo
  videoWidth?: number;
  videoHeight?: number;
  videoBitrate?: '500k' | '800k' | '1000k' | '1500k' | '2500k';
}

export interface SaveCardResult {
  success: boolean;
  ankiNoteId?: number;
  savedToFile?: boolean;
  filePath?: string;
  audioSavedToMedia?: boolean;
  error?: string;
}

export interface ElectronAPI {
  ping: () => Promise<string>;
  getPathForFile?: (file: File) => string;
  checkAnkiConnect: () => Promise<AnkiConnectStatus>;
  getAnkiDecks: () => Promise<string[]>;
  saveCard: (card: CardPayload) => Promise<SaveCardResult>;
  saveRecordedAudio: (payload: { buffer: ArrayBuffer; prefix?: string }) => Promise<{ path: string; filename: string }>;
  selectAudioFile: () => Promise<{ path: string; filename: string } | null>;
  selectDirectory: (title?: string) => Promise<string | null>;
  selectFile: (title?: string) => Promise<string | null>;
  openPath: (targetPath: string) => Promise<void>;
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;

  // Lyrics
  fetchUrl: (url: string) => Promise<string>;
  searchLrclib: (params: { track?: string; artist?: string; q?: string }) => Promise<any[]>;
  getLrclib: (artist: string, track: string) => Promise<any | null>;
  selectLyricsFile: () => Promise<{ filePath: string; filename: string; content: string } | null>;

  // Subtitle Project & Media
  probeMedia: (filePath: string) => Promise<any>;
  cutAudio: (options: any) => Promise<string>;
  extractSnapshot: (options: any) => Promise<string>;
  extractEmbeddedSubtitle: (filePath: string, subStreamIndex: number) => Promise<string>;
  selectVideoFile: () => Promise<{ filePath: string; filename: string; probeData: any } | null>;
  selectSubFiles: () => Promise<Array<{ filePath: string; filename: string; content: string }> | null>;
  exportSubtitleProject: (project: any, options?: any) => Promise<{ txtPath: string; exportedCount: number; cancelled?: boolean; errors: string[] }>;
  cancelSubtitleExport?: () => Promise<boolean>;
  onExportProgress: (callback: (progress: any) => void) => () => void;
  saveProjectDialog: (project: any, defaultPath?: string) => Promise<string | null>;
  saveProjectToPath: (filePath: string, project: any) => Promise<string>;
  loadProjectDialog: () => Promise<{ filePath: string; project: any } | null>;
  loadProjectFromPath?: (filePath: string) => Promise<{ filePath: string; project: any }>;
  registerRecentProject?: (filePath: string, name?: string) => Promise<boolean>;

  // DevTools & Menu
  toggleDevTools: () => Promise<void>;
  onMenuSwitchMode: (callback: (mode: string) => void) => () => void;
  onMenuTriggerAction: (callback: (action: string) => void) => () => void;
  onMenuOpenRecentProject?: (callback: (filePath: string) => void) => () => void;
  onMainLog: (callback: (log: any) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

@Injectable({
  providedIn: 'root'
})
export class ElectronService {
  public readonly isElectron = !!window.electronAPI;
  public pendingRecentProjectPath: string | null = null;

  constructor(private zone: NgZone) {}

  private get api(): ElectronAPI {
    if (!window.electronAPI) {
      throw new Error('Electron API não está disponível no navegador.');
    }
    return window.electronAPI;
  }

  public async ping(): Promise<string> {
    return this.isElectron ? await this.api.ping() : 'mock-pong';
  }

  public getPathForFile(file: File): string {
    if (this.isElectron && window.electronAPI?.getPathForFile) {
      try {
        return window.electronAPI.getPathForFile(file) || '';
      } catch {
        return (file as any).path || '';
      }
    }
    return (file as any).path || '';
  }

  public async checkAnkiConnect(): Promise<AnkiConnectStatus> {
    if (!this.isElectron) {
      return { connected: false, error: 'Executando no navegador' };
    }
    return await this.api.checkAnkiConnect();
  }

  public async getAnkiDecks(): Promise<string[]> {
    return this.isElectron ? await this.api.getAnkiDecks() : ['Default', 'Inglês::Músicas'];
  }

  public async saveCard(card: CardPayload): Promise<SaveCardResult> {
    if (!this.isElectron) {
      return { success: true, savedToFile: true, ankiNoteId: 123456 };
    }
    return await this.api.saveCard(card);
  }

  public async saveRecordedAudio(buffer: ArrayBuffer, prefix?: string): Promise<{ path: string; filename: string }> {
    if (!this.isElectron) {
      return { path: 'mock/path.mp3', filename: 'mock.mp3' };
    }
    return await this.api.saveRecordedAudio({ buffer, prefix });
  }

  public async selectAudioFile(): Promise<{ path: string; filename: string } | null> {
    return this.isElectron ? await this.api.selectAudioFile() : null;
  }

  public async selectDirectory(title?: string): Promise<string | null> {
    return this.isElectron ? await this.api.selectDirectory(title) : null;
  }

  public async selectFile(title?: string): Promise<string | null> {
    return this.isElectron ? await this.api.selectFile(title) : null;
  }

  public async openPath(targetPath: string): Promise<void> {
    if (this.isElectron) {
      await this.api.openPath(targetPath);
    }
  }

  public async getSettings(): Promise<AppSettings> {
    if (!this.isElectron) {
      return {
        deckName: 'Default',
        defaultTags: 'English SentenceMining',
        ankiCollectionMediaDir: '',
        exportTxtPath: 'anki_cards.txt',
        ankiConnectUrl: 'http://127.0.0.1:8765',
        saveMode: 'both'
      };
    }
    return await this.api.getSettings();
  }

  public async saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    if (!this.isElectron) {
      return settings as AppSettings;
    }
    return await this.api.saveSettings(settings);
  }

  public async fetchUrl(url: string): Promise<string> {
    if (!this.isElectron) {
      throw new Error('Fetch via Electron disponível apenas no aplicativo Desktop.');
    }
    return await this.api.fetchUrl(url);
  }

  public async searchLrclib(params: { track?: string; artist?: string; q?: string }): Promise<any[]> {
    if (!this.isElectron) {
      return [];
    }
    return await this.api.searchLrclib(params);
  }

  public async getLrclib(artist: string, track: string): Promise<any | null> {
    if (!this.isElectron) {
      return null;
    }
    return await this.api.getLrclib(artist, track);
  }

  public async selectLyricsFile(): Promise<{ filePath: string; filename: string; content: string } | null> {
    if (!this.isElectron) {
      return null;
    }
    return await this.api.selectLyricsFile();
  }

  // ================= SUBTITLE PROJECT & MEDIA =================
  public async probeMedia(filePath: string): Promise<any> {
    if (!this.isElectron) return null;
    return await this.api.probeMedia(filePath);
  }

  public async cutAudio(options: any): Promise<string> {
    if (!this.isElectron) return '';
    return await this.api.cutAudio(options);
  }

  public async extractSnapshot(options: any): Promise<string> {
    if (!this.isElectron) return '';
    return await this.api.extractSnapshot(options);
  }

  public async extractEmbeddedSubtitle(filePath: string, subStreamIndex: number): Promise<string> {
    if (!this.isElectron) return '';
    return await this.api.extractEmbeddedSubtitle(filePath, subStreamIndex);
  }

  public async selectVideoFile(): Promise<{ filePath: string; filename: string; probeData: any } | null> {
    if (!this.isElectron) return null;
    return await this.api.selectVideoFile();
  }

  public async selectSubFiles(): Promise<Array<{ filePath: string; filename: string; content: string }> | null> {
    if (!this.isElectron) return null;
    return await this.api.selectSubFiles();
  }

  public async exportSubtitleProject(project: any, options?: any): Promise<{ txtPath: string; exportedCount: number; cancelled?: boolean; errors: string[] }> {
    if (!this.isElectron) return { txtPath: '', exportedCount: 0, errors: ['Apenas no app Desktop'] };
    return await this.api.exportSubtitleProject(project, options);
  }

  public async cancelSubtitleExport(): Promise<boolean> {
    if (!this.isElectron || !this.api.cancelSubtitleExport) return false;
    return await this.api.cancelSubtitleExport();
  }

  public onExportProgress(callback: (progress: any) => void): () => void {
    if (!this.isElectron || !this.api.onExportProgress) return () => {};
    return this.api.onExportProgress((progress: any) => {
      this.zone.run(() => callback(progress));
    });
  }

  public async saveProjectDialog(project: any, defaultPath?: string): Promise<string | null> {
    if (!this.isElectron) return null;
    return await this.api.saveProjectDialog(project, defaultPath);
  }

  public async saveProjectToPath(filePath: string, project: any): Promise<string> {
    if (!this.isElectron) return '';
    return await this.api.saveProjectToPath(filePath, project);
  }

  public async loadProjectDialog(): Promise<{ filePath: string; project: any } | null> {
    if (!this.isElectron) return null;
    return await this.api.loadProjectDialog();
  }

  public async loadProjectFromPath(filePath: string): Promise<{ filePath: string; project: any } | null> {
    if (!this.isElectron || !this.api.loadProjectFromPath) return null;
    return await this.api.loadProjectFromPath(filePath);
  }

  public async registerRecentProject(filePath: string, name?: string): Promise<void> {
    if (this.isElectron && this.api.registerRecentProject && filePath) {
      await this.api.registerRecentProject(filePath, name);
    }
  }

  // ================= DEVTOOLS & MENU =================
  public async toggleDevTools(): Promise<void> {
    if (this.isElectron) {
      await this.api.toggleDevTools();
    }
  }

  public onMenuSwitchMode(callback: (mode: string) => void): () => void {
    if (this.isElectron && this.api.onMenuSwitchMode) {
      return this.api.onMenuSwitchMode((mode: string) => {
        this.zone.run(() => callback(mode));
      });
    }
    return () => {};
  }

  public onMenuTriggerAction(callback: (action: string) => void): () => void {
    if (this.isElectron && this.api.onMenuTriggerAction) {
      return this.api.onMenuTriggerAction((action: string) => {
        this.zone.run(() => callback(action));
      });
    }
    return () => {};
  }

  public onMenuOpenRecentProject(callback: (filePath: string) => void): () => void {
    if (this.isElectron && this.api.onMenuOpenRecentProject) {
      return this.api.onMenuOpenRecentProject((filePath: string) => {
        this.zone.run(() => callback(filePath));
      });
    }
    return () => {};
  }

  public onMainLog(callback: (log: any) => void): () => void {
    if (this.isElectron && this.api.onMainLog) {
      return this.api.onMainLog((log: any) => {
        this.zone.run(() => callback(log));
      });
    }
    return () => {};
  }
}
