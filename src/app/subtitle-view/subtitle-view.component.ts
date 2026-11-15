import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { ElectronService } from '../core/services/electron.service';
import {
  SubtitleParserService,
  AnkiParseResult,
  AnkiColumnMapping,
  AnkiColumnType,
  AnkiColumnAction
} from '../core/services/subtitle-parser.service';
import { SubtitleAlignerService } from '../core/services/subtitle-aligner.service';
import { SubtitleHistoryService } from '../core/services/subtitle-history.service';
import {
  SubtitleProject,
  SubtitleTrack,
  type MediaSource,
  AlignedRow,
  AlignedCell,
  OutputConfig
} from '../core/types/subtitle-project';

@Component({
  selector: 'app-subtitle-view',
  standalone: true,
  imports: [CommonModule, FormsModule, ScrollingModule],
  templateUrl: './subtitle-view.component.html'
})
export class SubtitleViewComponent implements OnInit, OnDestroy {

  @ViewChild(CdkVirtualScrollViewport) private viewport?: CdkVirtualScrollViewport;

  public project: SubtitleProject = {
    id: 'proj_' + Date.now(),
    mediaName: 'ReZero_Episodio_01',
    mediaSources: [],
    tracks: [],
    timingTrackId: '',
    sequenceTrackId: '',
    rows: [],
    alignmentToleranceMs: 500,
    groupByCounterpart: true,
    removeStyledLines: true,
    excludeNoCounterpart: false,
    idTemplate: 'ReZero_Episodio_01 - {time}',
    hasImportedId: false,
    output: {
      separator: '\t',
      quoteMode: 'when-needed',
      linePrefix: '',
      lineSuffix: '',
      writeAnkiHeaders: true,
      columns: ['id', 'seq', 'sound_1', 'image_1', 'text_1', 'sound_2', 'image_2', 'text_2'],
      tags: ['ReZero', 'Japanese'],
      audioNameTemplate: '{id}_{track}_{seq}_{start}-{end}',
      imageNameTemplate: '{id}_{track}_{seq}_{mid}',
      videoNameTemplate: '{id}_{track}_{seq}_{start}-{end}'
    }
  };

  // Preview & Playback
  public playingAudioTrackId: string | null = null;
  public playingRowId: string | null = null;
  public activeAudioUrl: string | null = null;
  private audioElement: HTMLAudioElement | null = null;

  // Modals & UI States
  public isOutputModalOpen = false;
  public isConfigTrackModalOpen = false;
  public isExportModalOpen = false;
  public isExporting = false;
  public currentProjectFilePath: string | null = null;

  // Modal de Importação Tabular / Anki (CSV / TXT)
  public isAnkiImportModalOpen = false;
  public ankiImportResult: AnkiParseResult | null = null;
  public ankiImportMappings: AnkiColumnMapping[] = [];
  public currentRawImportContent: string | null = null;

  // Estado visual do Arraste na tela (Drag & Drop)
  public isDraggingOver = false;
  private dragCounter = 0;

  // Estado de arraste de cards individuais na grid (coluna 2 em diante)
  public draggingCardState: { trackId: string; trackIndex: number; rowIndex: number } | null = null;
  public dragOverTarget: { trackId: string; rowIndex: number } | null = null;

  public exportOptions: {
    outputTxtPath: string;
    mediaOutputDir: string;
    generateAudio: boolean;
    generateImages: boolean;
    generateVideos: boolean;
    copyToAnkiCollectionMedia: boolean;
    trimSilence: boolean;
    normalizeAudio: boolean;
    audioFormat?: string;
    audioBitrate?: string;
    imageWidth?: number;
    imageHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    videoBitrate?: string;
  } = {
    outputTxtPath: '',
    mediaOutputDir: '',
    generateAudio: true,
    generateImages: true,
    generateVideos: false,
    copyToAnkiCollectionMedia: false,
    trimSilence: true,
    normalizeAudio: true
  };

  // Seleção de colunas para exportação no arquivo .txt
  public availableExportColumns: { key: string; label: string; selected: boolean }[] = [];

  // Modal de Shift Temporal
  public isShiftModalOpen = false;
  public shiftModalTrackId = '';
  public shiftModalRowIndex = 0;
  public shiftModalScope: 'from_row' | 'all' = 'from_row';
  public shiftModalDeltaMs = 0;

  public exportProgress = { current: 0, total: 0, percentage: 0, status: '' };
  public isCancellingExport = false;
  public lastExportResult: { txtPath: string; exportedCount: number } | null = null;
  private progressUnsub: (() => void) | null = null;
  private menuUnsub: (() => void) | null = null;
  private recentProjectUnsub: (() => void) | null = null;

  // Snapshot visualizer modal state
  public previewSnapshotState: {
    row: AlignedRow;
    track: SubtitleTrack;
    cell: AlignedCell;
    imageUrl: string | null;
    hasError: boolean;
    errorMessage?: string;
  } | null = null;

  // Mensagens
  public notification: { message: string; type: 'success' | 'error' | 'info' } | null = null;
  private notificationTimer: any = null;

  constructor(
    public electron: ElectronService,
    public parser: SubtitleParserService,
    public aligner: SubtitleAlignerService,
    public history: SubtitleHistoryService,
    private cdr: ChangeDetectorRef
  ) {}

  @HostListener('window:keydown', ['$event'])
  public handleKeyboardEvents(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      if (event.shiftKey) {
        // Ctrl + Shift + Z -> Refazer
        event.preventDefault();
        this.redo();
      } else {
        // Ctrl + Z -> Desfazer
        event.preventDefault();
        this.undo();
      }
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      // Ctrl + Y -> Refazer
      event.preventDefault();
      this.redo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (event.shiftKey) {
        // Ctrl + Shift + S -> Salvar Como...
        this.saveProjectAs();
      } else {
        // Ctrl + S -> Salvar
        this.saveProject();
      }
    }
  }

  public undo(): void {
    const res = this.history.undo(this.project.rows);
    if (res) {
      this.project.rows = res.rows;
      this.reprocessIds();
      this.showToast(`Desfeito: ${res.description}`, 'info');
      this.cdr.detectChanges();
    } else {
      this.showToast('Nada para desfazer.', 'info');
    }
  }

  public redo(): void {
    const res = this.history.redo(this.project.rows);
    if (res) {
      this.project.rows = res.rows;
      this.reprocessIds();
      this.showToast(`Refeito: ${res.description}`, 'info');
      this.cdr.detectChanges();
    } else {
      this.showToast('Nada para refazer.', 'info');
    }
  }

  public ngOnInit(): void {
    void this.electron.getSettings().then(s => {
      if (s) {
        this.exportOptions.trimSilence = s.trimSilence !== false;
        this.exportOptions.normalizeAudio = s.normalizeAudio !== false;
        this.exportOptions.audioFormat = s.audioFormat;
        this.exportOptions.audioBitrate = s.audioBitrate;
        this.exportOptions.imageWidth = s.imageWidth;
        this.exportOptions.imageHeight = s.imageHeight;
        this.exportOptions.videoWidth = s.videoWidth;
        this.exportOptions.videoHeight = s.videoHeight;
        this.exportOptions.videoBitrate = s.videoBitrate;
      }
    });

    this.progressUnsub = this.electron.onExportProgress((p: any) => {
      this.exportProgress = p;
      this.cdr.detectChanges();
    });

    // Ouvinte para ações do menu da aplicação
    this.menuUnsub = this.electron.onMenuTriggerAction((action: string) => {
      if (action === 'new-project') {
        this.resetProject();
      } else if (action === 'save-project') {
        this.saveProject();
      } else if (action === 'save-project-as') {
        this.saveProjectAs();
      } else if (action === 'open-project') {
        this.loadProject();
      } else if (action === 'export-anki') {
        this.openExportModal();
      }
    });

    // Ouvinte para abrir projeto recente via menu Histórico de Projetos
    this.recentProjectUnsub = this.electron.onMenuOpenRecentProject((filePath: string) => {
      void this.openRecentProject(filePath);
    });

    if (this.electron.pendingRecentProjectPath) {
      const pendingPath = this.electron.pendingRecentProjectPath;
      this.electron.pendingRecentProjectPath = null;
      void this.openRecentProject(pendingPath);
    }

    // Recupera último caminho conhecido se projeto não tem caminho
    if (!this.currentProjectFilePath) {
      const lastPath = localStorage.getItem('last_subtitle_project_path');
      if (lastPath) {
        this.currentProjectFilePath = lastPath;
      }
    }
  }

  public ngOnDestroy(): void {
    if (this.progressUnsub) this.progressUnsub();
    if (this.menuUnsub) this.menuUnsub();
    if (this.recentProjectUnsub) this.recentProjectUnsub();
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement = null;
    }
  }

  // ================= GERENCIAMENTO DE MÍDIA =================
  public async addMediaSource(): Promise<void> {
    const res = await this.electron.selectVideoFile();
    if (!res) return;

    this.processLoadedMedia(res.filePath, res.filename, res.probeData);
  }

  public processLoadedMedia(filePath: string, filename: string, probeData: any): void {
    const sourceId = 'src_' + Date.now();
    const newSource: MediaSource = {
      id: sourceId,
      label: filename,
      filePath,
      audioStreamIndex: 0,
      durationMs: probeData?.durationMs,
      hasVideo: probeData?.hasVideo !== false,
      audioStreams: probeData?.audioStreams || [],
      subtitleStreams: probeData?.subtitleStreams || []
    };

    this.project.mediaSources.push(newSource);

    // Se o nome do projeto ainda for genérico, sugerir com base no nome do arquivo (sem extensão)
    const baseClean = filename.replace(/\.[^/.]+$/, '');
    if (baseClean) {
      this.applyDefaultNameToProject(baseClean);
      this.reprocessIds();
    }

    // Se houver faixas sem mediaSource, atribuir esta
    this.project.tracks.forEach((t: SubtitleTrack) => {
      if (!t.mediaSourceId) {
        t.mediaSourceId = sourceId;
        t.audioStreamIndex = 0;
      }
    });

    this.showToast(`Mídia vinculada: ${filename} (${newSource.hasVideo ? 'Vídeo + Áudio' : 'Somente Áudio'})`, 'success');
  }

  // Extrair legenda embutida no arquivo de vídeo MKV/MP4
  public async extractEmbeddedSub(source: MediaSource, subStreamIndex: number): Promise<void> {
    const stream = source.subtitleStreams?.find(s => s.index === subStreamIndex);
    const subTitle = stream?.title || stream?.language || `Legenda Embutida ${subStreamIndex + 1}`;

    try {
      this.showToast(`Extraindo ${subTitle} do arquivo...`, 'info');
      const rawContent = await this.electron.extractEmbeddedSubtitle(source.filePath, subStreamIndex);
      const cues = this.parser.parseSubtitle(rawContent, `${subTitle}.srt`, {
        removeStyledLines: this.project.removeStyledLines !== false
      });

      const trackId = `track_emb_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
      const newTrack: SubtitleTrack = {
        id: trackId,
        label: subTitle.slice(0, 10),
        filePath: `embedded://${source.label}#${subStreamIndex}`,
        mediaSourceId: source.id,
        audioStreamIndex: source.audioStreamIndex || 0,
        offsetMs: 0,
        padStartMs: 250,
        padEndMs: 300,
        cues
      };

      this.project.tracks.push(newTrack);
      if (!this.project.timingTrackId) this.project.timingTrackId = trackId;
      if (!this.project.sequenceTrackId) this.project.sequenceTrackId = trackId;

      this.rebuildColumns();
      this.autoAlign();
      this.showToast(`Legenda embutida '${subTitle}' extraída com ${cues.length} falas!`, 'success');
    } catch (err: any) {
      this.showToast(`Erro ao extrair legenda: ${err.message || err}`, 'error');
    }
  }

  // ================= LIMPEZA / NOVO PROJETO =================
  private closeAllModalsAndTransientStates(): void {
    this.isOutputModalOpen = false;
    this.isConfigTrackModalOpen = false;
    this.isExportModalOpen = false;
    this.isShiftModalOpen = false;
    this.isAnkiImportModalOpen = false;
    this.isExporting = false;
    this.isCancellingExport = false;
    this.previewSnapshotState = null;
    this.draggingCardState = null;
    this.dragOverTarget = null;
    this.isDraggingOver = false;
    this.dragCounter = 0;
  }

  public resetProject(): void {
    this.stopAudio();
    this.closeAllModalsAndTransientStates();
    this.history.clear();
    this.currentProjectFilePath = null;
    localStorage.removeItem('last_subtitle_project_path');

    this.project = {
      id: 'proj_' + Date.now(),
      mediaName: 'Novo_Projeto',
      mediaSources: [],
      tracks: [],
      timingTrackId: '',
      sequenceTrackId: '',
      rows: [],
      alignmentToleranceMs: 500,
      groupByCounterpart: true,
      removeStyledLines: true,
      excludeNoCounterpart: false,
      idTemplate: 'Novo_Projeto - {time}',
      hasImportedId: false,
      output: {
        separator: '\t',
        quoteMode: 'when-needed',
        linePrefix: '',
        lineSuffix: '',
        writeAnkiHeaders: true,
        columns: ['id', 'seq', 'sound_1', 'image_1', 'text_1'],
        tags: [],
        audioNameTemplate: '{id}_{track}_{seq}_{start}-{end}',
        imageNameTemplate: '{id}_{track}_{seq}_{mid}',
        videoNameTemplate: '{id}_{track}_{seq}_{start}-{end}'
      }
    };

    this.availableExportColumns = [];
    this.lastExportResult = null;
    this.exportProgress = { current: 0, total: 0, percentage: 0, status: '' };
    this.ankiImportResult = null;
    this.ankiImportMappings = [];
    this.currentRawImportContent = null;
    this.exportOptions.outputTxtPath = '';
    this.exportOptions.mediaOutputDir = '';

    this.rebuildColumns();
    this.cdr.detectChanges();
    this.showToast('Projeto limpo com sucesso! Pronto para nova importação.', 'info');
  }

  // ================= ARRASTE DE CARDS DE LEGENDA NA GRID =================
  public onCellDragStart(event: DragEvent, trackId: string, trackIndex: number, rowIndex: number): void {
    if (trackIndex < 1) {
      event.preventDefault();
      return;
    }
    this.draggingCardState = { trackId, trackIndex, rowIndex };
    this.dragOverTarget = null;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', JSON.stringify({ type: 'cell-block', trackId, trackIndex, rowIndex }));
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  public onCellDragOver(event: DragEvent, trackId: string, trackIndex: number, rowIndex: number): void {
    if (this.draggingCardState && this.draggingCardState.trackId === trackId && trackIndex >= 1) {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      this.dragOverTarget = { trackId, rowIndex };
    }
  }

  public onCellDrop(event: DragEvent, trackId: string, trackIndex: number, rowIndex: number): void {
    if (this.draggingCardState && this.draggingCardState.trackId === trackId && trackIndex >= 1) {
      event.preventDefault();
      event.stopPropagation();

      const fromIndex = this.draggingCardState.rowIndex;
      const toIndex = rowIndex;

      if (fromIndex !== toIndex) {
        this.history.pushState(this.project.rows, `Mover bloco da linha ${fromIndex + 1} para ${toIndex + 1}`);
        this.project.rows = this.aligner.moveBlockToRow(this.project.rows, trackId, fromIndex, toIndex);
        this.reprocessIds();
        this.showToast(`Bloco de falas movido para a linha ${toIndex + 1}!`, 'success');
      }

      this.draggingCardState = null;
      this.dragOverTarget = null;
    }
  }

  public onCellDragEnd(): void {
    this.draggingCardState = null;
    this.dragOverTarget = null;
  }

  // ================= DRAG & DROP UNIVERSAL NA TELA =================
  @HostListener('window:dragover', ['$event'])
  public onWindowDragOver(event: DragEvent): void {
    if (this.hasFilesPayload(event)) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    }
  }

  @HostListener('window:drop', ['$event'])
  public onWindowDrop(event: DragEvent): void {
    if (this.hasFilesPayload(event)) {
      event.preventDefault();
    }
  }

  private hasFilesPayload(event: DragEvent): boolean {
    if (!event.dataTransfer) return false;
    const types = event.dataTransfer.types;
    if (!types) return false;
    return Array.from(types).some(t => t.toLowerCase() === 'files');
  }

  public onDragEnter(event: DragEvent): void {
    if (this.draggingCardState !== null) return;
    if (!this.hasFilesPayload(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter++;
    this.isDraggingOver = true;
  }

  public onDragOver(event: DragEvent): void {
    if (this.draggingCardState !== null) return;
    if (!this.hasFilesPayload(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.isDraggingOver = true;
  }

  public onDragLeave(event: DragEvent): void {
    if (this.draggingCardState !== null) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter--;
    if (this.dragCounter <= 0) {
      this.dragCounter = 0;
      this.isDraggingOver = false;
    }
  }

  public async onFileDrop(event: DragEvent): Promise<void> {
    if (this.draggingCardState !== null) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter = 0;
    this.isDraggingOver = false;

    if (!event.dataTransfer || !event.dataTransfer.files || event.dataTransfer.files.length === 0) return;

    for (let i = 0; i < event.dataTransfer.files.length; i++) {
      const file = event.dataTransfer.files[i];
      const filePath = this.electron.getPathForFile(file) || (file as any).path || '';
      const ext = file.name.split('.').pop()?.toLowerCase() || '';

      // 1. Projeto salvo em formato JSON (.ankisubs.json ou .json)
      if (ext === 'json' || file.name.endsWith('.ankisubs.json')) {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (parsed && (parsed.tracks || parsed.rows || parsed.mediaName)) {
            this.applyLoadedProject(parsed, filePath || file.name);
            if (filePath) {
              void this.electron.registerRecentProject(filePath, parsed.mediaName);
            }
            continue;
          }
        } catch (err: any) {
          console.warn('Falha ao processar arquivo JSON:', err);
        }
      }

      // 2. Imagens soltas na tela
      if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) {
        this.handleDroppedImage(filePath, file.name);
        continue;
      }

      // 3. Legendas ou Exportações Anki / Planilhas (CSV, TXT, SRT, ASS, etc.)
      if (['srt', 'ass', 'ssa', 'vtt', 'sub', 'sbv', 'lrc', 'txt', 'csv'].includes(ext)) {
        try {
          const text = await file.text();
          if (this.parser.isAnkiOrTabularContent(text, file.name)) {
            this.openAnkiImportModal(text, file.name);
            return; // abre popup para o usuário configurar o mapeamento
          }

          // Legenda padrão
          this.addSubtitleTrackFromContent(text, file.name, filePath || file.name);
          continue;
        } catch (err: any) {
          this.showToast(`Erro ao ler arquivo de legenda ${file.name}: ${err.message}`, 'error');
          continue;
        }
      }

      // 4. Arquivos de Mídia (Vídeo ou Áudio)
      if (filePath) {
        try {
          const probeData = await this.electron.probeMedia(filePath);
          this.processLoadedMedia(filePath, file.name, probeData);
        } catch (err: any) {
          this.showToast(`Não foi possível carregar ${file.name}: ${err.message}`, 'error');
        }
      } else {
        this.showToast(`Não foi possível obter o caminho do arquivo de mídia ${file.name}.`, 'error');
      }
    }
  }

  // Soltar arquivo especificamente sobre uma linha da grid
  public async onRowFileDrop(event: DragEvent, row: AlignedRow): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter = 0;
    this.isDraggingOver = false;

    if (!event.dataTransfer || !event.dataTransfer.files || event.dataTransfer.files.length === 0) return;
    const file = event.dataTransfer.files[0];
    const filePath = this.electron.getPathForFile(file) || (file as any).path || '';
    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    // Imagem solta diretamente na linha
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) {
      this.history.pushState(this.project.rows, 'Adicionar imagem personalizada na linha');
      const primaryTrackId = this.project.timingTrackId || this.project.tracks[0]?.id;
      if (primaryTrackId && row.cells[primaryTrackId]) {
        row.cells[primaryTrackId]!.customImagePath = filePath;
        row.cells[primaryTrackId]!.imageFileName = file.name;
        this.showToast(`Imagem vinculada à linha ${row.index}: ${file.name}`, 'success');
      }
      return;
    }

    // Áudio solto diretamente na linha
    if (['mp3', 'wav', 'ogg', 'opus', 'aac', 'flac', 'm4a'].includes(ext)) {
      this.history.pushState(this.project.rows, 'Adicionar áudio personalizado na linha');
      const primaryTrackId = this.project.timingTrackId || this.project.tracks[0]?.id;
      if (primaryTrackId && row.cells[primaryTrackId]) {
        row.cells[primaryTrackId]!.customAudioPath = filePath;
        row.cells[primaryTrackId]!.audioFileName = file.name;
        this.showToast(`Áudio vinculado à linha ${row.index}: ${file.name}`, 'success');
      }
      return;
    }

    // Outros formatos repassam para o importador global
    await this.onFileDrop(event);
  }

  public handleDroppedImage(filePath: string, filename: string): void {
    if (this.project.rows.length === 0) {
      this.showToast('Nenhuma linha na grid para associar a imagem.', 'info');
      return;
    }

    // Se o modal de snapshot estiver aberto, associa a ele
    if (this.previewSnapshotState?.cell) {
      this.previewSnapshotState.cell.customImagePath = filePath;
      this.previewSnapshotState.cell.imageFileName = filename;
      this.previewSnapshotState.imageUrl = `media://file?path=${encodeURIComponent(filePath)}`;
      this.previewSnapshotState.hasError = false;
      this.showToast(`Imagem associada à fala atual: ${filename}`, 'success');
      return;
    }

    // Caso contrário, procura a primeira linha sem imagem personalizada
    const primaryTrackId = this.project.timingTrackId || this.project.tracks[0]?.id;
    if (!primaryTrackId) return;

    const firstWithoutImage = this.project.rows.find(r => r.cells[primaryTrackId] && !r.cells[primaryTrackId]?.customImagePath && !r.cells[primaryTrackId]?.imageFileName);
    const targetRow = firstWithoutImage || this.project.rows[0];

    if (targetRow.cells[primaryTrackId]) {
      this.history.pushState(this.project.rows, 'Associar imagem na linha');
      targetRow.cells[primaryTrackId]!.customImagePath = filePath;
      targetRow.cells[primaryTrackId]!.imageFileName = filename;
      this.showToast(`Imagem associada à linha ${targetRow.index}: ${filename}`, 'success');
    }
  }

  // ================= MODAL DE IMPORTAÇÃO TABULAR / ANKI =================
  public openAnkiImportModal(content: string, fileName: string): void {
    this.currentRawImportContent = content;
    const result = this.parser.parseAnkiDelimitedContent(content, fileName);
    this.ankiImportResult = result;
    this.ankiImportMappings = result.suggestedMappings;
    this.isAnkiImportModalOpen = true;
  }

  public changeAnkiSeparator(sep: string): void {
    if (!this.ankiImportResult || !this.currentRawImportContent) return;
    this.ankiImportResult.separator = sep;
    const rawRows = this.parser.parseDelimitedRows(this.currentRawImportContent, sep);
    this.ankiImportResult.rawRows = rawRows;
    this.ankiImportResult.totalRows = rawRows.length;

    let columnsCount = 0;
    for (const r of rawRows) {
      if (r.length > columnsCount) columnsCount = r.length;
    }
    this.ankiImportResult.columnsCount = columnsCount;

    for (const r of rawRows) {
      while (r.length < columnsCount) r.push('');
    }

    const recomputed = this.parser.parseAnkiDelimitedContent(this.currentRawImportContent, this.ankiImportResult.fileName);
    this.ankiImportMappings = recomputed.suggestedMappings;
    this.ankiImportResult.suggestedMappings = recomputed.suggestedMappings;
  }

  public confirmAnkiImport(): void {
    if (!this.ankiImportResult) return;
    const { episodeName, hasImportedId, tracks } = this.parser.buildCuesFromAnkiImport(
      this.ankiImportResult,
      this.ankiImportMappings
    );

    if (tracks.length === 0) {
      this.showToast('Nenhuma faixa selecionada para importação.', 'error');
      return;
    }

    const hadTracks = this.project.tracks.length > 0;
    if (!hadTracks) {
      this.project.hasImportedId = hasImportedId;
    } else if (hasImportedId) {
      this.project.hasImportedId = true;
    }

    if (episodeName) {
      this.applyDefaultNameToProject(episodeName);
    } else {
      const baseFromFile = this.ankiImportResult.fileName.replace(/\.[^/.]+$/, '') || 'Deck';
      this.applyDefaultNameToProject(baseFromFile);
    }

    const defaultSourceId = this.project.mediaSources[0]?.id || '';

    for (const t of tracks) {
      const trackId = `track_anki_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
      this.project.tracks.push({
        id: trackId,
        label: t.label,
        filePath: this.ankiImportResult.fileName,
        mediaSourceId: defaultSourceId,
        audioStreamIndex: 0,
        offsetMs: 0,
        padStartMs: 250,
        padEndMs: 300,
        cues: t.cues
      });

      if (!this.project.timingTrackId) this.project.timingTrackId = trackId;
      if (!this.project.sequenceTrackId) this.project.sequenceTrackId = trackId;
    }

    this.rebuildColumns();
    this.autoAlign();
    this.isAnkiImportModalOpen = false;
    this.showToast(`Importação concluída: ${tracks.length} faixa(s) e ${tracks[0]?.cues.length || 0} falas adicionadas!`, 'success');
  }

  public getAvailableCombineTargets(currentIdx: number): { index: number; label: string }[] {
    return this.ankiImportMappings
      .filter(m => m.index !== currentIdx && m.type !== 'ignore' && m.type !== 'id' && m.action === 'new_track')
      .map(m => ({ index: m.index, label: m.targetTrackLabel || `Faixa ${m.index + 1}` }));
  }

  public removeMediaSource(index: number): void {
    const src = this.project.mediaSources[index];
    this.project.mediaSources.splice(index, 1);
    this.project.tracks.forEach((t: SubtitleTrack) => {
      if (t.mediaSourceId === src.id) {
        t.mediaSourceId = this.project.mediaSources[0]?.id || '';
      }
    });
  }

  // ================= GERENCIAMENTO DE LEGENDAS =================
  public async addSubtitles(): Promise<void> {
    const files = await this.electron.selectSubFiles();
    if (!files || files.length === 0) return;

    for (const f of files) {
      if (this.parser.isAnkiOrTabularContent(f.content, f.filename)) {
        this.openAnkiImportModal(f.content, f.filename);
        continue;
      }
      this.addSubtitleTrackFromContent(f.content, f.filename, f.filePath);
    }
  }

  public addSubtitleTrackFromContent(content: string, filename: string, filePath: string): void {
    const cues = this.parser.parseSubtitle(content, filename, {
      removeStyledLines: this.project.removeStyledLines !== false
    });
    const isFirst = this.project.tracks.length === 0;
    if (isFirst) {
      this.project.hasImportedId = false;
      const baseClean = filename.replace(/\.[^/.]+$/, '');
      if (baseClean) {
        this.applyDefaultNameToProject(baseClean);
      }
    }

    let label = isFirst ? 'JP' : 'PT';
    if (/pt|por|bra/i.test(filename)) label = 'PT';
    else if (/jp|jap/i.test(filename)) label = 'JP';
    else if (/en|eng/i.test(filename)) label = 'EN';
    else label = `Sub ${this.project.tracks.length + 1}`;

    const trackId = `track_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
    const newTrack: SubtitleTrack = {
      id: trackId,
      label,
      filePath,
      mediaSourceId: this.project.mediaSources[0]?.id || '',
      audioStreamIndex: 0,
      offsetMs: 0,
      padStartMs: 250,
      padEndMs: 300,
      cues
    };

    this.project.tracks.push(newTrack);

    if (!this.project.timingTrackId) this.project.timingTrackId = trackId;
    if (!this.project.sequenceTrackId) this.project.sequenceTrackId = trackId;

    this.rebuildColumns();
    this.autoAlign();
    this.showToast(`Legenda '${filename}' carregada com ${cues.length} falas!`, 'success');
  }

  public removeTrack(trackIndex: number): void {
    const t = this.project.tracks[trackIndex];
    if (!t) return;
    this.project.tracks.splice(trackIndex, 1);

    for (const r of this.project.rows) {
      if (r.cells && r.cells[t.id]) {
        delete r.cells[t.id];
      }
    }

    if (this.project.timingTrackId === t.id) {
      this.project.timingTrackId = this.project.tracks[0]?.id || '';
    }
    if (this.project.sequenceTrackId === t.id) {
      this.project.sequenceTrackId = this.project.tracks[0]?.id || '';
    }

    this.rebuildColumns();
    if (this.project.tracks.length === 0) {
      this.project.rows = [];
      this.availableExportColumns = [];
      this.project.hasImportedId = false;
      this.cdr.detectChanges();
      this.showToast(`Coluna '${t.label}' removida.`, 'info');
      return;
    }

    this.project.hasImportedId = this.project.tracks.some(tr => tr.cues?.some(c => !!c.importedId?.trim()));
    this.autoAlign();
    this.cdr.detectChanges();
  }

  public rebuildColumns(): void {
    const cols = ['id', 'seq'];
    this.project.tracks.forEach((_: SubtitleTrack, idx: number) => {
      cols.push(`sound_${idx + 1}`);
      cols.push(`image_${idx + 1}`);
      cols.push(`text_${idx + 1}`);
    });
    this.project.output.columns = cols;
  }

  // ================= ALINHAMENTO E SHIFT =================
  public autoAlign(): void {
    if (this.project.tracks.length === 0) {
      this.project.rows = [];
      return;
    }
    if (this.project.rows.length > 0) {
      this.history.pushState(this.project.rows, 'Auto-Alinhar');
    }
    const tolerance = this.project.alignmentToleranceMs || 500;
    this.project.rows = this.aligner.autoAlignTracks(this.project.tracks, {
      toleranceMs: tolerance,
      groupByCounterpart: this.project.groupByCounterpart !== false,
      joinSentences: true,
      excludeNoCounterpart: this.project.excludeNoCounterpart === true
    });
    this.reprocessIds();
    this.showToast(`Grid alinhada com tolerância de ${tolerance}ms: ${this.project.rows.length} falas encontradas.`, 'info');
  }

  public shiftTrack(trackId: string, fromRowIndex: number, direction: 'down' | 'up'): void {
    this.history.pushState(this.project.rows, `Deslocar linhas ${direction === 'down' ? '↓' : '↑'} (linha ${fromRowIndex + 1})`);
    this.project.rows = this.aligner.shiftColumn(this.project.rows, trackId, fromRowIndex, direction);
    this.reprocessIds();
    this.showToast(`Faixa deslocada para ${direction === 'down' ? 'baixo' : 'cima'} a partir da linha ${fromRowIndex + 1}.`, 'info');
  }

  public moveCell(trackId: string, rowIndex: number, direction: 'up' | 'down'): void {
    this.history.pushState(this.project.rows, `Mover célula ${direction === 'up' ? '▲' : '▼'} (linha ${rowIndex + 1})`);
    this.project.rows = this.aligner.moveCell(this.project.rows, trackId, rowIndex, direction);
    this.reprocessIds();
  }

  public mergeWithNext(trackId: string, rowIndex: number): void {
    this.history.pushState(this.project.rows, `Mesclar com próxima (linha ${rowIndex + 1})`);
    this.project.rows = this.aligner.mergeCellWithNext(this.project.rows, trackId, rowIndex);
    this.reprocessIds();
  }

  public mergeWithPrevious(trackId: string, rowIndex: number): void {
    this.history.pushState(this.project.rows, `Mesclar com anterior (linha ${rowIndex + 1})`);
    this.project.rows = this.aligner.mergeCellWithPrevious(this.project.rows, trackId, rowIndex);
    this.reprocessIds();
  }

  public unlinkCell(trackId: string, rowIndex: number): void {
    this.history.pushState(this.project.rows, `Desvincular fala (linha ${rowIndex + 1})`);
    this.project.rows = this.aligner.unlinkCell(this.project.rows, trackId, rowIndex);
    this.reprocessIds();
    this.showToast(`Fala desvinculada para nova linha autônoma.`, 'info');
  }

  public clearCell(trackId: string, rowIndex: number): void {
    this.history.pushState(this.project.rows, `Limpar célula (linha ${rowIndex + 1})`);
    this.project.rows = this.aligner.clearCell(this.project.rows, trackId, rowIndex);
    this.reprocessIds();
    this.showToast(`Célula da linha ${rowIndex + 1} limpa.`, 'info');
  }

  // ================= MODAL DE SHIFT TEMPORAL =================
  public openShiftModal(trackId: string, rowIndex: number = 0): void {
    this.shiftModalTrackId = trackId;
    this.shiftModalRowIndex = rowIndex;
    this.shiftModalScope = rowIndex > 0 ? 'from_row' : 'all';
    this.shiftModalDeltaMs = 0;
    this.isShiftModalOpen = true;
  }

  public closeShiftModal(): void {
    this.isShiftModalOpen = false;
  }

  public addShiftDelta(delta: number): void {
    this.shiftModalDeltaMs += delta;
  }

  public setShiftDelta(delta: number): void {
    this.shiftModalDeltaMs = delta;
  }

  public applyTimeShiftModal(): void {
    if (this.shiftModalDeltaMs === 0) {
      this.closeShiftModal();
      return;
    }
    const track = this.project.tracks.find(t => t.id === this.shiftModalTrackId);
    const label = track?.label || 'Faixa';
    const scopeDesc = this.shiftModalScope === 'all' ? 'em toda a faixa' : `a partir da linha ${this.shiftModalRowIndex + 1}`;

    this.history.pushState(this.project.rows, `Deslocamento Temporal ${this.shiftModalDeltaMs > 0 ? '+' : ''}${this.shiftModalDeltaMs}ms (${label})`);
    this.project.rows = this.aligner.applyTimeShift(
      this.project.rows,
      this.shiftModalTrackId,
      this.shiftModalRowIndex,
      this.shiftModalDeltaMs,
      this.shiftModalScope
    );
    this.reprocessIds();
    this.showToast(`Deslocamento de ${this.shiftModalDeltaMs > 0 ? '+' : ''}${this.shiftModalDeltaMs}ms aplicado ${scopeDesc}.`, 'success');
    this.closeShiftModal();
    this.cdr.detectChanges();
  }

  public isAllRowsIncluded(): boolean {
    return this.project.rows.length > 0 && this.project.rows.every(r => !r.excluded);
  }

  public isSomeRowsIncluded(): boolean {
    if (this.project.rows.length === 0) return false;
    const hasIncluded = this.project.rows.some(r => !r.excluded);
    const hasExcluded = this.project.rows.some(r => !!r.excluded);
    return hasIncluded && hasExcluded;
  }

  public toggleAllRowsExcluded(checkboxEl?: HTMLInputElement): void {
    if (this.project.rows.length === 0) return;

    // Se todas estiverem marcadas -> desmarca todas; se vazio ou indeterminado (-) -> marca todas.
    const shouldIncludeAll = !this.isAllRowsIncluded();
    this.history.pushState(
      this.project.rows,
      shouldIncludeAll ? 'Marcar todos os cards para exportação' : 'Desmarcar todos os cards da exportação'
    );

    for (const row of this.project.rows) {
      row.excluded = !shouldIncludeAll;
    }

    if (checkboxEl) {
      checkboxEl.checked = shouldIncludeAll;
      checkboxEl.indeterminate = false;
    }

    this.reprocessIds();
    this.cdr.detectChanges();
  }

  public toggleRowExcluded(row: AlignedRow): void {
    this.history.pushState(this.project.rows, row.excluded ? 'Incluir fala' : 'Excluir fala');
    row.excluded = !row.excluded;
    this.reprocessIds();
    this.cdr.detectChanges();
  }

  public nudgeTime(cell: AlignedCell, type: 'start' | 'end', deltaMs: number): void {
    this.history.pushState(this.project.rows, `Ajuste ${deltaMs > 0 ? '+' : ''}${deltaMs}ms`);
    if (type === 'start') {
      cell.startMs = Math.max(0, cell.startMs + deltaMs);
    } else {
      cell.endMs = Math.max(cell.startMs + 100, cell.endMs + deltaMs);
    }
    this.reprocessIds();
  }

  // ================= PRÉVIA DE ÁUDIO E SNAPSHOT =================
  public async playCellAudio(row: AlignedRow, track: SubtitleTrack): Promise<void> {
    const cell = row.cells[track.id];
    if (!cell) return;

    if (this.playingRowId === row.id && this.playingAudioTrackId === track.id) {
      this.stopAudio();
      return;
    }

    // 1. Áudio personalizado importado diretamente
    if (cell.customAudioPath) {
      try {
        this.stopAudio();
        this.playingRowId = row.id;
        this.playingAudioTrackId = track.id;
        this.activeAudioUrl = `media://file?path=${encodeURIComponent(cell.customAudioPath)}`;
        this.audioElement = new Audio(this.activeAudioUrl);
        this.audioElement.onended = () => this.stopAudio();
        this.audioElement.onerror = () => {
          this.showToast('Erro ao reproduzir áudio personalizado da fala.', 'error');
          this.stopAudio();
        };
        await this.audioElement.play();
      } catch (err: any) {
        this.showToast('Erro ao reproduzir áudio: ' + err.message, 'error');
        this.stopAudio();
      }
      return;
    }

    const source = this.project.mediaSources.find((s: MediaSource) => s.id === track.mediaSourceId);
    if (!source || !source.filePath) {
      this.showToast(`Nenhuma mídia vinculada para a legenda ${track.label}.`, 'error');
      return;
    }

    try {
      this.stopAudio();
      this.playingRowId = row.id;
      this.playingAudioTrackId = track.id;

      const effectiveStart = Math.max(0, cell.startMs + (track.offsetMs || 0) - (track.padStartMs || 0));
      const effectiveEnd = Math.max(effectiveStart + 100, cell.endMs + (track.offsetMs || 0) + (track.padEndMs || 0));
      const streamIdx = track.audioStreamIndex !== undefined ? track.audioStreamIndex : (source.audioStreamIndex || 0);

      const settings = await this.electron.getSettings();
      const ext = settings?.audioFormat || 'mp3';
      const tempName = `preview_${track.id}_${cell.startMs}_${Date.now()}.${ext}`;
      const outPath = await this.electron.cutAudio({
        sourcePath: source.filePath,
        audioStreamIndex: streamIdx,
        startMs: effectiveStart,
        endMs: effectiveEnd,
        outputPath: tempName,
        format: settings?.audioFormat,
        bitrate: settings?.audioBitrate,
        trimSilence: settings?.trimSilence !== false,
        normalizeAudio: settings?.normalizeAudio !== false
      });

      // Formato de URL seguro com query param
      this.activeAudioUrl = `media://preview/${tempName}`;
      this.audioElement = new Audio(this.activeAudioUrl);
      this.audioElement.onended = () => this.stopAudio();
      this.audioElement.onerror = (e) => {
        console.error('Erro ao reproduzir elemento de áudio:', e, 'URL:', this.activeAudioUrl);
        this.showToast('Erro ao reproduzir áudio cortado. Verifique os logs no console.', 'error');
        this.stopAudio();
      };
      await this.audioElement.play();
    } catch (err: any) {
      console.error('Erro ao recortar áudio:', err);
      this.showToast('Erro ao recortar áudio: ' + (err.message || err), 'error');
      this.stopAudio();
    }
  }

  public stopAudio(): void {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement = null;
    }
    this.playingRowId = null;
    this.playingAudioTrackId = null;
    this.activeAudioUrl = null;
  }

  public async previewSnapshot(row: AlignedRow, track: SubtitleTrack): Promise<void> {
    const cell = row.cells[track.id];
    if (!cell) return;

    // Imagem personalizada já vinculada na célula
    if (cell.customImagePath) {
      this.previewSnapshotState = {
        row,
        track,
        cell,
        imageUrl: `media://file?path=${encodeURIComponent(cell.customImagePath)}`,
        hasError: false
      };
      return;
    }

    const source = this.project.mediaSources.find((s: MediaSource) => s.id === track.mediaSourceId);
    if (!source || !source.filePath) {
      this.previewSnapshotState = {
        row,
        track,
        cell,
        imageUrl: null,
        hasError: true,
        errorMessage: `Nenhuma mídia vinculada para a legenda ${track.label}.`
      };
      return;
    }

    if (source.hasVideo === false) {
      this.previewSnapshotState = {
        row,
        track,
        cell,
        imageUrl: null,
        hasError: true,
        errorMessage: 'A mídia vinculada é um arquivo somente de áudio (não possui vídeo para capturar imagem).'
      };
      return;
    }

    try {
      const settings = await this.electron.getSettings();
      const midTime = Math.round((cell.startMs + cell.endMs) / 2) + (track.offsetMs || 0);
      const tempName = `snapshot_${track.id}_${midTime}_${Date.now()}.jpg`;

      const outPath = await this.electron.extractSnapshot({
        sourcePath: source.filePath,
        atMs: midTime,
        outputPath: tempName,
        width: settings?.imageWidth || 480,
        height: settings?.imageHeight || 270
      });

      const imageUrl = `media://preview/${tempName}`;

      this.previewSnapshotState = {
        row,
        track,
        cell,
        imageUrl,
        hasError: false
      };
    } catch (err: any) {
      console.error('Erro ao gerar snapshot:', err);
      this.previewSnapshotState = {
        row,
        track,
        cell,
        imageUrl: null,
        hasError: true,
        errorMessage: err.message || 'Falha ao processar snapshot com o FFmpeg.'
      };
    }
  }

  // Deleta o snapshot da linha atual
  public deleteSnapshot(): void {
    if (!this.previewSnapshotState) return;
    const { cell } = this.previewSnapshotState;
    cell.imageFileName = undefined;
    cell.customImagePath = undefined;
    this.previewSnapshotState = null;
    this.showToast('Snapshot removido da linha.', 'info');
  }

  public closeSnapshotModal(): void {
    this.previewSnapshotState = null;
  }

  // ================= SALVAR E CARREGAR PROJETO =================
  public async saveProject(): Promise<void> {
    if (this.currentProjectFilePath) {
      try {
        this.syncProjectExportPaths();
        this.project.projectFilePath = this.currentProjectFilePath;
        await this.electron.saveProjectToPath(this.currentProjectFilePath, this.project);
        localStorage.setItem('last_subtitle_project_path', this.currentProjectFilePath);
        this.showToast(`Projeto salvo em: ${this.currentProjectFilePath}`, 'success');
      } catch (err: any) {
        this.showToast('Erro ao salvar projeto: ' + (err.message || err), 'error');
      }
    } else {
      await this.saveProjectAs();
    }
  }

  public async saveProjectAs(): Promise<void> {
    this.syncProjectExportPaths();
    const savedPath = await this.electron.saveProjectDialog(this.project, this.currentProjectFilePath || undefined);
    if (savedPath) {
      this.currentProjectFilePath = savedPath;
      this.project.projectFilePath = savedPath;
      localStorage.setItem('last_subtitle_project_path', savedPath);
      this.showToast(`Projeto salvo como: ${savedPath}`, 'success');
    }
  }

  private syncProjectExportPaths(): void {
    if (!this.project.output) {
      this.project.output = {
        separator: '\t',
        quoteMode: 'when-needed',
        linePrefix: '',
        lineSuffix: '',
        writeAnkiHeaders: true,
        columns: ['id', 'seq', 'sound_1', 'image_1', 'text_1'],
        tags: []
      };
    }
    this.project.output.outputTxtPath = this.exportOptions.outputTxtPath;
    this.project.output.mediaOutputDir = this.exportOptions.mediaOutputDir;
    this.project.output.trimSilence = this.exportOptions.trimSilence;
    this.project.output.normalizeAudio = this.exportOptions.normalizeAudio;
  }

  public async loadProject(): Promise<void> {
    const res = await this.electron.loadProjectDialog();
    if (res && res.project) {
      this.applyLoadedProject(res.project, res.filePath);
    }
  }

  public async openRecentProject(filePath: string): Promise<void> {
    try {
      const res = await this.electron.loadProjectFromPath(filePath);
      if (res && res.project) {
        this.applyLoadedProject(res.project, res.filePath);
      } else {
        this.showToast('Arquivo de projeto não encontrado ou inválido. Removido do histórico.', 'error');
      }
    } catch (err: any) {
      console.error('Erro ao abrir projeto recente:', err);
      this.showToast('Falha ao abrir projeto recente.', 'error');
    }
  }

  public applyLoadedProject(loadedProject: SubtitleProject, filePath?: string): void {
    this.stopAudio();
    this.closeAllModalsAndTransientStates();

    this.project = {
      id: loadedProject.id || ('proj_' + Date.now()),
      mediaName: loadedProject.mediaName || 'Projeto',
      mediaSources: Array.isArray(loadedProject.mediaSources) ? loadedProject.mediaSources : [],
      tracks: Array.isArray(loadedProject.tracks) ? loadedProject.tracks : [],
      timingTrackId: loadedProject.timingTrackId || '',
      sequenceTrackId: loadedProject.sequenceTrackId || '',
      rows: Array.isArray(loadedProject.rows) ? loadedProject.rows : [],
      alignmentToleranceMs: loadedProject.alignmentToleranceMs || 500,
      groupByCounterpart: loadedProject.groupByCounterpart !== undefined ? loadedProject.groupByCounterpart : true,
      removeStyledLines: loadedProject.removeStyledLines !== undefined ? loadedProject.removeStyledLines : true,
      excludeNoCounterpart: loadedProject.excludeNoCounterpart !== undefined ? loadedProject.excludeNoCounterpart : false,
      idTemplate: (loadedProject.idTemplate || '{name} - {time}').replace(/\{name\}/gi, loadedProject.mediaName || 'Projeto'),
      hasImportedId: Boolean(
        loadedProject.hasImportedId ||
        loadedProject.rows?.some(r => !!r.customId?.trim()) ||
        loadedProject.tracks?.some(t => t.cues?.some(c => !!c.importedId?.trim()))
      ),
      output: loadedProject.output || {
        separator: '\t',
        quoteMode: 'when-needed',
        linePrefix: '',
        lineSuffix: '',
        writeAnkiHeaders: true,
        columns: ['id', 'seq', 'sound_1', 'image_1', 'text_1'],
        tags: []
      },
      projectFilePath: filePath || loadedProject.projectFilePath
    };
    this.currentProjectFilePath = filePath || loadedProject.projectFilePath || null;
    if (this.currentProjectFilePath) {
      localStorage.setItem('last_subtitle_project_path', this.currentProjectFilePath);
    }

    // Restaurar caminhos e preferências de exportação salvos no projeto
    if (this.project.output?.outputTxtPath) {
      this.exportOptions.outputTxtPath = this.project.output.outputTxtPath;
    }
    if (this.project.output?.mediaOutputDir) {
      this.exportOptions.mediaOutputDir = this.project.output.mediaOutputDir;
    } else if (this.exportOptions.outputTxtPath) {
      const selected = this.exportOptions.outputTxtPath;
      const normalized = selected.replace(/\\/g, '/');
      const lastSlash = normalized.lastIndexOf('/');
      if (lastSlash !== -1) {
        const parentDir = selected.substring(0, lastSlash);
        const fileName = selected.substring(lastSlash + 1);
        const baseName = fileName.replace(/\.[^/.]+$/, '');
        const separator = selected.includes('\\') ? '\\' : '/';
        this.exportOptions.mediaOutputDir = `${parentDir}${separator}${baseName}_midia`;
      }
    }

    if (this.project.output?.trimSilence !== undefined) {
      this.exportOptions.trimSilence = this.project.output.trimSilence;
    }
    if (this.project.output?.normalizeAudio !== undefined) {
      this.exportOptions.normalizeAudio = this.project.output.normalizeAudio;
    }

    if (!this.project.output.audioNameTemplate) {
      this.project.output.audioNameTemplate = '{id}_{track}_{seq}_{start}-{end}';
    }
    if (!this.project.output.imageNameTemplate) {
      this.project.output.imageNameTemplate = '{id}_{track}_{seq}_{mid}';
    }
    if (!this.project.output.videoNameTemplate) {
      this.project.output.videoNameTemplate = '{id}_{track}_{seq}_{start}-{end}';
    }

    this.rebuildColumns();
    this.reprocessIds();
    this.history.clear();
    this.showToast(`Projeto carregado: ${this.project.mediaName}`, 'success');
    this.cdr.detectChanges();
    setTimeout(() => {
      this.viewport?.checkViewportSize();
      this.viewport?.scrollToIndex(0);
      this.cdr.detectChanges();
    }, 0);
  }

  // ================= EXPORTAR PARA ANKI =================
  public initExportColumns(): void {
    const existingMap = new Map<string, boolean>();
    for (const c of this.availableExportColumns) {
      existingMap.set(c.key, c.selected);
    }

    const cols: { key: string; label: string; selected: boolean }[] = [
      { key: 'id', label: 'ID do Card (id)', selected: existingMap.has('id') ? existingMap.get('id')! : true },
      { key: 'seq', label: 'Sequência Numérica (seq)', selected: existingMap.has('seq') ? existingMap.get('seq')! : true },
      { key: 'time', label: 'Tempo Inicial (time)', selected: existingMap.has('time') ? existingMap.get('time')! : true }
    ];

    for (const track of this.project.tracks) {
      const label = track.label || 'Faixa';
      const soundKey = `sound_${track.id}`;
      const imageKey = `image_${track.id}`;
      const videoKey = `video_${track.id}`;
      const textKey = `text_${track.id}`;

      cols.push({
        key: soundKey,
        label: `Áudio (${label})`,
        selected: existingMap.has(soundKey) ? existingMap.get(soundKey)! : true
      });
      cols.push({
        key: imageKey,
        label: `Imagem (${label})`,
        selected: existingMap.has(imageKey) ? existingMap.get(imageKey)! : true
      });
      cols.push({
        key: videoKey,
        label: `Vídeo (${label})`,
        selected: existingMap.has(videoKey) ? existingMap.get(videoKey)! : false
      });
      cols.push({
        key: textKey,
        label: `Texto (${label})`,
        selected: existingMap.has(textKey) ? existingMap.get(textKey)! : true
      });
    }

    if (this.project.output?.tags && this.project.output.tags.length > 0) {
      cols.push({
        key: 'tags',
        label: 'Tags',
        selected: existingMap.has('tags') ? existingMap.get('tags')! : true
      });
    }

    this.availableExportColumns = cols;
  }

  public selectAllExportColumns(enable: boolean): void {
    for (const c of this.availableExportColumns) {
      c.selected = enable;
    }
  }

  public openExportModal(): void {
    if (!this.project.rows || this.project.rows.length === 0) {
      this.showToast('Não há linhas na grid para exportar.', 'error');
      return;
    }
    this.initExportColumns();
    this.lastExportResult = null;
    this.isExportModalOpen = true;
  }

  public onOutputTxtPathChange(value: string): void {
    if (!value || !value.trim()) {
      this.exportOptions.mediaOutputDir = '';
    }
  }

  public async browseExportTxtPath(): Promise<void> {
    const isCsv = this.project.output?.separator === 'csv';
    const isSql = this.project.output?.separator === 'sql';
    const ext = isCsv ? '.csv' : (isSql ? '.sql' : '.txt');
    const defaultName = `${this.project.mediaName || 'Deck'}_anki${ext}`;
    const selected = await this.electron.selectFile(`Salvar Arquivo de Importação (${defaultName})`);
    if (selected) {
      this.exportOptions.outputTxtPath = selected;

      // Define automaticamente a pasta de mídia como {nome_do_arquivo_txt}_midia no mesmo diretório
      const normalized = selected.replace(/\\/g, '/');
      const lastSlash = normalized.lastIndexOf('/');
      if (lastSlash !== -1) {
        const parentDir = selected.substring(0, lastSlash);
        const fileName = selected.substring(lastSlash + 1);
        const baseName = fileName.replace(/\.[^/.]+$/, '');
        const separator = selected.includes('\\') ? '\\' : '/';
        this.exportOptions.mediaOutputDir = `${parentDir}${separator}${baseName}_midia`;
      }
    }
  }

  public async browseMediaOutputDir(): Promise<void> {
    const selected = await this.electron.selectDirectory('Selecionar Pasta para Salvar Mídias (.mp3 / .jpg)');
    if (selected) {
      this.exportOptions.mediaOutputDir = selected;
    }
  }

  public async startExport(): Promise<void> {
    if (this.project.rows.length === 0) {
      this.showToast('Não há linhas para exportar.', 'error');
      return;
    }

    const selectedColumns = this.availableExportColumns
      .filter(c => c.selected)
      .map(c => c.key);

    if (selectedColumns.length === 0) {
      this.showToast('Selecione pelo menos uma coluna para gerar o arquivo.', 'error');
      return;
    }

    this.isExporting = true;
    this.isCancellingExport = false;
    this.exportProgress = {
      current: 0,
      total: this.project.rows.length,
      percentage: 0,
      status: 'Iniciando processamento em lote...'
    };

    try {
      const settings = await this.electron.getSettings();

      const projectToExport: SubtitleProject = {
        ...this.project,
        output: {
          ...this.project.output,
          columns: selectedColumns
        }
      };

      const result = await this.electron.exportSubtitleProject(projectToExport, {
        outputTxtPath: this.exportOptions.outputTxtPath,
        mediaOutputDir: this.exportOptions.mediaOutputDir,
        generateAudio: this.exportOptions.generateAudio,
        generateImages: this.exportOptions.generateImages,
        generateVideos: this.exportOptions.generateVideos,
        copyToAnkiCollectionMedia: this.exportOptions.copyToAnkiCollectionMedia,
        audioFormat: settings?.audioFormat,
        audioBitrate: settings?.audioBitrate,
        trimSilence: settings?.trimSilence !== false,
        normalizeAudio: settings?.normalizeAudio !== false,
        imageWidth: settings?.imageWidth,
        imageHeight: settings?.imageHeight,
        videoWidth: settings?.videoWidth,
        videoHeight: settings?.videoHeight,
        videoBitrate: settings?.videoBitrate,
        audioNameTemplate: this.project.output?.audioNameTemplate,
        imageNameTemplate: this.project.output?.imageNameTemplate,
        videoNameTemplate: this.project.output?.videoNameTemplate
      });

      if (result.cancelled) {
        this.lastExportResult = null;
        this.showToast('Exportação cancelada pelo usuário.', 'info');
      } else {
        this.lastExportResult = {
          txtPath: result.txtPath,
          exportedCount: result.exportedCount
        };

        if (result.errors && result.errors.length > 0) {
          this.showToast(`Concluído com avisos: ${result.exportedCount} cards gerados. (${result.errors.length} avisos)`, 'info');
        } else {
          this.showToast(`Exportação concluída com sucesso! ${result.exportedCount} cards gerados.`, 'success');
        }
      }
    } catch (err: any) {
      this.showToast('Erro ao exportar: ' + (err.message || err), 'error');
    } finally {
      this.isExporting = false;
      this.isCancellingExport = false;
    }
  }

  public async cancelExport(): Promise<void> {
    if (!this.isExporting || this.isCancellingExport) return;
    this.isCancellingExport = true;
    this.exportProgress = {
      ...this.exportProgress,
      status: 'Cancelando exportação...'
    };
    try {
      await this.electron.cancelSubtitleExport();
    } catch (err: any) {
      this.showToast('Erro ao cancelar exportação: ' + (err.message || err), 'error');
    }
  }

  public async openExportFolder(): Promise<void> {
    if (this.lastExportResult?.txtPath) {
      await this.electron.openPath(this.lastExportResult.txtPath);
    }
  }

  public getMediaSource(mediaSourceId: string): MediaSource | undefined {
    return this.project.mediaSources.find((s: MediaSource) => s.id === mediaSourceId);
  }

  // ================= FORMATAÇÃO DE ID E NOMES DE SAÍDA =================
  public readonly idFormatTags = [
    { token: '{seq}', label: 'Sequência' },
    { token: '{time}', label: 'Tempo ID' },
    { token: '{start}', label: 'Tempo Inicial' },
    { token: '{end}', label: 'Tempo Final' },
    { token: '{mid}', label: 'Tempo Médio' },
    { token: '{track}', label: 'Faixa' }
  ];
  private lastIdTemplateInput: HTMLInputElement | null = null;

  public readonly mediaNameTags = [
    { token: '{id}', label: 'ID' },
    { token: '{seq}', label: 'Sequência' },
    { token: '{start}', label: 'Tempo Inicial' },
    { token: '{end}', label: 'Tempo Final' },
    { token: '{mid}', label: 'Tempo Médio' },
    { token: '{track}', label: 'Faixa' }
  ];
  public activeTemplateTarget: 'audio' | 'image' | 'video' = 'audio';
  private lastFocusedTemplateInput: HTMLInputElement | null = null;

  private applyDefaultNameToProject(baseName: string): void {
    const clean = (baseName || '').trim();
    if (!clean) return;
    if (!this.project.mediaName || this.project.mediaName === 'ReZero_Episodio_01' || this.project.mediaName === 'Novo_Projeto' || this.project.mediaName === 'Deck') {
      this.project.mediaName = clean;
    }
    const curTpl = (this.project.idTemplate || '').trim();
    if (!curTpl || curTpl === 'ReZero_Episodio_01 - {time}' || curTpl === 'Novo_Projeto - {time}' || curTpl === '{name} - {time}') {
      this.project.idTemplate = `${clean} - {time}`;
    }
  }

  private formatIdTemplate(
    template: string | undefined,
    vars: { seq: string; time: string; start: string; end: string; mid: string; track: string }
  ): string {
    const fallbackName = (this.project.mediaName || 'Deck').trim() || 'Deck';
    const rawTemplate = (template && template.trim().length > 0) ? template : `${fallbackName} - {time}`;
    const formatted = rawTemplate
      .replace(/\{seq\}/gi, vars.seq)
      .replace(/\{time\}/gi, vars.time)
      .replace(/\{start\}/gi, vars.start)
      .replace(/\{end\}/gi, vars.end)
      .replace(/\{mid\}/gi, vars.mid)
      .replace(/\{track\}/gi, vars.track)
      .trim();

    return formatted || `${fallbackName} - ${vars.time}`;
  }

  public onIdTemplateFocus(event: FocusEvent): void {
    this.lastIdTemplateInput = event.target as HTMLInputElement;
  }

  public onIdTemplateDrop(event: DragEvent): void {
    if (this.project.hasImportedId) return;
    event.preventDefault();
    event.stopPropagation();
    const token = event.dataTransfer?.getData('text/plain') || '';
    if (!token) return;
    const input = event.target as HTMLInputElement;
    this.lastIdTemplateInput = input;
    this.project.idTemplate = this.insertTokenAtCursor(this.project.idTemplate || '', token, input);
    this.reprocessIds();
  }

  public insertTagInIdTemplate(token: string): void {
    if (this.project.hasImportedId) return;
    this.project.idTemplate = this.insertTokenAtCursor(this.project.idTemplate || '', token, this.lastIdTemplateInput);
    this.reprocessIds();
  }

  private buildCueImportedIdMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const track of (this.project.tracks || [])) {
      for (const cue of (track.cues || [])) {
        if (cue.importedId && cue.importedId.trim().length > 0) {
          map.set(cue.id, cue.importedId.trim());
        }
      }
    }
    return map;
  }

  private resolveRowImportedId(row: AlignedRow, cueIdMap?: Map<string, string>): string {
    if (row.customId && row.customId.trim().length > 0) {
      return row.customId.trim();
    }
    const cells = Object.values(row.cells || {});
    for (const cell of cells) {
      if (cell?.importedId && cell.importedId.trim().length > 0) {
        return cell.importedId.trim();
      }
    }
    if (cueIdMap && cueIdMap.size > 0) {
      for (const cell of cells) {
        if (!cell?.cueIds) continue;
        for (const cId of cell.cueIds) {
          const found = cueIdMap.get(cId);
          if (found) return found;
        }
      }
    }
    return '';
  }

  public reprocessIds(): void {
    const rows = this.project.rows || [];
    const activeRowsCount = rows.filter(r => !r?.excluded).length;
    const padLength = Math.max(4, String(activeRowsCount || rows.length).length);
    const tracks = this.project.tracks || [];
    const seqTrack = tracks.find(t => t.id === this.project.sequenceTrackId) || tracks[0];
    const seqTrackLabel = (seqTrack?.label || 'Faixa').trim();
    const cueIdMap = this.project.hasImportedId ? this.buildCueImportedIdMap() : undefined;

    let activeSeq = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.excluded) {
        activeSeq++;
      }
      const seqNum = row.excluded ? (i + 1) : activeSeq;
      const seqStr = String(seqNum).padStart(padLength, '0');

      const cellsObj = row.cells || {};
      const timingCell = cellsObj[this.project.timingTrackId] || Object.values(cellsObj).find(c => c !== null) || null;
      const startMs = timingCell ? timingCell.startMs : 0;
      const endMs = timingCell ? timingCell.endMs : 0;
      const midMs = Math.round((startMs + endMs) / 2);

      const importedId = this.project.hasImportedId ? this.resolveRowImportedId(row, cueIdMap) : '';
      if (importedId) {
        row.customId = importedId;
        row.cardId = importedId;
      } else {
        row.cardId = this.formatIdTemplate(this.project.idTemplate, {
          seq: seqStr,
          time: this.parser.msToIdTime(startMs),
          start: this.parser.msToFileNameTime(startMs),
          end: this.parser.msToFileNameTime(endMs),
          mid: this.parser.msToFileNameTime(midMs),
          track: seqTrackLabel
        });
      }
    }
    this.cdr.detectChanges();
  }

  public getIdFormatPreview(): string {
    const firstRow = (this.project.rows || []).find(r => !r.excluded) || this.project.rows?.[0];
    if (this.project.hasImportedId) {
      const imported = firstRow ? this.resolveRowImportedId(firstRow, this.buildCueImportedIdMap()) : '';
      return imported || 'ID selecionado na importação (.txt)';
    }

    const tracks = this.project.tracks || [];
    const seqTrack = tracks.find(t => t.id === this.project.sequenceTrackId) || tracks[0];
    const seqTrackLabel = (seqTrack?.label || 'JP').trim();
    const cellsObj = firstRow?.cells || {};
    const timingCell = cellsObj[this.project.timingTrackId] || Object.values(cellsObj).find(c => c !== null) || null;
    const startMs = timingCell ? timingCell.startMs : 83450;
    const endMs = timingCell ? timingCell.endMs : 86100;
    const midMs = Math.round((startMs + endMs) / 2);

    return this.formatIdTemplate(this.project.idTemplate, {
      seq: '0001',
      time: this.parser.msToIdTime(startMs),
      start: this.parser.msToFileNameTime(startMs),
      end: this.parser.msToFileNameTime(endMs),
      mid: this.parser.msToFileNameTime(midMs),
      track: seqTrackLabel
    });
  }

  public openOutputModal(): void {
    if (!this.project.output.audioNameTemplate) {
      this.project.output.audioNameTemplate = '{id}_{track}_{seq}_{start}-{end}';
    }
    if (!this.project.output.imageNameTemplate) {
      this.project.output.imageNameTemplate = '{id}_{track}_{seq}_{mid}';
    }
    if (!this.project.output.videoNameTemplate) {
      this.project.output.videoNameTemplate = '{id}_{track}_{seq}_{start}-{end}';
    }
    this.isOutputModalOpen = true;
  }

  public onTemplateFocus(target: 'audio' | 'image' | 'video', event: FocusEvent): void {
    this.activeTemplateTarget = target;
    this.lastFocusedTemplateInput = event.target as HTMLInputElement;
  }

  public onTagDragStart(event: DragEvent, token: string): void {
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', token);
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  public onTemplateDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  public onTemplateDrop(event: DragEvent, target: 'audio' | 'image' | 'video'): void {
    event.preventDefault();
    event.stopPropagation();
    const token = event.dataTransfer?.getData('text/plain') || '';
    if (!token) return;
    const input = event.target as HTMLInputElement;
    this.activeTemplateTarget = target;
    this.lastFocusedTemplateInput = input;
    this.applyTokenToTemplate(target, token, input);
  }

  public insertTagInTemplate(token: string): void {
    this.applyTokenToTemplate(this.activeTemplateTarget, token, this.lastFocusedTemplateInput);
  }

  private insertTokenAtCursor(current: string, token: string, input: HTMLInputElement | null): string {
    if (input && typeof input.selectionStart === 'number' && typeof input.selectionEnd === 'number') {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const updated = current.slice(0, start) + token + current.slice(end);
      setTimeout(() => {
        input.focus();
        const newPos = start + token.length;
        input.setSelectionRange(newPos, newPos);
      }, 0);
      return updated;
    }
    return current + token;
  }

  private applyTokenToTemplate(target: 'audio' | 'image' | 'video', token: string, input: HTMLInputElement | null): void {
    const key = target === 'audio' ? 'audioNameTemplate' : target === 'image' ? 'imageNameTemplate' : 'videoNameTemplate';
    const current = this.project.output[key] || '';
    this.project.output[key] = this.insertTokenAtCursor(current, token, input);
    this.cdr.detectChanges();
  }

  public resetMediaNameTemplates(): void {
    this.project.output.audioNameTemplate = '{id}_{track}_{seq}_{start}-{end}';
    this.project.output.imageNameTemplate = '{id}_{track}_{seq}_{mid}';
    this.project.output.videoNameTemplate = '{id}_{track}_{seq}_{start}-{end}';
  }

  public getMediaNamePreview(type: 'audio' | 'image' | 'video'): string {
    const template =
      type === 'audio'
        ? (this.project.output.audioNameTemplate || '{id}_{track}_{seq}_{start}-{end}')
        : type === 'image'
          ? (this.project.output.imageNameTemplate || '{id}_{track}_{seq}_{mid}')
          : (this.project.output.videoNameTemplate || '{id}_{track}_{seq}_{start}-{end}');

    const ext = type === 'audio' ? 'mp3' : type === 'image' ? 'jpg' : 'mp4';
    const safeTrack = (this.project.tracks[0]?.label || 'JP').trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_') || 'JP';
    const sampleIdRaw = this.getIdFormatPreview();
    const safeId = sampleIdRaw.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_') || 'Card_0001';

    let formatted = template
      .replace(/\{id\}/gi, safeId)
      .replace(/\{track\}/gi, safeTrack)
      .replace(/\{seq\}/gi, '0001')
      .replace(/\{start\}/gi, '0.01.23.450')
      .replace(/\{end\}/gi, '0.01.26.100')
      .replace(/\{mid\}/gi, '0.01.24.775')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();

    if (!formatted) formatted = `${safeId}_0001`;
    if (formatted.toLowerCase().endsWith(`.${ext}`)) return formatted;
    return `${formatted}.${ext}`;
  }

  public showToast(message: string, type: 'success' | 'error' | 'info'): void {
    if (this.notificationTimer) clearTimeout(this.notificationTimer);
    this.notification = { message, type };
    this.notificationTimer = setTimeout(() => {
      this.notification = null;
    }, 4500);
  }
}

