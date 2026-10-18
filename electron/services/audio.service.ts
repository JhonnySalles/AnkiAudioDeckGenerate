import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export class AudioService {
  private static instance: AudioService;
  private audioDir: string;

  private constructor() {
    this.audioDir = path.join(app.getPath('userData'), 'audio_cache');
    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
    }
  }

  public static getInstance(): AudioService {
    if (!AudioService.instance) {
      AudioService.instance = new AudioService();
    }
    return AudioService.instance;
  }

  public sanitizeFilename(base: string, ext = '.mp3'): string {
    const clean = base
      .trim()
      .slice(0, 30)
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '_');
    const timestamp = Date.now();
    return `${clean || 'audio'}_${timestamp}${ext}`;
  }

  public async saveAudioBuffer(buffer: Buffer, originalName?: string, suggestedPrefix?: string): Promise<{ path: string; filename: string }> {
    const ext = originalName ? path.extname(originalName) || '.mp3' : '.mp3';
    const filename = this.sanitizeFilename(suggestedPrefix || originalName || 'record', ext);
    const targetPath = path.join(this.audioDir, filename);

    fs.writeFileSync(targetPath, buffer);
    return {
      path: targetPath,
      filename
    };
  }

  public async importLocalFile(sourcePath: string): Promise<{ path: string; filename: string }> {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Arquivo não encontrado: ${sourcePath}`);
    }

    const ext = path.extname(sourcePath);
    const baseName = path.basename(sourcePath, ext);
    const filename = this.sanitizeFilename(baseName, ext);
    const targetPath = path.join(this.audioDir, filename);

    fs.copyFileSync(sourcePath, targetPath);
    return {
      path: targetPath,
      filename
    };
  }
}
