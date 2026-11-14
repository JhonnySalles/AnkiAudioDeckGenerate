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
