export const SUPPORTED_VIDEO_EXTENSIONS = [
  'mkv', 'mp4', 'm4v', 'avi', 'mov', 'webm', 'wmv', 'asf', 'flv', 'f4v',
  'mpg', 'mpeg', 'mpe', 'ts', 'm2ts', 'mts', 'vob', 'ogv', '3gp', '3g2',
  'divx', 'rm', 'rmvb'
];

export const SUPPORTED_AUDIO_EXTENSIONS = [
  'wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma', 'alac',
  'aiff', 'aif', 'ape', 'wv', 'ac3', 'eac3', 'dts', 'amr', 'mp2', 'au', 'mka'
];

export const SUPPORTED_SUBTITLE_EXTENSIONS = [
  'srt', 'ass', 'ssa', 'vtt', 'sub', 'sbv', 'lrc', 'txt', 'csv'
];

export const SUPPORTED_IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'
];

export interface MediaAudioStream {
  index: number;
  codec: string;
  language?: string;
  title?: string;
  channels?: number;
}

export interface MediaSubtitleStream {
  index: number;
  codec: string;
  language?: string;
  title?: string;
}

export interface MediaProbeResult {
  filePath: string;
  durationMs: number;
  audioStreams: MediaAudioStream[];
  subtitleStreams: MediaSubtitleStream[];
  hasVideo: boolean;
}

export interface MediaSource {
  id: string;
  label: string;
  filePath: string;
  audioStreamIndex: number;
  durationMs?: number;
  hasVideo?: boolean;
  audioStreams?: MediaAudioStream[];
  subtitleStreams?: MediaSubtitleStream[];
}

export interface SubtitleCue {
  id: string;
  originalIndex: number;
  startMs: number;
  endMs: number;
  origStartMs: number;
  origEndMs: number;
  text: string;
  audioFileName?: string;
  imageFileName?: string;
  customImagePath?: string;
  customAudioPath?: string;
}

export interface SubtitleTrack {
  id: string;
  label: string;                  // Ex: "JP", "PT", "EN"
  filePath: string;
  mediaSourceId: string;          // ID do MediaSource vinculado para corte de som/imagem
  audioStreamIndex?: number;      // Faixa de áudio específica para esta legenda
  offsetMs: number;               // Deslocamento de sincronização (ms)
  padStartMs: number;             // Margem inicial no corte de áudio (ms)
  padEndMs: number;               // Margem final no corte de áudio (ms)
  cues: SubtitleCue[];
}

export interface AlignedCell {
  trackId: string;
  cueIds: string[];               // Pode ter 1 ou mais cues mescladas nesta célula
  startMs: number;
  endMs: number;
  text: string;
  audioFileName?: string;
  imageFileName?: string;
  customImagePath?: string;
  customAudioPath?: string;
}

export interface AlignedRow {
  id: string;
  index: number;                  // Sequência visual
  cells: Record<string, AlignedCell | null>; // chave é trackId
  excluded?: boolean;
}

export interface OutputColumnConfig {
  key: string;                    // Ex: 'id', 'seq', 'sound_1', 'image_1', 'text_1', etc.
  label: string;
}

export interface OutputConfig {
  separator: string;              // "\t", ",", ";", "|", "csv", "sql"
  quoteMode: 'none' | 'always' | 'when-needed';
  linePrefix?: string;
  lineSuffix?: string;
  sqlTableName?: string;
  writeAnkiHeaders: boolean;      // #separator:tab, #html:true
  columns: string[];              // lista ordenada de identificadores de coluna
  tags: string[];
  outputTxtPath?: string;         // Caminho persistido para o arquivo .txt gerado
  mediaOutputDir?: string;        // Caminho persistido para a pasta de mídia gerada
  trimSilence?: boolean;          // Remover silêncios no início e fim do áudio
  normalizeAudio?: boolean;       // Normalizar volume do áudio (EBU R128 para MP3)
}

export interface SubtitleExportOptions {
  outputTxtPath: string;
  mediaOutputDir?: string;
  generateAudio: boolean;
  generateImages: boolean;
  generateVideos?: boolean;
  copyToAnkiCollectionMedia: boolean;
  trimSilence?: boolean;
  normalizeAudio?: boolean;
  audioBitrate?: string;
  audioFormat?: string;
  imageWidth?: number;
  imageHeight?: number;
  videoWidth?: number;
  videoHeight?: number;
  videoBitrate?: string;
}

export interface SubtitleExportProgress {
  current: number;
  total: number;
  percentage: number;
  status: string;
}

export interface SubtitleProject {
  id: string;
  mediaName: string;              // Ex: "Re:Zero Kara Hajimeru Isekai Seikatsu - Episódio 03"
  mediaSources: MediaSource[];
  tracks: SubtitleTrack[];        // tracks[0] é a Base
  timingTrackId: string;          // De qual legenda vem o tempo de ID
  sequenceTrackId: string;        // De qual legenda vem a numeração/sequência
  rows: AlignedRow[];
  output: OutputConfig;
  projectFilePath?: string;       // Caminho persistido onde o arquivo .ankisubs.json foi salvo
  alignmentToleranceMs?: number;  // Tolerância de sincronização entre faixas (padrão: 500ms)
  groupByCounterpart?: boolean;   // Agrupar falas consecutivas da base pela legenda secundária (padrão: true)
  removeStyledLines?: boolean;    // Filtrar créditos (STAFF), músicas (OP/ED) e placas em legendas .ass (padrão: true)
  excludeNoCounterpart?: boolean; // Marcar como excluídas linhas que não possuem tradução (padrão: false)
}

export interface CutAudioOptions {
  sourcePath: string;
  audioStreamIndex?: number;
  startMs: number;
  endMs: number;
  outputPath: string;
  trimSilence?: boolean;
  normalizeAudio?: boolean;
  bitrate?: string;
  format?: string;
}

export interface ExtractSnapshotOptions {
  sourcePath: string;
  atMs: number;
  outputPath: string;
  width?: number;
  height?: number;
}

export interface CutVideoOptions {
  sourcePath: string;
  audioStreamIndex?: number;
  startMs: number;
  endMs: number;
  outputPath: string;
  width?: number;
  height?: number;
  bitrate?: string;
}

