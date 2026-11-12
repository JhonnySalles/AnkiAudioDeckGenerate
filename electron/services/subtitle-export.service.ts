import * as fs from 'fs';
import * as path from 'path';
import { SubtitleProject, OutputConfig, SubtitleExportOptions, SubtitleExportProgress } from '../types/subtitle-project';
import { FfmpegService } from './ffmpeg.service';
import { SettingsService } from './settings.service';

export class SubtitleExportService {
  private static instance: SubtitleExportService;

  private constructor() {}

  public static getInstance(): SubtitleExportService {
    if (!SubtitleExportService.instance) {
      SubtitleExportService.instance = new SubtitleExportService();
    }
    return SubtitleExportService.instance;
  }

  private sanitizeBase(text: string): string {
    return text
      .trim()
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '_');
  }

  private msToIdTime(ms: number): string {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  private msToFileNameTime(ms: number): string {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor(Math.max(0, ms) % 1000);
    return `${hours}.${minutes.toString().padStart(2, '0')}.${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }

  public async exportProject(
    project: SubtitleProject,
    options?: Partial<SubtitleExportOptions>,
    onProgress?: (p: SubtitleExportProgress) => void
  ): Promise<{ txtPath: string; exportedCount: number; errors: string[] }> {
    const ffmpeg = FfmpegService.getInstance();
    const settings = SettingsService.getInstance().getSettings();

    const generateAudio = options?.generateAudio !== false;
    const generateImages = options?.generateImages !== false;
    const copyToAnki = options?.copyToAnkiCollectionMedia !== false;

    const mediaDir = options?.mediaOutputDir || (copyToAnki ? settings.ankiCollectionMediaDir : '');
    if (mediaDir && !fs.existsSync(mediaDir)) {
      try {
        fs.mkdirSync(mediaDir, { recursive: true });
      } catch (err: any) {
        console.error(`Erro ao criar pasta de mídia '${mediaDir}':`, err);
      }
    }

    const safeMediaName = this.sanitizeBase(project?.mediaName || 'Deck');

    let outTxtFile = options?.outputTxtPath;
    if (!outTxtFile) {
      const outputTxtDir = settings.exportTxtPath ? path.dirname(settings.exportTxtPath) : process.cwd();
      outTxtFile = path.join(outputTxtDir, `${safeMediaName}_anki.txt`);
    }

    const outDir = path.dirname(outTxtFile);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const rows = Array.isArray(project?.rows) ? project.rows : [];
    const validRows = rows.filter(r => !r?.excluded);
    const total = validRows.length;
    const errors: string[] = [];

    // Padding com zeros à esquerda: mínimo de 4 dígitos, ou mais se total passar de 9999
    const padLength = Math.max(4, String(total).length);

    const lines: string[] = [];
    const mediaSourceMap = new Map<string, string>();
    const mediaSources = Array.isArray(project?.mediaSources) ? project.mediaSources : [];
    mediaSources.forEach(s => mediaSourceMap.set(s.id, s.filePath));
    const tracks = Array.isArray(project?.tracks) ? project.tracks : [];

    // Cabeçalhos Anki
    if (project?.output?.writeAnkiHeaders) {
      const sep = project.output.separator || '\t';
      const sepHeader = sep === '\t' ? '#separator:tab' : `#separator:${sep}`;
      lines.push(sepHeader);
      lines.push('#html:true');
    }

    // Configuração de colunas de saída
    const outputConfig = project.output || {
      separator: '\t',
      quoteMode: 'when-needed',
      linePrefix: '',
      lineSuffix: '',
      writeAnkiHeaders: true,
      columns: ['id', 'seq', 'sound_1', 'image_1', 'text_1'],
      tags: []
    };
    const separator = outputConfig.separator || '\t';

    // Helper para resolver id de faixa a partir da chave de coluna (suporta 'sound_trk123' ou 'sound_1')
    const resolveTrackId = (keySuffix: string): string => {
      const directMatch = tracks.find(t => t.id === keySuffix);
      if (directMatch) return directMatch.id;
      const idx = parseInt(keySuffix, 10) - 1;
      if (!isNaN(idx) && tracks[idx]) return tracks[idx].id;
      return keySuffix;
    };

    // Estrutura para enfileirar as tarefas de mídia a serem processadas pelo FFmpeg
    interface RowMediaTask {
      mediaFilePath: string;
      streamIdx: number;
      effectiveStart: number;
      effectiveEnd: number;
      midTime: number;
      audioBaseName: string;
      imageBaseName: string;
      hasRealVideo: boolean;
      shouldCutAudio: boolean;
      shouldExtractImage: boolean;
    }

    const rowsMediaTasks: RowMediaTask[][] = [];

    // =========================================================================
    // ETAPA 1: GERAR TODAS AS LINHAS E GRAVAR O ARQUIVO .TXT PRIMEIRO
    // =========================================================================
    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      const seq = i + 1;
      const seqStr = String(seq).padStart(padLength, '0');

      // Determinar tempo do ID com base em timingTrackId
      const cellsObj = row.cells || {};
      const timingCell = cellsObj[project.timingTrackId] || Object.values(cellsObj).find(c => c !== null);
      const idTimeStr = timingCell ? this.msToIdTime(timingCell.startMs) : '00:00:00';
      const cardId = `${safeMediaName} - ${idTimeStr}`;

      const trackData: Record<string, { soundTag: string; imageTag: string; text: string; start: string; end: string }> = {};
      const currentTasks: RowMediaTask[] = [];

      for (const track of tracks) {
        const cell = cellsObj[track.id];
        if (!cell) {
          trackData[track.id] = { soundTag: '', imageTag: '', text: '', start: '', end: '' };
          continue;
        }

        const mediaFilePath = mediaSourceMap.get(track.mediaSourceId);
        const sourceObj = mediaSources.find(s => s.id === track.mediaSourceId);
        const streamIdx = track.audioStreamIndex !== undefined ? track.audioStreamIndex : (sourceObj ? sourceObj.audioStreamIndex : 0);
        const hasRealVideo = sourceObj ? (sourceObj.hasVideo !== false) : true;

        const effectiveStart = Math.max(0, cell.startMs + (track.offsetMs || 0) - (track.padStartMs || 0));
        const effectiveEnd = Math.max(effectiveStart + 100, cell.endMs + (track.offsetMs || 0) + (track.padEndMs || 0));

        const startFileTime = this.msToFileNameTime(effectiveStart);
        const endFileTime = this.msToFileNameTime(effectiveEnd);
        const midTime = Math.round((effectiveStart + effectiveEnd) / 2);
        const midFileTime = this.msToFileNameTime(midTime);

        // Nomes com sequência padded (0001, 0002...)
        const audioBaseName = `${safeMediaName}_${track.label}_${seqStr}_${startFileTime}-${endFileTime}.mp3`;
        const imageBaseName = `${safeMediaName}_${track.label}_${seqStr}_${midFileTime}.jpg`;

        const cleanText = cell.text.replace(/\r?\n/g, '<br>').trim();
        trackData[track.id] = {
          soundTag: generateAudio ? `[sound:${audioBaseName}]` : '',
          imageTag: (generateImages && hasRealVideo) ? `<img src="${imageBaseName}">` : '',
          text: cleanText,
          start: this.msToIdTime(cell.startMs),
          end: this.msToIdTime(cell.endMs)
        };

        if (mediaFilePath && fs.existsSync(mediaFilePath)) {
          currentTasks.push({
            mediaFilePath,
            streamIdx,
            effectiveStart,
            effectiveEnd,
            midTime,
            audioBaseName,
            imageBaseName,
            hasRealVideo,
            shouldCutAudio: generateAudio,
            shouldExtractImage: generateImages && hasRealVideo
          });
        }
      }

      rowsMediaTasks.push(currentTasks);

      // Montar colunas conforme outputConfig.columns selecionadas
      const rowValues: string[] = [];
      for (const colKey of (outputConfig.columns || [])) {
        if (colKey === 'id') {
          rowValues.push(cardId);
        } else if (colKey === 'seq') {
          rowValues.push(seqStr);
        } else if (colKey === 'time') {
          rowValues.push(idTimeStr);
        } else if (colKey.startsWith('sound_')) {
          const tId = resolveTrackId(colKey.replace('sound_', ''));
          rowValues.push(trackData[tId]?.soundTag || '');
        } else if (colKey.startsWith('image_')) {
          const tId = resolveTrackId(colKey.replace('image_', ''));
          rowValues.push(trackData[tId]?.imageTag || '');
        } else if (colKey.startsWith('text_')) {
          const tId = resolveTrackId(colKey.replace('text_', ''));
          rowValues.push(trackData[tId]?.text || '');
        } else if (colKey.startsWith('start_')) {
          const tId = resolveTrackId(colKey.replace('start_', ''));
          rowValues.push(trackData[tId]?.start || '');
        } else if (colKey.startsWith('end_')) {
          const tId = resolveTrackId(colKey.replace('end_', ''));
          rowValues.push(trackData[tId]?.end || '');
        } else if (colKey === 'tags') {
          rowValues.push((outputConfig.tags || []).join(' '));
        } else {
          rowValues.push('');
        }
      }

      // Aplicar quoteMode
      const formattedCols = rowValues.map(v => {
        if (outputConfig.quoteMode === 'always') {
          return `"${v.replace(/"/g, '""')}"`;
        }
        if (outputConfig.quoteMode === 'when-needed' && (v.includes(separator) || v.includes('"') || v.includes('\n'))) {
          return `"${v.replace(/"/g, '""')}"`;
        }
        return v;
      });

      const lineContent = formattedCols.join(separator);
      const fullLine = `${outputConfig.linePrefix || ''}${lineContent}${outputConfig.lineSuffix || ''}`;
      lines.push(fullLine);
    }

    // Grava o arquivo .txt ANTES de qualquer processamento pesado de mídia
    fs.writeFileSync(outTxtFile, lines.join('\n'), 'utf-8');

    if (onProgress) {
      onProgress({
        current: 0,
        total,
        percentage: 0,
        status: (generateAudio || generateImages)
          ? `Arquivo de texto (.txt) gravado com sucesso! Iniciando extração de mídia...`
          : `Exportação concluída com sucesso! (Arquivo .txt gravado)`
      });
    }

    // =========================================================================
    // ETAPA 2: EXTRAÇÃO DE ÁUDIOS E IMAGENS COM O FFMPEG
    // =========================================================================
    if (generateAudio || generateImages) {
      for (let i = 0; i < rowsMediaTasks.length; i++) {
        const tasks = rowsMediaTasks[i];

        for (const task of tasks) {
          // 1. Gerar áudio se habilitado
          if (task.shouldCutAudio) {
            const tempAudioPath = path.join(ffmpeg.getCacheDir(), task.audioBaseName);
            try {
              await ffmpeg.cutAudio({
                sourcePath: task.mediaFilePath,
                audioStreamIndex: task.streamIdx,
                startMs: task.effectiveStart,
                endMs: task.effectiveEnd,
                outputPath: tempAudioPath,
                trimSilence: options?.trimSilence !== false,
                normalizeAudio: options?.normalizeAudio !== false
              });

              if (mediaDir && fs.existsSync(mediaDir)) {
                fs.copyFileSync(tempAudioPath, path.join(mediaDir, task.audioBaseName));
              }
            } catch (err: any) {
              errors.push(`Áudio ${task.audioBaseName}: ${err.message}`);
            }
          }

          // 2. Gerar snapshot apenas se a fonte tiver vídeo real e geração de imagem estiver habilitada
          if (task.shouldExtractImage && task.hasRealVideo) {
            const tempImagePath = path.join(ffmpeg.getCacheDir(), task.imageBaseName);
            try {
              await ffmpeg.extractSnapshot({
                sourcePath: task.mediaFilePath,
                atMs: task.midTime,
                outputPath: tempImagePath,
                width: 480
              });

              if (mediaDir && fs.existsSync(mediaDir)) {
                fs.copyFileSync(tempImagePath, path.join(mediaDir, task.imageBaseName));
              }
            } catch (err: any) {
              errors.push(`Imagem ${task.imageBaseName}: ${err.message}`);
            }
          }
        }

        if (onProgress) {
          const percentage = Math.round(((i + 1) / total) * 100);
          onProgress({
            current: i + 1,
            total,
            percentage,
            status: `Processando mídias ${i + 1} de ${total} (${percentage}%)...`
          });
        }
      }
    } else {
      if (onProgress) {
        onProgress({
          current: total,
          total,
          percentage: 100,
          status: `Exportação concluída com sucesso! (100%)`
        });
      }
    }

    return {
      txtPath: outTxtFile,
      exportedCount: validRows.length,
      errors
    };
  }
}

