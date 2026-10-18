import * as fs from 'fs';
import * as path from 'path';
import { CardPayload } from '../types/anki';
import { SettingsService } from './settings.service';

export class AnkiFileService {
  private static instance: AnkiFileService;

  private constructor() {}

  public static getInstance(): AnkiFileService {
    if (!AnkiFileService.instance) {
      AnkiFileService.instance = new AnkiFileService();
    }
    return AnkiFileService.instance;
  }

  public async saveToFile(card: CardPayload): Promise<{ savedToFile: boolean; filePath: string; audioSavedToMedia: boolean }> {
    const settings = SettingsService.getInstance().getSettings();
    const exportPath = settings.exportTxtPath || path.join(process.cwd(), 'anki_cards.txt');

    const dir = path.dirname(exportPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const fileExists = fs.existsSync(exportPath);
    if (!fileExists) {
      const header = `#separator:tab\n#html:true\n#tags column:4\n`;
      fs.writeFileSync(exportPath, header, 'utf-8');
    }

    let soundTag = '';
    let audioSavedToMedia = false;

    if (card.audioPath && fs.existsSync(card.audioPath)) {
      const audioFileName = card.audioFileName || path.basename(card.audioPath);
      soundTag = `[sound:${audioFileName}]`;

      if (settings.ankiCollectionMediaDir && fs.existsSync(settings.ankiCollectionMediaDir)) {
        try {
          const destAudioPath = path.join(settings.ankiCollectionMediaDir, audioFileName);
          fs.copyFileSync(card.audioPath, destAudioPath);
          audioSavedToMedia = true;
        } catch (copyErr) {
          console.warn('[AnkiFileService] Failed to copy audio to collection.media:', copyErr);
        }
      }
    }

    const cleanFront = card.front.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    const cleanBack = card.back.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    const tagsStr = (card.tags || []).join(' ');

    const line = `${cleanFront}\t${cleanBack}\t${soundTag}\t${tagsStr}\n`;
    fs.appendFileSync(exportPath, line, 'utf-8');

    return {
      savedToFile: true,
      filePath: exportPath,
      audioSavedToMedia
    };
  }
}
