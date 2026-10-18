import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { AppSettings } from '../types/anki';

export class SettingsService {
  private static instance: SettingsService;
  private settingsFilePath: string;
  private settings: AppSettings;

  private constructor() {
    const userData = app.getPath('userData');
    this.settingsFilePath = path.join(userData, 'anki-card-creator-settings.json');
    this.settings = this.loadDefaults();
    this.load();
  }

  public static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
    return SettingsService.instance;
  }

  private loadDefaults(): AppSettings {
    let defaultMediaDir = '';
    const appData = process.env['APPDATA'] || '';
    if (appData) {
      const ankiUserDir = path.join(appData, 'Anki2', 'User 1', 'collection.media');
      if (fs.existsSync(ankiUserDir)) {
        defaultMediaDir = ankiUserDir;
      }
    }

    const defaultTxtExport = path.join(process.cwd(), 'anki_cards.txt');

    return {
      deckName: 'Default',
      defaultTags: 'English SentenceMining',
      ankiCollectionMediaDir: defaultMediaDir,
      exportTxtPath: defaultTxtExport,
      ankiConnectUrl: 'http://127.0.0.1:8765',
      saveMode: 'both'
    };
  }

  private load(): void {
    try {
      if (fs.existsSync(this.settingsFilePath)) {
        const raw = fs.readFileSync(this.settingsFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.settings = { ...this.settings, ...parsed };
      }
    } catch (err) {
      console.warn('[SettingsService] Failed to load settings from file:', err);
    }
  }

  public getSettings(): AppSettings {
    return { ...this.settings };
  }

  public saveSettings(newSettings: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...newSettings };
    try {
      fs.writeFileSync(this.settingsFilePath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SettingsService] Failed to save settings to file:', err);
    }
    return { ...this.settings };
  }
}
