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
}

export interface SaveCardResult {
  success: boolean;
  ankiNoteId?: number;
  savedToFile?: boolean;
  filePath?: string;
  audioSavedToMedia?: boolean;
  error?: string;
}
