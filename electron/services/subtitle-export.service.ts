import * as fs from 'fs';
import * as path from 'path';
import { SubtitleProject, OutputConfig, SubtitleExportOptions, SubtitleExportProgress } from '../types/subtitle-project';
import { FfmpegService } from './ffmpeg.service';
import { SettingsService } from './settings.service';

export class SubtitleExportService {
  private static instance: SubtitleExportService;
  private isCancelled = false;

  private constructor() {}

  public static getInstance(): SubtitleExportService {
    if (!SubtitleExportService.instance) {
      SubtitleExportService.instance = new SubtitleExportService();
    }
    return SubtitleExportService.instance;
  }

  public cancelExport(): void {
    this.isCancelled = true;
    FfmpegService.getInstance().cancelAllActive();
  }

  private sanitizeBase(text: string): string {
    return text
      .trim()
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '_');
  }

  private formatMediaFileName(
    template: string | undefined,
    defaultTemplate: string,
    vars: {
      id: string;
      name: string;
      track: string;
      seq: string;
      start: string;
      end: string;
      mid: string;
    },
    extension: string
  ): string {
    const rawTemplate = (template && template.trim().length > 0) ? template : defaultTemplate;
    let formatted = rawTemplate
      .replace(/\{id\}/gi, vars.id)
      .replace(/\{name\}/gi, vars.name)
      .replace(/\{track\}/gi, vars.track)
      .replace(/\{seq\}/gi, vars.seq)
      .replace(/\{start\}/gi, vars.start)
      .replace(/\{end\}/gi, vars.end)
      .replace(/\{mid\}/gi, vars.mid);

    // Remover apenas caracteres inválidos para nome de arquivo, preservando espaços digitados
    formatted = formatted.replace(/[\\/:*?"<>|]/g, '').trim();

    if (!formatted) {
      formatted = `${vars.id}_${vars.seq}`;
    }

    const extLower = extension.toLowerCase().replace(/^\./, '');
    if (formatted.toLowerCase().endsWith(`.${extLower}`)) {
      return formatted;
    }
    return `${formatted}.${extLower}`;
  }

  private formatCardId(
    template: string | undefined,
    vars: {
      name: string;
      seq: string;
      time: string;
      start: string;
      end: string;
      mid: string;
      track: string;
    }
  ): string {
    const rawTemplate = (template && template.trim().length > 0) ? template : '{name} - {time}';
    const formatted = rawTemplate
      .replace(/\{name\}/gi, vars.name)
      .replace(/\{seq\}/gi, vars.seq)
      .replace(/\{time\}/gi, vars.time)
      .replace(/\{start\}/gi, vars.start)
      .replace(/\{end\}/gi, vars.end)
      .replace(/\{mid\}/gi, vars.mid)
      .replace(/\{track\}/gi, vars.track)
      .trim();

    return formatted || `${vars.name} - ${vars.time}`;
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
  ): Promise<{ txtPath: string; exportedCount: number; cancelled?: boolean; errors: string[] }> {
    const ffmpeg = FfmpegService.getInstance();
    this.isCancelled = false;
    ffmpeg.resetCancel();
    const settings = SettingsService.getInstance().getSettings();

    const generateAudio = options?.generateAudio !== false;
    const generateImages = options?.generateImages !== false;
    const generateVideos = options?.generateVideos === true;
    const copyToAnki = options?.copyToAnkiCollectionMedia !== false;

    const audioFormat = options?.audioFormat || settings.audioFormat || 'mp3';
    const audioBitrate = options?.audioBitrate || settings.audioBitrate || '128k';
    const trimSilence = options?.trimSilence !== undefined ? options.trimSilence : (settings.trimSilence !== false);
    const normalizeAudio = options?.normalizeAudio !== undefined ? options.normalizeAudio : (settings.normalizeAudio !== false);

    const imageWidth = options?.imageWidth || settings.imageWidth || 480;
    const imageHeight = options?.imageHeight || settings.imageHeight || 270;

    const videoWidth = options?.videoWidth || settings.videoWidth || 640;
    const videoHeight = options?.videoHeight || settings.videoHeight || 360;
    const videoBitrate = options?.videoBitrate || settings.videoBitrate || '800k';

    const rawMediaName = (project?.mediaName || 'Deck').trim() || 'Deck';
    const safeMediaName = this.sanitizeBase(rawMediaName) || 'Deck';
    const templateLiteral = (!project?.hasImportedId && project?.idTemplate)
      ? project.idTemplate.replace(/\{[^}]+\}/g, '').replace(/[-_\s]+$/g, '').trim()
      : '';
    const defaultTxtBase = this.sanitizeBase(templateLiteral || rawMediaName) || safeMediaName;

    // Configuração de colunas e formato de saída
    const outputConfig: OutputConfig = project.output || {
      separator: '\t',
      quoteMode: 'when-needed',
      linePrefix: '',
      lineSuffix: '',
      writeAnkiHeaders: true,
      columns: ['id', 'seq', 'sound_1', 'image_1', 'text_1'],
      tags: []
    };
    const isCsv = outputConfig.separator === 'csv';
    const isSql = outputConfig.separator === 'sql';
    const separator = isCsv ? ',' : (outputConfig.separator || '\t');

    let outTxtFile = options?.outputTxtPath?.trim();
    if (!outTxtFile) {
      const outputTxtDir = settings.exportTxtPath ? path.dirname(settings.exportTxtPath) : process.cwd();
      const ext = isCsv ? '.csv' : (isSql ? '.sql' : '.txt');
      outTxtFile = path.join(outputTxtDir, `${defaultTxtBase}_anki${ext}`);
    }

    const outDir = path.dirname(outTxtFile);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const errors: string[] = [];

    // Resolver diretórios de destino das mídias (se não informado, cria pasta _midia no mesmo diretório do TXT)
    const txtBaseName = path.basename(outTxtFile, path.extname(outTxtFile));
    const defaultMediaDir = path.join(outDir, `${txtBaseName}_midia`);
    const mediaDirs: string[] = [];

    const requestedMediaDir = options?.mediaOutputDir?.trim();
    if (requestedMediaDir) {
      mediaDirs.push(requestedMediaDir);
    } else {
      mediaDirs.push(defaultMediaDir);
    }

    if (copyToAnki && settings.ankiCollectionMediaDir?.trim()) {
      const ankiDir = settings.ankiCollectionMediaDir.trim();
      if (!mediaDirs.some(d => path.resolve(d).toLowerCase() === path.resolve(ankiDir).toLowerCase())) {
        mediaDirs.push(ankiDir);
      }
    }

    for (const dir of mediaDirs) {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (err: any) {
          console.error(`Erro ao criar pasta de mídia '${dir}':`, err);
          errors.push(`Erro ao criar pasta de mídia '${dir}': ${err.message}`);
        }
      }
    }

    const audioTemplate = options?.audioNameTemplate ?? outputConfig.audioNameTemplate;
    const imageTemplate = options?.imageNameTemplate ?? outputConfig.imageNameTemplate;
    const videoTemplate = options?.videoNameTemplate ?? outputConfig.videoNameTemplate;

    console.log(`[Export] Arquivo de saída: ${outTxtFile}`);
    console.log(`[Export] Pastas de mídia: ${mediaDirs.join(' | ')}`);
    console.log(`[Export] Templates: audio="${audioTemplate || ''}", image="${imageTemplate || ''}", video="${videoTemplate || ''}"`);

    const rows = Array.isArray(project?.rows) ? project.rows : [];
    const validRows = rows.filter(r => !r?.excluded);
    const total = validRows.length;

    // Padding com zeros à esquerda: mínimo de 4 dígitos, ou mais se total passar de 9999
    const padLength = Math.max(4, String(total).length);

    const lines: string[] = [];
    const mediaSourceMap = new Map<string, string>();
    const mediaSources = Array.isArray(project?.mediaSources) ? project.mediaSources : [];
    mediaSources.forEach(s => mediaSourceMap.set(s.id, s.filePath));
    const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
    const cueImportedIdMap = new Map<string, string>();
    for (const track of tracks) {
      for (const cue of (track?.cues || [])) {
        if (cue?.importedId && cue.importedId.trim().length > 0) {
          cueImportedIdMap.set(cue.id, cue.importedId.trim());
        }
      }
    }
    const hasProjectImportedId = Boolean(
      project?.hasImportedId ||
      validRows.some(r => !!r?.customId?.trim()) ||
      cueImportedIdMap.size > 0
    );

    // Cabeçalhos Anki (apenas para formatos tab/delimitados, não para CSV padrão nem SQL)
    if (project?.output?.writeAnkiHeaders && !isCsv && !isSql) {
      const sep = separator;
      const sepHeader = sep === '\t' ? '#separator:tab' : `#separator:${sep}`;
      lines.push(sepHeader);
      lines.push('#html:true');
    }

    // Helper para resolver id de faixa a partir da chave de coluna (suporta 'sound_trk123' ou 'sound_1')
    const resolveTrackId = (keySuffix: string): string => {
      const directMatch = tracks.find(t => t.id === keySuffix);
      if (directMatch) return directMatch.id;
      const idx = parseInt(keySuffix, 10) - 1;
      if (!isNaN(idx) && tracks[idx]) return tracks[idx].id;
      return keySuffix;
    };

    // Mapear quais faixas têm colunas selecionadas para cada tipo de mídia no arquivo de saída
    const activeSoundTracks = new Set<string>();
    const activeImageTracks = new Set<string>();
    const activeVideoTracks = new Set<string>();

    for (const colKey of (outputConfig.columns || [])) {
      if (colKey.startsWith('sound_')) {
        activeSoundTracks.add(resolveTrackId(colKey.replace('sound_', '')));
      } else if (colKey.startsWith('image_')) {
        activeImageTracks.add(resolveTrackId(colKey.replace('image_', '')));
      } else if (colKey.startsWith('video_')) {
        activeVideoTracks.add(resolveTrackId(colKey.replace('video_', '')));
      }
    }

    // Estrutura para enfileirar as tarefas de mídia a serem processadas pelo FFmpeg
    interface RowMediaTask {
      mediaFilePath: string;
      streamIdx: number;
      effectiveStart: number;
      effectiveEnd: number;
      midTime: number;
      audioBaseName: string;
      imageBaseName: string;
      videoBaseName: string;
      customImagePath?: string;
      customAudioPath?: string;
      hasRealVideo: boolean;
      shouldCutAudio: boolean;
      shouldExtractImage: boolean;
      shouldCutVideo: boolean;
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
      const refStartMs = timingCell ? timingCell.startMs : 0;
      const refEndMs = timingCell ? timingCell.endMs : 0;
      const refMidMs = Math.round((refStartMs + refEndMs) / 2);
      const idTimeStr = this.msToIdTime(refStartMs);

      const seqTrackObj = tracks.find(t => t.id === project.sequenceTrackId) || tracks[0];
      const seqTrackLabel = (seqTrackObj?.label || 'Faixa').trim();

      // Preservar ID importado do TXT se selecionado na importação; caso contrário, gerar pelo template configurado
      let resolvedImportedId = '';
      if (hasProjectImportedId) {
        if (row.customId && row.customId.trim().length > 0) {
          resolvedImportedId = row.customId.trim();
        } else {
          for (const cell of Object.values(cellsObj)) {
            if (cell?.importedId && cell.importedId.trim().length > 0) {
              resolvedImportedId = cell.importedId.trim();
              break;
            }
            if (cell?.cueIds && cueImportedIdMap.size > 0) {
              const foundCueId = cell.cueIds.find(cid => cueImportedIdMap.has(cid));
              if (foundCueId) {
                resolvedImportedId = cueImportedIdMap.get(foundCueId)!;
                break;
              }
            }
          }
        }
      }

      const cardId = resolvedImportedId
        ? resolvedImportedId
        : this.formatCardId(project.idTemplate, {
            name: rawMediaName,
            seq: seqStr,
            time: idTimeStr,
            start: this.msToFileNameTime(refStartMs),
            end: this.msToFileNameTime(refEndMs),
            mid: this.msToFileNameTime(refMidMs),
            track: seqTrackLabel
          });
      const safeCardId = this.sanitizeBase(cardId) || `Card_${seqStr}`;

      const trackData: Record<string, { soundTag: string; imageTag: string; videoTag: string; text: string; start: string; end: string }> = {};
      const currentTasks: RowMediaTask[] = [];

      for (const track of tracks) {
        const cell = cellsObj[track.id];
        if (!cell) {
          trackData[track.id] = { soundTag: '', imageTag: '', videoTag: '', text: '', start: '', end: '' };
          continue;
        }

        const mediaFilePath = mediaSourceMap.get(track.mediaSourceId);
        const hasMediaFile = Boolean(mediaFilePath && fs.existsSync(mediaFilePath));
        const sourceObj = mediaSources.find(s => s.id === track.mediaSourceId);
        const streamIdx = track.audioStreamIndex !== undefined ? track.audioStreamIndex : (sourceObj ? sourceObj.audioStreamIndex : 0);
        const hasRealVideo = (hasMediaFile && sourceObj) ? (sourceObj.hasVideo !== false) : false;

        const effectiveStart = Math.max(0, cell.startMs + (track.offsetMs || 0) - (track.padStartMs || 0));
        const effectiveEnd = Math.max(effectiveStart + 100, cell.endMs + (track.offsetMs || 0) + (track.padEndMs || 0));

        const startFileTime = this.msToFileNameTime(effectiveStart);
        const endFileTime = this.msToFileNameTime(effectiveEnd);
        const midTime = Math.round((effectiveStart + effectiveEnd) / 2);
        const midFileTime = this.msToFileNameTime(midTime);

        const safeTrackLabel = this.sanitizeBase(track.label || 'Faixa') || 'Faixa';
        const nameVars = {
          id: safeCardId,
          name: safeMediaName,
          track: safeTrackLabel,
          seq: seqStr,
          start: startFileTime,
          end: endFileTime,
          mid: midFileTime
        };

        // Sempre formatar o nome ao gerar o arquivo e no texto de saída
        const audioBaseName = this.formatMediaFileName(
          audioTemplate,
          '{id}_{track}_{seq}_{start}-{end}',
          nameVars,
          audioFormat
        );
        const imageBaseName = this.formatMediaFileName(
          imageTemplate,
          '{id}_{track}_{seq}_{mid}',
          nameVars,
          'jpg'
        );
        const videoBaseName = this.formatMediaFileName(
          videoTemplate,
          '{id}_{track}_{seq}_{start}-{end}',
          nameVars,
          'mp4'
        );

        const cleanText = (cell.text || '').replace(/\r?\n/g, '<br>').trim();
        const hasCustomImage = !!(cell.customImagePath && fs.existsSync(cell.customImagePath));
        const hasCustomAudio = !!(cell.customAudioPath && fs.existsSync(cell.customAudioPath));

        const wantAudioForTrack = generateAudio && activeSoundTracks.has(track.id);
        const wantImageForTrack = generateImages && activeImageTracks.has(track.id);
        const wantVideoForTrack = generateVideos && activeVideoTracks.has(track.id);

        let soundTag = '';
        if (wantAudioForTrack) {
          if (hasMediaFile || hasCustomAudio) {
            soundTag = `[sound:${audioBaseName}]`;
          } else if (cell.audioFileName) {
            soundTag = `[sound:${cell.audioFileName}]`;
          }
        }

        let imageTag = '';
        if (wantImageForTrack) {
          if (hasRealVideo || hasCustomImage) {
            imageTag = `<img src="${imageBaseName}">`;
          } else if (cell.imageFileName) {
            imageTag = `<img src="${cell.imageFileName}">`;
          }
        }

        const videoTag = (wantVideoForTrack && hasRealVideo && hasMediaFile) ? `[sound:${videoBaseName}]` : '';

        trackData[track.id] = {
          soundTag,
          imageTag,
          videoTag,
          text: cleanText,
          start: this.msToIdTime(cell.startMs),
          end: this.msToIdTime(cell.endMs)
        };

        if (hasMediaFile || hasCustomImage || hasCustomAudio) {
          const shouldCutAudio = wantAudioForTrack && (hasMediaFile || hasCustomAudio);
          const shouldExtractImage = wantImageForTrack && (hasRealVideo || hasCustomImage);
          const shouldCutVideo = wantVideoForTrack && hasRealVideo && hasMediaFile;

          if (shouldCutAudio || shouldExtractImage || shouldCutVideo) {
            currentTasks.push({
              mediaFilePath: mediaFilePath || '',
              streamIdx,
              effectiveStart,
              effectiveEnd,
              midTime,
              audioBaseName,
              imageBaseName,
              videoBaseName,
              customImagePath: cell.customImagePath,
              customAudioPath: cell.customAudioPath,
              hasRealVideo: hasRealVideo || hasCustomImage,
              shouldCutAudio,
              shouldExtractImage,
              shouldCutVideo
            });
          }
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
        } else if (colKey.startsWith('video_')) {
          const tId = resolveTrackId(colKey.replace('video_', ''));
          rowValues.push(trackData[tId]?.videoTag || '');
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

      // Formatação por tipo de saída (CSV, SQL ou Delimitador)
      if (isCsv) {
        // RFC 4180
        const csvCols = rowValues.map(v => {
          if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
            return `"${v.replace(/"/g, '""')}"`;
          }
          return v;
        });
        lines.push(csvCols.join(','));
      } else if (isSql) {
        const rawTable = outputConfig.sqlTableName || 'anki_cards';
        const tableName = rawTable.replace(/[^a-zA-Z0-9_]/g, '') || 'anki_cards';
        const colNames = (outputConfig.columns || []).map(c => c.replace(/[^a-zA-Z0-9_]/g, '_'));
        const sqlValues = rowValues.map(v => `'${v.replace(/'/g, "''")}'`);
        lines.push(`INSERT INTO ${tableName} (${colNames.join(', ')}) VALUES (${sqlValues.join(', ')});`);
      } else {
        const formattedCols = rowValues.map(v => {
          if (outputConfig.quoteMode === 'always') {
            return `"${v.replace(/"/g, '""')}"`;
          }
          if (outputConfig.quoteMode === 'when-needed' && (v.includes(separator) || v.includes('"') || v.includes('\n') || v.includes('\r'))) {
            return `"${v.replace(/"/g, '""')}"`;
          }
          return v;
        });
        const lineContent = formattedCols.join(separator);
        const fullLine = `${outputConfig.linePrefix || ''}${lineContent}${outputConfig.lineSuffix || ''}`;
        lines.push(fullLine);
      }
    }

    // Grava o arquivo de saída ANTES de qualquer processamento pesado de mídia
    fs.writeFileSync(outTxtFile, lines.join('\n'), 'utf-8');

    const anyMediaNeeded = rowsMediaTasks.some(t => t.length > 0);
    let processedCount = validRows.length;

    if (onProgress) {
      onProgress({
        current: 0,
        total,
        percentage: 0,
        status: anyMediaNeeded
          ? `Arquivo (${isCsv ? 'CSV' : isSql ? 'SQL' : 'TXT'}) gravado com sucesso! Iniciando extração de mídia...`
          : `Exportação concluída com sucesso! (Arquivo gerado)`
      });
    }

    // =========================================================================
    // ETAPA 2: EXTRAÇÃO DE ÁUDIOS, IMAGENS E VÍDEOS COM O FFMPEG
    // =========================================================================
    const copyToMediaDirs = (sourceFilePath: string, fileName: string, mediaLabel: string) => {
      for (const dir of mediaDirs) {
        if (fs.existsSync(dir)) {
          try {
            fs.copyFileSync(sourceFilePath, path.join(dir, fileName));
          } catch (err: any) {
            errors.push(`${mediaLabel} ${fileName}: ${err.message}`);
          }
        }
      }
    };

    if (anyMediaNeeded) {
      processedCount = 0;
      for (let i = 0; i < rowsMediaTasks.length; i++) {
        if (this.isCancelled) break;
        const tasks = rowsMediaTasks[i];

        for (const task of tasks) {
          if (this.isCancelled) break;

          // 1. Gerar áudio se habilitado
          if (task.shouldCutAudio) {
            if (task.customAudioPath && fs.existsSync(task.customAudioPath)) {
              copyToMediaDirs(task.customAudioPath, task.audioBaseName, 'Áudio');
            } else if (task.mediaFilePath && fs.existsSync(task.mediaFilePath)) {
              const tempAudioPath = path.join(ffmpeg.getCacheDir(), task.audioBaseName);
              try {
                await ffmpeg.cutAudio({
                  sourcePath: task.mediaFilePath,
                  audioStreamIndex: task.streamIdx,
                  startMs: task.effectiveStart,
                  endMs: task.effectiveEnd,
                  outputPath: tempAudioPath,
                  bitrate: audioBitrate,
                  format: audioFormat,
                  trimSilence,
                  normalizeAudio
                });

                if (!this.isCancelled) {
                  copyToMediaDirs(tempAudioPath, task.audioBaseName, 'Áudio');
                }
              } catch (err: any) {
                if (!this.isCancelled) {
                  errors.push(`Áudio ${task.audioBaseName}: ${err.message}`);
                }
              }
            }
          }

          if (this.isCancelled) break;

          // 2. Gerar snapshot apenas se a fonte tiver vídeo real e geração de imagem estiver habilitada
          if (task.shouldExtractImage) {
            if (task.customImagePath && fs.existsSync(task.customImagePath)) {
              copyToMediaDirs(task.customImagePath, task.imageBaseName, 'Imagem');
            } else if (task.hasRealVideo && task.mediaFilePath && fs.existsSync(task.mediaFilePath)) {
              const tempImagePath = path.join(ffmpeg.getCacheDir(), task.imageBaseName);
              try {
                await ffmpeg.extractSnapshot({
                  sourcePath: task.mediaFilePath,
                  atMs: task.midTime,
                  outputPath: tempImagePath,
                  width: imageWidth,
                  height: imageHeight
                });

                if (!this.isCancelled) {
                  copyToMediaDirs(tempImagePath, task.imageBaseName, 'Imagem');
                }
              } catch (err: any) {
                if (!this.isCancelled) {
                  errors.push(`Imagem ${task.imageBaseName}: ${err.message}`);
                }
              }
            }
          }

          if (this.isCancelled) break;

          // 3. Gerar vídeo clip apenas se a fonte tiver vídeo real e geração de vídeo estiver habilitada
          if (task.shouldCutVideo && task.hasRealVideo) {
            const tempVideoPath = path.join(ffmpeg.getCacheDir(), task.videoBaseName);
            try {
              await ffmpeg.cutVideo({
                sourcePath: task.mediaFilePath,
                audioStreamIndex: task.streamIdx,
                startMs: task.effectiveStart,
                endMs: task.effectiveEnd,
                outputPath: tempVideoPath,
                width: videoWidth,
                height: videoHeight,
                bitrate: videoBitrate
              });

              if (!this.isCancelled) {
                copyToMediaDirs(tempVideoPath, task.videoBaseName, 'Vídeo');
              }
            } catch (err: any) {
              if (!this.isCancelled) {
                errors.push(`Vídeo ${task.videoBaseName}: ${err.message}`);
              }
            }
          }
        }

        if (this.isCancelled) break;

        processedCount = i + 1;
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
      exportedCount: processedCount,
      cancelled: this.isCancelled,
      errors
    };
  }
}

