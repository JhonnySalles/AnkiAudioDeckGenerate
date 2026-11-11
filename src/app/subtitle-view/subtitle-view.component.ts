import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { ElectronService } from '../core/services/electron.service';
import { SubtitleParserService } from '../core/services/subtitle-parser.service';
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

  public project: SubtitleProject = {
    id: 'proj_' + Date.now(),
    mediaName: 'ReZero_Episodio_01',
    mediaSources: [],
    tracks: [],
    timingTrackId: '',
    sequenceTrackId: '',
    rows: [],
    output: {
      separator: '\t',
      quoteMode: 'when-needed',
      linePrefix: '',
      lineSuffix: '',
      writeAnkiHeaders: true,
      columns: ['id', 'seq', 'sound_1', 'image_1', 'text_1', 'sound_2', 'image_2', 'text_2'],
      tags: ['ReZero', 'Japanese']
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

  public exportOptions: {
    outputTxtPath: string;
    mediaOutputDir: string;
    generateAudio: boolean;
    generateImages: boolean;
    copyToAnkiCollectionMedia: boolean;
    trimSilence: boolean;
    normalizeAudio: boolean;
  } = {
    outputTxtPath: '',
    mediaOutputDir: '',
    generateAudio: true,
    generateImages: true,
    copyToAnkiCollectionMedia: true,
    trimSilence: true,
    normalizeAudio: true
  };

  // Modal de Shift Temporal
  public isShiftModalOpen = false;
  public shiftModalTrackId = '';
  public shiftModalRowIndex = 0;
  public shiftModalScope: 'from_row' | 'all' = 'from_row';
  public shiftModalDeltaMs = 0;

  public exportProgress = { current: 0, total: 0, percentage: 0, status: '' };
  public lastExportResult: { txtPath: string; exportedCount: number } | null = null;
  private progressUnsub: (() => void) | null = null;
  private menuUnsub: (() => void) | null = null;

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
      this.showToast(`Refeito: ${res.description}`, 'info');
      this.cdr.detectChanges();
    } else {
      this.showToast('Nada para refazer.', 'info');
    }
  }

  public ngOnInit(): void {
    this.progressUnsub = this.electron.onExportProgress((p: any) => {
      this.exportProgress = p;
      this.cdr.detectChanges();
    });

    // Ouvinte para ações do menu da aplicação
    this.menuUnsub = this.electron.onMenuTriggerAction((action: string) => {
      if (action === 'save-project') {
        this.saveProject();
      } else if (action === 'save-project-as') {
        this.saveProjectAs();
      } else if (action === 'open-project') {
        this.loadProject();
      } else if (action === 'export-anki') {
        this.openExportModal();
      }
    });

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
    if (this.project.mediaName === 'ReZero_Episodio_01') {
      const baseClean = filename.replace(/\.[^/.]+$/, '');
      this.project.mediaName = baseClean;
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
      const cues = this.parser.parseSubtitle(rawContent, `${subTitle}.srt`);

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

  // Drag & drop direto na tela de arquivos de vídeo, áudio e legendas
  public onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  public async onFileDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    if (!event.dataTransfer || !event.dataTransfer.files || event.dataTransfer.files.length === 0) return;

    for (let i = 0; i < event.dataTransfer.files.length; i++) {
      const file = event.dataTransfer.files[i];
      const filePath = (file as any).path;
      if (!filePath) continue;

      const ext = file.name.split('.').pop()?.toLowerCase() || '';

      // Verifica se é legenda
      if (['srt', 'ass', 'ssa', 'vtt', 'sub', 'sbv', 'lrc', 'txt'].includes(ext)) {
        const text = await file.text();
        const cues = this.parser.parseSubtitle(text, file.name);
        const trackId = `track_drop_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
        const isFirst = this.project.tracks.length === 0;

        let label = isFirst ? 'JP' : 'PT';
        if (/pt|por|bra/i.test(file.name)) label = 'PT';
        else if (/jp|jap/i.test(file.name)) label = 'JP';
        else if (/en|eng/i.test(file.name)) label = 'EN';
        else label = `Sub ${this.project.tracks.length + 1}`;

        this.project.tracks.push({
          id: trackId,
          label,
          filePath,
          mediaSourceId: this.project.mediaSources[0]?.id || '',
          audioStreamIndex: 0,
          offsetMs: 0,
          padStartMs: 250,
          padEndMs: 300,
          cues
        });

        if (!this.project.timingTrackId) this.project.timingTrackId = trackId;
        if (!this.project.sequenceTrackId) this.project.sequenceTrackId = trackId;

        this.rebuildColumns();
        this.autoAlign();
        this.showToast(`Legenda '${file.name}' carregada!`, 'success');
      } else {
        // Assume arquivo de mídia (vídeo ou áudio)
        try {
          const probeData = await this.electron.probeMedia(filePath);
          this.processLoadedMedia(filePath, file.name, probeData);
        } catch (err: any) {
          this.showToast(`Não foi possível carregar ${file.name}: ${err.message}`, 'error');
        }
      }
    }
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

    const defaultSourceId = this.project.mediaSources[0]?.id || '';

    for (const f of files) {
      const cues = this.parser.parseSubtitle(f.content, f.filename);
      const isFirst = this.project.tracks.length === 0;

      // Sugerir rótulo de idioma baseado no nome do arquivo
      let label = isFirst ? 'JP' : 'PT';
      if (/pt|por|bra/i.test(f.filename)) label = 'PT';
      else if (/jp|jap/i.test(f.filename)) label = 'JP';
      else if (/en|eng/i.test(f.filename)) label = 'EN';
      else label = `Sub ${this.project.tracks.length + 1}`;

      const trackId = `track_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
      const newTrack: SubtitleTrack = {
        id: trackId,
        label,
        filePath: f.filePath,
        mediaSourceId: defaultSourceId,
        audioStreamIndex: 0,
        offsetMs: 0,
        padStartMs: 250,
        padEndMs: 300,
        cues
      };

      this.project.tracks.push(newTrack);

      if (!this.project.timingTrackId) this.project.timingTrackId = trackId;
      if (!this.project.sequenceTrackId) this.project.sequenceTrackId = trackId;
    }

    this.rebuildColumns();
    this.autoAlign();
    this.showToast(`${files.length} arquivo(s) de legenda adicionado(s)!`, 'success');
  }

  public removeTrack(trackIndex: number): void {
    const t = this.project.tracks[trackIndex];
    this.project.tracks.splice(trackIndex, 1);

    if (this.project.timingTrackId === t.id) {
      this.project.timingTrackId = this.project.tracks[0]?.id || '';
    }
    if (this.project.sequenceTrackId === t.id) {
      this.project.sequenceTrackId = this.project.tracks[0]?.id || '';
    }

    this.rebuildColumns();
    this.autoAlign();
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
    this.project.rows = this.aligner.autoAlignTracks(this.project.tracks, tolerance);
    this.showToast(`Grid alinhada com tolerância de ${tolerance}ms: ${this.project.rows.length} falas encontradas.`, 'info');
  }

  public shiftTrack(trackId: string, fromRowIndex: number, direction: 'down' | 'up'): void {
    this.history.pushState(this.project.rows, `Deslocar linhas ${direction === 'down' ? '↓' : '↑'} (linha ${fromRowIndex + 1})`);
    this.project.rows = this.aligner.shiftColumn(this.project.rows, trackId, fromRowIndex, direction);
    this.showToast(`Faixa deslocada para ${direction === 'down' ? 'baixo' : 'cima'} a partir da linha ${fromRowIndex + 1}.`, 'info');
  }

  public moveCell(trackId: string, rowIndex: number, direction: 'up' | 'down'): void {
    this.history.pushState(this.project.rows, `Mover célula ${direction === 'up' ? '▲' : '▼'} (linha ${rowIndex + 1})`);
    this.project.rows = this.aligner.moveCell(this.project.rows, trackId, rowIndex, direction);
  }

  public mergeWithNext(trackId: string, rowIndex: number): void {
    this.history.pushState(this.project.rows, `Mesclar com próxima (linha ${rowIndex + 1})`);
    this.project.rows = this.aligner.mergeCellWithNext(this.project.rows, trackId, rowIndex);
  }

  public mergeWithPrevious(trackId: string, rowIndex: number): void {
    this.history.pushState(this.project.rows, `Mesclar com anterior (linha ${rowIndex + 1})`);
    this.project.rows = this.aligner.mergeCellWithPrevious(this.project.rows, trackId, rowIndex);
  }

  public unlinkCell(trackId: string, rowIndex: number): void {
    this.history.pushState(this.project.rows, `Desvincular fala (linha ${rowIndex + 1})`);
    this.project.rows = this.aligner.unlinkCell(this.project.rows, trackId, rowIndex);
    this.showToast(`Fala desvinculada para nova linha autônoma.`, 'info');
  }

  public clearCell(trackId: string, rowIndex: number): void {
    this.history.pushState(this.project.rows, `Limpar célula (linha ${rowIndex + 1})`);
    this.project.rows = this.aligner.clearCell(this.project.rows, trackId, rowIndex);
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
    this.showToast(`Deslocamento de ${this.shiftModalDeltaMs > 0 ? '+' : ''}${this.shiftModalDeltaMs}ms aplicado ${scopeDesc}.`, 'success');
    this.closeShiftModal();
    this.cdr.detectChanges();
  }

  public toggleRowExcluded(row: AlignedRow): void {
    this.history.pushState(this.project.rows, row.excluded ? 'Incluir fala' : 'Excluir fala');
    row.excluded = !row.excluded;
  }

  public nudgeTime(cell: AlignedCell, type: 'start' | 'end', deltaMs: number): void {
    this.history.pushState(this.project.rows, `Ajuste ${deltaMs > 0 ? '+' : ''}${deltaMs}ms`);
    if (type === 'start') {
      cell.startMs = Math.max(0, cell.startMs + deltaMs);
    } else {
      cell.endMs = Math.max(cell.startMs + 100, cell.endMs + deltaMs);
    }
  }

  // ================= PRÉVIA DE ÁUDIO E SNAPSHOT =================
  public async playCellAudio(row: AlignedRow, track: SubtitleTrack): Promise<void> {
    const cell = row.cells[track.id];
    if (!cell) return;

    if (this.playingRowId === row.id && this.playingAudioTrackId === track.id) {
      this.stopAudio();
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

      const tempName = `preview_${track.id}_${cell.startMs}_${Date.now()}.mp3`;
      const outPath = await this.electron.cutAudio({
        sourcePath: source.filePath,
        audioStreamIndex: streamIdx,
        startMs: effectiveStart,
        endMs: effectiveEnd,
        outputPath: tempName,
        trimSilence: this.exportOptions.trimSilence !== false,
        normalizeAudio: this.exportOptions.normalizeAudio !== false
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
      const midTime = Math.round((cell.startMs + cell.endMs) / 2) + (track.offsetMs || 0);
      const tempName = `snapshot_${track.id}_${midTime}_${Date.now()}.jpg`;

      const outPath = await this.electron.extractSnapshot({
        sourcePath: source.filePath,
        atMs: midTime,
        outputPath: tempName,
        width: 480
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
      this.project = {
        id: res.project.id || ('proj_' + Date.now()),
        mediaName: res.project.mediaName || 'Projeto',
        mediaSources: Array.isArray(res.project.mediaSources) ? res.project.mediaSources : [],
        tracks: Array.isArray(res.project.tracks) ? res.project.tracks : [],
        timingTrackId: res.project.timingTrackId || '',
        sequenceTrackId: res.project.sequenceTrackId || '',
        rows: Array.isArray(res.project.rows) ? res.project.rows : [],
        alignmentToleranceMs: res.project.alignmentToleranceMs || 500,
        output: res.project.output || {
          separator: '\t',
          quoteMode: 'when-needed',
          linePrefix: '',
          lineSuffix: '',
          writeAnkiHeaders: true,
          columns: ['id', 'seq', 'sound_1', 'image_1', 'text_1'],
          tags: []
        },
        projectFilePath: res.filePath || res.project.projectFilePath
      };
      this.currentProjectFilePath = res.filePath || res.project.projectFilePath || null;
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
        // Deduz {nome_txt}_midia se não estiver definido
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

      this.history.clear();
      this.showToast(`Projeto carregado: ${this.project.mediaName}`, 'success');
      this.cdr.detectChanges();
    }
  }

  // ================= EXPORTAR PARA ANKI =================
  public openExportModal(): void {
    if (!this.project.rows || this.project.rows.length === 0) {
      this.showToast('Não há linhas na grid para exportar.', 'error');
      return;
    }
    this.lastExportResult = null;
    this.isExportModalOpen = true;
  }

  public async browseExportTxtPath(): Promise<void> {
    const defaultName = `${this.project.mediaName || 'Deck'}_anki.txt`;
    const selected = await this.electron.selectFile(`Salvar Arquivo de Importação Anki (${defaultName})`);
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

    this.isExporting = true;
    this.exportProgress = {
      current: 0,
      total: this.project.rows.length,
      percentage: 0,
      status: 'Iniciando processamento em lote...'
    };

    try {
      // Ajustar colunas dinâmicas para o formato de exportação
      const mappedColumns: string[] = [];
      for (const c of this.project.output.columns) {
        if (c.startsWith('sound_')) {
          const idx = parseInt(c.replace('sound_', ''), 10) - 1;
          const t = this.project.tracks[idx];
          if (t) mappedColumns.push(`sound_${t.id}`);
        } else if (c.startsWith('image_')) {
          const idx = parseInt(c.replace('image_', ''), 10) - 1;
          const t = this.project.tracks[idx];
          if (t) mappedColumns.push(`image_${t.id}`);
        } else if (c.startsWith('text_')) {
          const idx = parseInt(c.replace('text_', ''), 10) - 1;
          const t = this.project.tracks[idx];
          if (t) mappedColumns.push(`text_${t.id}`);
        } else {
          mappedColumns.push(c);
        }
      }

      const projectToExport: SubtitleProject = {
        ...this.project,
        output: {
          ...this.project.output,
          columns: mappedColumns
        }
      };

      const result = await this.electron.exportSubtitleProject(projectToExport, {
        outputTxtPath: this.exportOptions.outputTxtPath,
        mediaOutputDir: this.exportOptions.mediaOutputDir,
        generateAudio: this.exportOptions.generateAudio,
        generateImages: this.exportOptions.generateImages,
        copyToAnkiCollectionMedia: this.exportOptions.copyToAnkiCollectionMedia,
        trimSilence: this.exportOptions.trimSilence !== false,
        normalizeAudio: this.exportOptions.normalizeAudio !== false
      });

      this.lastExportResult = {
        txtPath: result.txtPath,
        exportedCount: result.exportedCount
      };

      if (result.errors && result.errors.length > 0) {
        this.showToast(`Concluído com avisos: ${result.exportedCount} cards gerados. (${result.errors.length} avisos)`, 'info');
      } else {
        this.showToast(`Exportação concluída com sucesso! ${result.exportedCount} cards gerados.`, 'success');
      }
    } catch (err: any) {
      this.showToast('Erro ao exportar: ' + (err.message || err), 'error');
    } finally {
      this.isExporting = false;
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

  public showToast(message: string, type: 'success' | 'error' | 'info'): void {
    if (this.notificationTimer) clearTimeout(this.notificationTimer);
    this.notification = { message, type };
    this.notificationTimer = setTimeout(() => {
      this.notification = null;
    }, 4500);
  }
}

