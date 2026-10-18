import { AnkiConnectStatus, CardPayload } from '../types/anki';
import { SettingsService } from './settings.service';
import * as fs from 'fs';
import * as path from 'path';

export class AnkiConnectService {
  private static instance: AnkiConnectService;

  private constructor() {}

  public static getInstance(): AnkiConnectService {
    if (!AnkiConnectService.instance) {
      AnkiConnectService.instance = new AnkiConnectService();
    }
    return AnkiConnectService.instance;
  }

  private getUrl(): string {
    return SettingsService.getInstance().getSettings().ankiConnectUrl || 'http://127.0.0.1:8765';
  }

  private async invoke<T = any>(action: string, params: Record<string, any> = {}, version = 6): Promise<T> {
    const url = this.getUrl();
    const payload = { action, version, params };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP Error from AnkiConnect: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { result: T; error: string | null };
    if (data.error) {
      throw new Error(data.error);
    }

    return data.result;
  }

  public async checkStatus(): Promise<AnkiConnectStatus> {
    try {
      const version = await this.invoke<number>('version');
      const decks = await this.invoke<string[]>('deckNames');
      return {
        connected: true,
        version,
        decks
      };
    } catch (err: any) {
      return {
        connected: false,
        error: err.message || 'AnkiConnect não está respondendo em ' + this.getUrl()
      };
    }
  }

  public async getDecks(): Promise<string[]> {
    try {
      return await this.invoke<string[]>('deckNames');
    } catch {
      return [];
    }
  }

  public async getModels(): Promise<string[]> {
    try {
      return await this.invoke<string[]>('modelNames');
    } catch {
      return [];
    }
  }

  public async addNote(card: CardPayload): Promise<number> {
    let audioTag = '';
    if (card.audioPath && fs.existsSync(card.audioPath)) {
      const filename = card.audioFileName || path.basename(card.audioPath);
      try {
        const fileData = fs.readFileSync(card.audioPath);
        const base64Data = fileData.toString('base64');
        await this.invoke('storeMediaFile', {
          filename,
          data: base64Data
        });
        audioTag = ` [sound:${filename}]`;
      } catch (mediaErr) {
        console.warn('[AnkiConnectService] Failed to store media file in Anki:', mediaErr);
      }
    }

    const models = await this.getModels();
    let chosenModel = 'Basic';
    if (!models.includes('Basic')) {
      chosenModel = models[0] || 'Basic';
    }

    const frontContent = card.front.trim() + audioTag;
    const backContent = card.back.trim();

    const notePayload = {
      note: {
        deckName: card.deckName || 'Default',
        modelName: chosenModel,
        fields: {
          Front: frontContent,
          Back: backContent
        },
        tags: card.tags || []
      }
    };

    const noteId = await this.invoke<number>('addNote', notePayload);
    return noteId;
  }
}
