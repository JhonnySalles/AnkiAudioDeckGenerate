import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import {
  CutAudioOptions,
  ExtractSnapshotOptions,
  MediaProbeResult,
  MediaAudioStream,
  MediaSubtitleStream
} from '../types/subtitle-project';

export class FfmpegService {
  private static instance: FfmpegService;
  private ffmpegPath: string = '';
  private cacheDir: string;

  private constructor() {
    this.cacheDir = path.join(app.getPath('userData'), 'media_cache');
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    this.initFfmpegPath();
  }

  public static getInstance(): FfmpegService {
    if (!FfmpegService.instance) {
      FfmpegService.instance = new FfmpegService();
    }
    return FfmpegService.instance;
  }

  public getCacheDir(): string {
    return this.cacheDir;
  }

  private initFfmpegPath(): void {
    // 1. Verificar em app unpacked / resources (em produção)
    const unpackedPath = path.join(process.resourcesPath || '', 'bin', 'ffmpeg.exe');
    if (fs.existsSync(unpackedPath)) {
      this.ffmpegPath = unpackedPath;
      return;
    }

    // 2. Verificar pasta lib/subs2srs (em desenvolvimento ou local)
    const localDevPath = path.join(app.getAppPath(), 'lib', 'subs2srs', 'Utils', 'ffmpeg', 'ffmpeg.exe');
    if (fs.existsSync(localDevPath)) {
      this.ffmpegPath = localDevPath;
      return;
    }

    // 3. Fallback: procurar no PATH do sistema
    this.ffmpegPath = 'ffmpeg';
  }

  public getFfmpegPath(): string {
    return this.ffmpegPath;
  }

  public formatSecondsFfmpeg(ms: number): string {
    const totalSeconds = Math.max(0, ms) / 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = (totalSeconds % 60).toFixed(3);

    const hStr = hours.toString().padStart(2, '0');
    const mStr = minutes.toString().padStart(2, '0');
    const sStr = seconds.padStart(6, '0');
    return `${hStr}:${mStr}:${sStr}`;
  }

  public async probe(filePath: string): Promise<MediaProbeResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo não encontrado: ${filePath}`);
    }

    return new Promise((resolve, reject) => {
      const args = ['-i', filePath];
      const proc = spawn(this.ffmpegPath, args);

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', () => {
        try {
          const result = this.parseProbeStderr(filePath, stderr);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Falha ao executar ffmpeg probe: ${err.message}`));
      });
    });
  }

  private parseProbeStderr(filePath: string, stderr: string): MediaProbeResult {
    let durationMs = 0;
    const durMatch = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
    if (durMatch) {
      const h = parseInt(durMatch[1], 10);
      const m = parseInt(durMatch[2], 10);
      const s = parseFloat(durMatch[3]);
      durationMs = Math.round((h * 3600 + m * 60 + s) * 1000);
    }

    const audioStreams: MediaAudioStream[] = [];
    const subtitleStreams: MediaSubtitleStream[] = [];

    // Detecção real de vídeo ignorando capas de álbum (attached pic)
    const lines = stderr.split(/\r?\n/);
    let hasRealVideo = false;
    for (const line of lines) {
      if (/Stream #\d+:\d+.*Video:/i.test(line)) {
        if (!/attached pic/i.test(line)) {
          hasRealVideo = true;
          break;
        }
      }
    }

    let aIndex = 0;
    let sIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const audioMatch = line.match(/Stream #0:(\d+)(?:\(([^)]+)\))?:\s*Audio:\s*([^,\n]+)/i);
      if (audioMatch) {
        let title: string | undefined;
        let channels: number | undefined;

        if (/5\.1/i.test(line)) channels = 6;
        else if (/7\.1/i.test(line)) channels = 8;
        else if (/stereo/i.test(line)) channels = 2;
        else if (/mono/i.test(line)) channels = 1;

        // Tentar capturar título nos metadados seguintes
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (lines[j].includes('Stream #')) break;
          const titleMatch = lines[j].match(/title\s*:\s*(.+)/i);
          if (titleMatch) {
            title = titleMatch[1].trim();
            break;
          }
        }

        audioStreams.push({
          index: aIndex++,
          codec: audioMatch[3].trim(),
          language: audioMatch[2]?.trim(),
          title,
          channels
        });
      }

      const subMatch = line.match(/Stream #0:(\d+)(?:\(([^)]+)\))?:\s*Subtitle:\s*([^,\n]+)/i);
      if (subMatch) {
        let title: string | undefined;
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (lines[j].includes('Stream #')) break;
          const titleMatch = lines[j].match(/title\s*:\s*(.+)/i);
          if (titleMatch) {
            title = titleMatch[1].trim();
            break;
          }
        }

        subtitleStreams.push({
          index: sIndex++,
          codec: subMatch[3].trim(),
          language: subMatch[2]?.trim(),
          title
        });
      }
    }

    return {
      filePath,
      durationMs,
      audioStreams,
      subtitleStreams,
      hasVideo: hasRealVideo
    };
  }

  public async cutAudio(options: CutAudioOptions): Promise<string> {
    const {
      sourcePath,
      audioStreamIndex = 0,
      startMs,
      endMs,
      outputPath,
      trimSilence = true,
      normalizeAudio = true
    } = options;

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Arquivo fonte de mídia não encontrado: ${sourcePath}`);
    }

    // Se outputPath for caminho relativo, colocar dentro do cacheDir
    const resolvedOut = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(this.cacheDir, outputPath);

    const outDir = path.dirname(resolvedOut);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const startStr = this.formatSecondsFfmpeg(startMs);
    const durationMs = Math.max(100, endMs - startMs);
    const durationStr = (durationMs / 1000).toFixed(3);

    // Construtor dos filtros de áudio
    const buildArgs = (includeFilters: boolean) => {
      const args = [
        '-y',
        '-ss', startStr,
        '-t', durationStr,
        '-i', sourcePath,
        '-map', `0:a:${audioStreamIndex}`,
        '-vn', '-sn', '-dn',
        '-ac', '2',
        '-ar', '44100'
      ];

      if (includeFilters) {
        const afFilters: string[] = [];
        if (trimSilence) {
          // Trimming de silêncio no início e fim
          afFilters.push('silenceremove=start_periods=1:start_duration=0.03:start_threshold=-40dB:detection=peak');
          afFilters.push('areverse');
          afFilters.push('silenceremove=start_periods=1:start_duration=0.03:start_threshold=-40dB:detection=peak');
          afFilters.push('areverse');
        }
        if (normalizeAudio) {
          // Normalização EBU R128 para MP3 padronizado
          afFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
        }
        if (afFilters.length > 0) {
          args.push('-af', afFilters.join(','));
        }
      }

      args.push(
        '-c:a', 'libmp3lame',
        '-q:a', '4',
        resolvedOut
      );
      return args;
    };

    const runFfmpeg = (args: string[]) => new Promise<void>((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, args);
      let stderr = '';

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(resolvedOut) && fs.statSync(resolvedOut).size > 0) {
          resolve();
        } else {
          reject(new Error(`Falha no corte de áudio (code ${code}): ${stderr.slice(-300)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Erro ao executar ffmpeg: ${err.message}`));
      });
    });

    try {
      // 1. Tentar com filtros de normalização e remoção de silêncio
      await runFfmpeg(buildArgs(true));
      return resolvedOut;
    } catch (filterErr) {
      // 2. Se falhar (ex: áudio 100% silêncio descartado pelo silenceremove), tenta sem os filtros avançados
      try {
        await runFfmpeg(buildArgs(false));
        return resolvedOut;
      } catch (err: any) {
        throw new Error(`Falha ao processar áudio: ${err.message}`);
      }
    }
  }

  public async extractSnapshot(options: ExtractSnapshotOptions): Promise<string> {
    const { sourcePath, atMs, outputPath, width = 480 } = options;

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Arquivo fonte de vídeo não encontrado: ${sourcePath}`);
    }

    const resolvedOut = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(this.cacheDir, outputPath);

    const outDir = path.dirname(resolvedOut);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const timeStr = this.formatSecondsFfmpeg(atMs);

    return new Promise((resolve, reject) => {
      // Adicionamos -pix_fmt yuvj420p para compatibilidade perfeita com vídeos 10-bit (HEVC 10-bit)
      const args = [
        '-y',
        '-ss', timeStr,
        '-i', sourcePath,
        '-frames:v', '1',
        '-vf', `scale=${width}:-2`,
        '-pix_fmt', 'yuvj420p',
        '-q:v', '3',
        resolvedOut
      ];

      const proc = spawn(this.ffmpegPath, args);
      let stderr = '';

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(resolvedOut)) {
          resolve(resolvedOut);
        } else {
          reject(new Error(`Falha na extração de snapshot (code ${code}): ${stderr.slice(-300)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Erro ao executar ffmpeg snapshot: ${err.message}`));
      });
    });
  }

  /**
   * Extrai legenda embutida de arquivo MKV/MP4/TS
   */
  public async extractEmbeddedSubtitle(sourcePath: string, subStreamIndex: number): Promise<string> {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Arquivo não encontrado: ${sourcePath}`);
    }

    const tempOut = path.join(this.cacheDir, `sub_extract_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.srt`);

    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-i', sourcePath,
        '-map', `0:s:${subStreamIndex}`,
        tempOut
      ];

      const proc = spawn(this.ffmpegPath, args);
      let stderr = '';

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(tempOut)) {
          try {
            const content = fs.readFileSync(tempOut, 'utf-8');
            fs.unlinkSync(tempOut);
            resolve(content);
          } catch (err: any) {
            reject(new Error(`Erro ao ler legenda extraída: ${err.message}`));
          }
        } else {
          reject(new Error(`Falha ao extrair legenda (code ${code}): ${stderr.slice(-300)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Erro ao executar extração de legenda: ${err.message}`));
      });
    });
  }
}

