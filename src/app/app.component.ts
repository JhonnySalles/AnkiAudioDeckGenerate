import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ElectronService, AppSettings, AnkiConnectStatus, SaveCardResult, CardPayload } from './core/services/electron.service';
import { LyricsParserService, ParsedLyricLine } from './core/services/lyrics-parser.service';
import { LogService, LogEntry } from './core/services/log.service';
import { SubtitleViewComponent } from './subtitle-view/subtitle-view.component';

export interface DeckCardItem {
  id: string;
  front: string;
  back: string;
  startTime?: string;
  endTime?: string;
  startMs?: number | null;
  endMs?: number | null;
  audioFileName?: string;
  audioPath?: string;
  audioUrl?: string;
  tags: string[];
  status?: 'pending' | 'saving' | 'saved' | 'error';
  errorMessage?: string;
}

export interface HistoryCard {
  id: string;
  front: string;
  back: string;
  audioFileName?: string;
  audioUrl?: string;
  deckName: string;
  tags: string[];
  time: string;
  success: boolean;
  ankiNoteId?: number;
  filePath?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, SubtitleViewComponent],
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit, OnDestroy {
  // Modo de Trabalho da Aplicação: 'music' ou 'subtitles'
  public currentMode: 'music' | 'subtitles' = 'subtitles';
  @ViewChild('modalFrontInput') modalFrontInputRef!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('modalAudioPlayer') modalAudioPlayerRef!: ElementRef<HTMLAudioElement>;
  @ViewChild('rowAudioPlayer') rowAudioPlayerRef!: ElementRef<HTMLAudioElement>;

  // Deck Cards Grid State
  public cards: DeckCardItem[] = [];
  public selectedCardsCount = 0;
  public isSavingDeck = false;
  public saveProgress = { current: 0, total: 0 };

  // Main Screen Tags State
  public tagsInput = '';
  public tagsList: string[] = ['English', 'MusicMining'];

  // Edit Modal State (com Tempo Inicial e Final)
  public isEditModalOpen = false;
  public editingCardIndex: number | null = null;
  public editForm = {
    front: '',
    back: '',
    startTime: '',
    endTime: '',
    tags: [] as string[]
  };
  public editModalTagInput = '';

  // Modal Audio State
  public modalAudioFile: { path: string; filename: string } | null = null;
  public modalAudioPreviewUrl: string | null = null;
  public isRecording = false;
  public recordingTime = 0;
  private recordingInterval: any = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  // Paste Lyrics Modal State
  public isPasteModalOpen = false;
  public pasteLyricsText = '';
  public pasteDelimiter: 'auto' | '\t' | '|' | ';' | '-' | 'custom' = 'auto';
  public pasteCustomDelimiter = '';

  // Extractor & Sync State
  public isExtractorModalOpen = false;
  public extractorTab: 'lrclib' | 'url' | 'file' | 'paste' = 'lrclib';
  public isExtracting = false;

  // Extractor: LRCLIB
  public searchArtist = '';
  public searchTrack = '';
  public lrclibResults: any[] = [];
  public isSearchingLrclib = false;
  public selectedLrclibTrack: any = null;

  // Extractor: URL & HTML
  public extractorUrl = '';
  public extractorTranslationUrl = '';

  // Extractor: File
  public extractorFileName = '';
  public extractorFileContent = '';

  // Extractor: Paste
  public extractorPasteTiming = '';
  public extractorPasteTranslation = '';

  // Extractor: Preview Screen (3 Colunas: Tempo, Letra, Tradução)
  public isPreviewOpen = false;
  public previewLines: ParsedLyricLine[] = [];
  public previewArtist = '';
  public previewTitle = '';

  // Inline Row Audio Playing State
  public activePlayingCardId: string | null = null;
  public rowAudioUrl: string | null = null;

  // Anki & System State
  public ankiStatus: AnkiConnectStatus = { connected: false };
  public availableDecks: string[] = ['Default'];
  public settings: AppSettings = {
    deckName: 'Default',
    defaultTags: 'English MusicMining',
    ankiCollectionMediaDir: '',
    exportTxtPath: '',
    ankiConnectUrl: 'http://127.0.0.1:8765',
    saveMode: 'both'
  };

  // UI State
  public isSettingsOpen = false;
  public isHistoryOpen = false;
  public isLogConsoleOpen = false;
  public logFilterLevel: 'all' | 'error' | 'warn' | 'info' = 'all';
  public logSearchTerm = '';
  public notification: { message: string; type: 'success' | 'error' | 'info' } | null = null;
  private notificationTimeout: any = null;
  private unsubs: Array<() => void> = [];

  // History & Stats
  public sessionHistory: HistoryCard[] = [];
  public createdCount = 0;

  constructor(
    public electronService: ElectronService,
    public lyricsParser: LyricsParserService,
    public logService: LogService
  ) {}

  public async ngOnInit(): Promise<void> {
    await this.loadSettings();
    await this.checkAnkiConnection();

    // Ouvintes de menu do Electron
    const unsubMode = this.electronService.onMenuSwitchMode((mode: string) => {
      if (mode === 'subtitles' || mode === 'music') {
        this.currentMode = mode;
      }
    });
    this.unsubs.push(unsubMode);

    const unsubAction = this.electronService.onMenuTriggerAction((action: string) => {
      if (action === 'open-logs') {
        this.isLogConsoleOpen = true;
      }
    });
    this.unsubs.push(unsubAction);
  }

  public ngOnDestroy(): void {
    this.unsubs.forEach(u => u());
    if (this.recordingInterval) {
      clearInterval(this.recordingInterval);
    }
    this.revokeModalAudio();
    if (this.rowAudioUrl && this.rowAudioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.rowAudioUrl);
    }
  }

  // Keyboard Shortcuts
  @HostListener('window:keydown', ['$event'])
  public handleKeydown(event: KeyboardEvent): void {
    // Ctrl + Enter to Save in Edit Modal
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      if (this.isEditModalOpen) {
        event.preventDefault();
        this.saveEditModal();
      }
    }
    // Ctrl + Space to Play/Pause Audio in Edit Modal
    if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
      if (this.isEditModalOpen) {
        event.preventDefault();
        this.toggleModalAudioPlayback();
      }
    }
    // Escape to close open modals
    if (event.key === 'Escape') {
      if (this.isPreviewOpen) {
        this.isPreviewOpen = false;
      } else if (this.isExtractorModalOpen) {
        this.isExtractorModalOpen = false;
      } else if (this.isEditModalOpen) {
        this.closeEditModal();
      } else if (this.isPasteModalOpen) {
        this.isPasteModalOpen = false;
      } else {
        this.isSettingsOpen = false;
        this.isHistoryOpen = false;
      }
    }
  }

  public async loadSettings(): Promise<void> {
    try {
      this.settings = await this.electronService.getSettings();
      if (this.settings.defaultTags) {
        this.tagsList = this.settings.defaultTags.split(' ').map(t => t.trim()).filter(Boolean);
      }
    } catch (err) {
      console.warn('Erro ao carregar configurações:', err);
    }
  }

  public async checkAnkiConnection(): Promise<void> {
    this.ankiStatus = await this.electronService.checkAnkiConnect();
    if (this.ankiStatus.connected) {
      const decks = await this.electronService.getAnkiDecks();
      if (decks && decks.length > 0) {
        this.availableDecks = decks;
        if (this.settings.deckName && !this.availableDecks.includes(this.settings.deckName)) {
          this.availableDecks.unshift(this.settings.deckName);
        }
      }
    }
  }

  // ================= MAIN SCREEN TAGS =================
  public addTag(): void {
    const clean = this.tagsInput.trim().replace(/\s+/g, '_');
    if (clean && !this.tagsList.includes(clean)) {
      this.tagsList.push(clean);
      this.tagsInput = '';
    }
  }

  public removeTag(index: number): void {
    this.tagsList.splice(index, 1);
  }

  // ================= EDIT MODAL (POPUP) =================
  public openNewCardModal(): void {
    this.editingCardIndex = null;
    this.editForm = {
      front: '',
      back: '',
      startTime: '',
      endTime: '',
      tags: [...this.tagsList]
    };
    this.editModalTagInput = '';
    this.clearModalAudio();
    this.isEditModalOpen = true;
    this.focusModalFront();
  }

  public openEditModal(index: number): void {
    const card = this.cards[index];
    if (!card) return;

    this.editingCardIndex = index;
    this.editForm = {
      front: card.front,
      back: card.back,
      startTime: card.startTime || (card.startMs !== undefined && card.startMs !== null ? this.lyricsParser.msToTimeStr(card.startMs) : ''),
      endTime: card.endTime || (card.endMs !== undefined && card.endMs !== null ? this.lyricsParser.msToTimeStr(card.endMs) : ''),
      tags: [...card.tags]
    };
    this.editModalTagInput = '';

    this.clearModalAudio();
    if (card.audioFileName) {
      this.modalAudioFile = {
        path: card.audioPath || '',
        filename: card.audioFileName
      };
      if (card.audioUrl) {
        this.modalAudioPreviewUrl = card.audioUrl;
      } else if (card.audioPath) {
        this.modalAudioPreviewUrl = `file:///${card.audioPath.replace(/\\/g, '/')}`;
      }
    }

    this.isEditModalOpen = true;
    this.focusModalFront();
  }

  public closeEditModal(): void {
    if (this.isRecording) {
      this.stopRecording();
    }
    this.isEditModalOpen = false;
    this.editingCardIndex = null;
  }

  public clearModalFields(): void {
    this.editForm.front = '';
    this.editForm.back = '';
    this.editForm.startTime = '';
    this.editForm.endTime = '';
    this.clearModalAudio();
    this.focusModalFront();
  }

  public addModalTag(): void {
    const clean = this.editModalTagInput.trim().replace(/\s+/g, '_');
    if (clean && !this.editForm.tags.includes(clean)) {
      this.editForm.tags.push(clean);
      this.editModalTagInput = '';
    }
  }

  public removeModalTag(index: number): void {
    this.editForm.tags.splice(index, 1);
  }

  public saveEditModal(): void {
    if (!this.editForm.front.trim()) {
      this.showToast('Preencha o campo Frente do card.', 'error');
      this.focusModalFront();
      return;
    }

    if (!this.editForm.back.trim()) {
      this.showToast('Preencha o campo Verso do card.', 'error');
      return;
    }

    const startMs = this.lyricsParser.timeToMs(this.editForm.startTime);
    const endMs = this.lyricsParser.timeToMs(this.editForm.endTime);

    // Validação de tempo se ambos preenchidos
    if (startMs !== null && endMs !== null && endMs < startMs) {
      this.showToast('O Tempo Final não pode ser menor que o Tempo Inicial.', 'error');
      return;
    }

    const cardData: DeckCardItem = {
      id: this.editingCardIndex !== null ? this.cards[this.editingCardIndex].id : Date.now().toString(),
      front: this.editForm.front.trim(),
      back: this.editForm.back.trim(),
      startTime: this.editForm.startTime.trim() || undefined,
      endTime: this.editForm.endTime.trim() || undefined,
      startMs: startMs,
      endMs: endMs,
      audioFileName: this.modalAudioFile?.filename,
      audioPath: this.modalAudioFile?.path,
      audioUrl: this.modalAudioPreviewUrl || undefined,
      tags: [...this.editForm.tags],
      status: 'pending'
    };

    if (this.editingCardIndex !== null) {
      this.cards[this.editingCardIndex] = cardData;
      this.showToast('Card atualizado com sucesso!', 'success');
    } else {
      this.cards.push(cardData);
      this.showToast('Novo card adicionado ao deck!', 'success');
    }

    this.closeEditModal();
  }

  private focusModalFront(): void {
    setTimeout(() => {
      this.modalFrontInputRef?.nativeElement?.focus();
    }, 100);
  }

  // ================= MODAL AUDIO HANDLING =================
  public async toggleRecording(): Promise<void> {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private async startRecording(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/mp3' });
        const buffer = await audioBlob.arrayBuffer();

        stream.getTracks().forEach(t => t.stop());

        const prefix = this.editForm.front.trim().slice(0, 20) || 'gravacao';
        const saved = await this.electronService.saveRecordedAudio(buffer, prefix);

        this.setModalAudioFile(saved.path, saved.filename, audioBlob);
        this.showToast('Áudio gravado com sucesso!', 'success');
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordingTime = 0;
      this.recordingInterval = setInterval(() => {
        this.recordingTime++;
      }, 1000);
    } catch (err: any) {
      this.showToast('Erro ao acessar microfone: ' + (err.message || err), 'error');
    }
  }

  private stopRecording(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      if (this.recordingInterval) {
        clearInterval(this.recordingInterval);
        this.recordingInterval = null;
      }
    }
  }

  public async selectModalAudioFile(): Promise<void> {
    const selected = await this.electronService.selectAudioFile();
    if (selected) {
      this.setModalAudioFile(selected.path, selected.filename);
      this.showToast(`Áudio selecionado: ${selected.filename}`, 'info');
    }
  }

  public onModalAudioDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      const filePath = (file as any).path || '';
      if (filePath) {
        this.setModalAudioFile(filePath, file.name, file);
      } else {
        void file.arrayBuffer().then(async (buf) => {
          const saved = await this.electronService.saveRecordedAudio(buf, file.name);
          this.setModalAudioFile(saved.path, saved.filename, file);
        });
      }
      this.showToast(`Arquivo carregado: ${file.name}`, 'info');
    }
  }

  public onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private setModalAudioFile(filePath: string, filename: string, blob?: Blob): void {
    this.revokeModalAudio();
    this.modalAudioFile = { path: filePath, filename };

    if (blob) {
      this.modalAudioPreviewUrl = URL.createObjectURL(blob);
    } else {
      this.modalAudioPreviewUrl = `file:///${filePath.replace(/\\/g, '/')}`;
    }
  }

  public clearModalAudio(): void {
    this.revokeModalAudio();
    this.modalAudioFile = null;
  }

  private revokeModalAudio(): void {
    if (this.modalAudioPreviewUrl && this.modalAudioPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.modalAudioPreviewUrl);
    }
    this.modalAudioPreviewUrl = null;
  }

  public toggleModalAudioPlayback(): void {
    if (!this.modalAudioPlayerRef?.nativeElement || !this.modalAudioPreviewUrl) return;
    const player = this.modalAudioPlayerRef.nativeElement;
    if (player.paused) {
      player.play().catch(e => console.warn('Erro ao reproduzir áudio:', e));
    } else {
      player.pause();
    }
  }

  // ================= GRID / TABLE ACTIONS =================
  public deleteCard(index: number): void {
    this.cards.splice(index, 1);
    this.showToast('Card removido.', 'info');
  }

  public clearAllCards(): void {
    if (this.cards.length === 0) return;
    if (confirm('Tem certeza que deseja limpar todos os cards da lista?')) {
      this.cards = [];
      this.showToast('Lista de cards limpa.', 'info');
    }
  }

  public toggleRowAudio(card: DeckCardItem): void {
    if (!card.audioFileName && !card.audioUrl && !card.audioPath) return;

    if (this.activePlayingCardId === card.id) {
      if (this.rowAudioPlayerRef?.nativeElement) {
        this.rowAudioPlayerRef.nativeElement.pause();
      }
      this.activePlayingCardId = null;
      return;
    }

    let url = card.audioUrl;
    if (!url && card.audioPath) {
      url = `file:///${card.audioPath.replace(/\\/g, '/')}`;
    } else if (!url && card.audioFileName && this.settings.ankiCollectionMediaDir) {
      const fullPath = `${this.settings.ankiCollectionMediaDir.replace(/\\/g, '/')}/${card.audioFileName}`;
      url = `file:///${fullPath}`;
    }

    if (!url) {
      this.showToast(`Áudio não localizado: ${card.audioFileName}`, 'error');
      return;
    }

    this.rowAudioUrl = url;
    this.activePlayingCardId = card.id;

    setTimeout(() => {
      if (this.rowAudioPlayerRef?.nativeElement) {
        this.rowAudioPlayerRef.nativeElement.play().catch(err => {
          console.warn('Erro ao reproduzir áudio da linha:', err);
          this.activePlayingCardId = null;
          this.showToast('Não foi possível reproduzir este áudio.', 'error');
        });
      }
    }, 50);
  }

  public onRowAudioEnded(): void {
    this.activePlayingCardId = null;
  }

  // ================= LYRICS IMPORTING & PARSING =================
  public openPasteModal(): void {
    this.pasteLyricsText = '';
    this.pasteDelimiter = 'auto';
    this.pasteCustomDelimiter = '';
    this.isPasteModalOpen = true;
  }

  public getEffectivePasteDelimiter(): string {
    if (this.pasteDelimiter === 'custom') {
      return this.pasteCustomDelimiter.trim() || '|';
    }
    return this.pasteDelimiter;
  }

  public previewPastedLyrics(): void {
    if (!this.pasteLyricsText.trim()) {
      this.showToast('Cole o conteúdo para pré-visualizar.', 'error');
      return;
    }
    const delimiter = this.getEffectivePasteDelimiter();
    const parsed = this.lyricsParser.parseDelimitedText(this.pasteLyricsText, { delimiter });
    if (parsed.length === 0) {
      this.showToast('Nenhuma linha identificada.', 'error');
      return;
    }
    this.previewLines = parsed;
    this.previewArtist = '';
    this.previewTitle = 'Importação Delimitada';
    this.isPasteModalOpen = false;
    this.isPreviewOpen = true;
  }

  public processPastedLyrics(): void {
    if (!this.pasteLyricsText.trim()) {
      this.showToast('Cole o conteúdo das letras para importar.', 'error');
      return;
    }

    const countBefore = this.cards.length;
    const delimiter = this.getEffectivePasteDelimiter();
    this.parseLyricsContent(this.pasteLyricsText, delimiter);
    const imported = this.cards.length - countBefore;

    this.isPasteModalOpen = false;
    this.pasteLyricsText = '';
    this.showToast(`${imported} cards importados com sucesso!`, 'success');
  }

  public onTxtFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        const countBefore = this.cards.length;
        this.parseLyricsContent(content, 'auto');
        const imported = this.cards.length - countBefore;
        this.showToast(`${imported} cards importados de ${file.name}!`, 'success');
      }
      input.value = '';
    };

    reader.onerror = () => {
      this.showToast('Erro ao ler o arquivo selecionado.', 'error');
      input.value = '';
    };

    reader.readAsText(file);
  }

  private parseLyricsContent(content: string, delimiter: string = 'auto'): void {
    const parsed = this.lyricsParser.parseDelimitedText(content, { delimiter });

    for (const item of parsed) {
      const front = item.original.trim();
      if (!front) continue;

      const back = item.translation.trim();
      const audioFileName = item.audioFileName;
      const tags = (item.tags && item.tags.length > 0) ? item.tags : [...this.tagsList];

      this.cards.push({
        id: (Date.now() + Math.random() * 1000).toString(),
        front,
        back,
        startTime: item.startTime || undefined,
        endTime: item.endTime || undefined,
        startMs: item.startMs,
        endMs: item.endMs,
        audioFileName,
        tags,
        status: 'pending'
      });
    }
  }

  // ================= SAVE ENTIRE DECK IN BATCH =================
  public async saveDeck(): Promise<void> {
    if (this.cards.length === 0) {
      this.showToast('Não há cards na lista para salvar.', 'info');
      return;
    }

    this.isSavingDeck = true;
    this.saveProgress = { current: 0, total: this.cards.length };
    let successCount = 0;

    try {
      for (let i = 0; i < this.cards.length; i++) {
        const card = this.cards[i];
        card.status = 'saving';

        const payload: CardPayload = {
          front: card.front,
          back: card.back,
          audioPath: card.audioPath,
          audioFileName: card.audioFileName,
          tags: card.tags.length > 0 ? card.tags : this.tagsList,
          deckName: this.settings.deckName || 'Default'
        };

        const result: SaveCardResult = await this.electronService.saveCard(payload);

        if (result.success) {
          card.status = 'saved';
          successCount++;
          this.createdCount++;

          const historyItem: HistoryCard = {
            id: Date.now().toString() + '-' + i,
            front: payload.front,
            back: payload.back,
            audioFileName: payload.audioFileName,
            audioUrl: card.audioUrl,
            deckName: payload.deckName,
            tags: [...payload.tags],
            time: new Date().toLocaleTimeString(),
            success: true,
            ankiNoteId: result.ankiNoteId,
            filePath: result.filePath
          };
          this.sessionHistory.unshift(historyItem);
        } else {
          card.status = 'error';
          card.errorMessage = result.error || 'Erro desconhecido';
        }

        this.saveProgress.current = i + 1;
      }

      if (successCount === this.cards.length) {
        this.showToast(`Todos os ${successCount} cards foram salvos com sucesso no Anki!`, 'success');
      } else {
        this.showToast(`${successCount} de ${this.cards.length} cards salvos. Verifique os com erro.`, 'info');
      }
    } catch (err: any) {
      this.showToast('Erro ao processar o deck: ' + (err.message || err), 'error');
    } finally {
      this.isSavingDeck = false;
    }
  }

  // ================= EXTRACTOR & SYNC LOGIC =================
  public openExtractorModal(): void {
    this.isExtractorModalOpen = true;
    this.lrclibResults = [];
    this.selectedLrclibTrack = null;
  }

  public closeExtractorModal(): void {
    this.isExtractorModalOpen = false;
  }

  public async searchLrclibTracks(): Promise<void> {
    if (!this.searchTrack.trim() && !this.searchArtist.trim()) {
      this.showToast('Informe o nome da música ou do artista para buscar.', 'info');
      return;
    }

    this.isSearchingLrclib = true;
    try {
      this.lrclibResults = await this.electronService.searchLrclib({
        track: this.searchTrack.trim(),
        artist: this.searchArtist.trim()
      });
      if (this.lrclibResults.length === 0) {
        this.showToast('Nenhuma letra encontrada no LRCLIB para esta busca.', 'info');
      }
    } catch (err: any) {
      this.showToast('Erro ao buscar no LRCLIB: ' + (err.message || err), 'error');
    } finally {
      this.isSearchingLrclib = false;
    }
  }

  public selectLrclibTrack(track: any): void {
    this.selectedLrclibTrack = track;
    this.previewArtist = track.artistName || '';
    this.previewTitle = track.trackName || '';
  }

  public async selectLocalLyricsFile(): Promise<void> {
    const res = await this.electronService.selectLyricsFile();
    if (res) {
      this.extractorFileName = res.filename;
      this.extractorFileContent = res.content;
      this.showToast(`Arquivo carregado: ${res.filename}`, 'info');
    }
  }

  public async runExtraction(): Promise<void> {
    this.isExtracting = true;
    try {
      let timingLines: ParsedLyricLine[] = [];
      let translations: string[] = [];
      let detectedArtist = this.previewArtist;
      let detectedTitle = this.previewTitle;

      // 1. Obter linhas com tempo e original
      if (this.extractorTab === 'lrclib') {
        if (!this.selectedLrclibTrack) {
          this.showToast('Selecione uma faixa na lista do LRCLIB.', 'error');
          return;
        }
        const synced = this.selectedLrclibTrack.syncedLyrics || '';
        const plain = this.selectedLrclibTrack.plainLyrics || '';
        if (synced) {
          timingLines = this.lyricsParser.parseLrc(synced);
        } else if (plain) {
          const lines = plain.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
          timingLines = lines.map((text: string, idx: number) => ({
            index: idx + 1,
            startTime: '',
            endTime: '',
            startMs: null,
            endMs: null,
            original: text,
            translation: '',
            selected: true
          }));
        }

        detectedArtist = this.selectedLrclibTrack.artistName || detectedArtist;
        detectedTitle = this.selectedLrclibTrack.trackName || detectedTitle;

        if (this.extractorTranslationUrl.trim()) {
          const html = await this.electronService.fetchUrl(this.extractorTranslationUrl.trim());
          const parsedHtml = this.lyricsParser.parseBilingualHtml(html);
          translations = parsedHtml.translations;
        }

      } else if (this.extractorTab === 'url') {
        if (!this.extractorUrl.trim()) {
          this.showToast('Informe a URL da página.', 'error');
          return;
        }
        const html = await this.electronService.fetchUrl(this.extractorUrl.trim());
        const parsed = this.lyricsParser.parseBilingualHtml(html);
        detectedArtist = parsed.artist || detectedArtist;
        detectedTitle = parsed.title || detectedTitle;

        if (parsed.originals.length > 0) {
          timingLines = parsed.originals.map((text, idx) => ({
            index: idx + 1,
            startTime: '',
            endTime: '',
            startMs: null,
            endMs: null,
            original: text,
            translation: parsed.translations[idx] || '',
            selected: true
          }));
        }

      } else if (this.extractorTab === 'file') {
        if (!this.extractorFileContent) {
          this.showToast('Selecione um arquivo de letra ou legenda.', 'error');
          return;
        }
        const ext = this.extractorFileName.toLowerCase();
        if (ext.endsWith('.lrc')) {
          timingLines = this.lyricsParser.parseLrc(this.extractorFileContent);
        } else if (ext.endsWith('.srt') || ext.endsWith('.vtt')) {
          timingLines = this.lyricsParser.parseSrtOrVtt(this.extractorFileContent);
        } else if (ext.endsWith('.html') || ext.endsWith('.htm')) {
          const parsed = this.lyricsParser.parseBilingualHtml(this.extractorFileContent);
          detectedArtist = parsed.artist || detectedArtist;
          detectedTitle = parsed.title || detectedTitle;
          timingLines = parsed.originals.map((text, idx) => ({
            index: idx + 1,
            startTime: '',
            endTime: '',
            startMs: null,
            endMs: null,
            original: text,
            translation: parsed.translations[idx] || '',
            selected: true
          }));
        } else if (ext.endsWith('.txt') || ext.endsWith('.tsv')) {
          timingLines = this.lyricsParser.parseDelimitedText(this.extractorFileContent, { delimiter: 'auto' });
        } else {
          // Verificar se é arquivo de texto com marcações ou delimitadores
          const delimited = this.lyricsParser.parseDelimitedText(this.extractorFileContent, { delimiter: 'auto' });
          if (delimited.length > 0 && delimited.some(d => d.startTime || d.translation)) {
            timingLines = delimited;
          } else {
            timingLines = this.lyricsParser.parseLrc(this.extractorFileContent);
            if (timingLines.length === 0) {
              const lines = this.extractorFileContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
              timingLines = lines.map((text, idx) => ({
                index: idx + 1,
                startTime: '',
                endTime: '',
                startMs: null,
                endMs: null,
                original: text,
                translation: '',
                selected: true
              }));
            }
          }
        }

      } else if (this.extractorTab === 'paste') {
        if (!this.extractorPasteTiming.trim()) {
          this.showToast('Cole a letra ou sincronização para extrair.', 'error');
          return;
        }

        const isDelimited = (
          this.extractorPasteTiming.includes('|') ||
          this.extractorPasteTiming.includes('\t') ||
          this.extractorPasteTiming.includes(';') ||
          /\[\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*-\s*\d{1,2}:\d{2}/.test(this.extractorPasteTiming)
        );

        if (isDelimited) {
          timingLines = this.lyricsParser.parseDelimitedText(this.extractorPasteTiming, { delimiter: 'auto' });
        } else if (this.extractorPasteTiming.includes('[')) {
          timingLines = this.lyricsParser.parseLrc(this.extractorPasteTiming);
        } else if (this.extractorPasteTiming.includes('-->')) {
          timingLines = this.lyricsParser.parseSrtOrVtt(this.extractorPasteTiming);
        } else {
          const lines = this.extractorPasteTiming.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          timingLines = lines.map((text, idx) => ({
            index: idx + 1,
            startTime: '',
            endTime: '',
            startMs: null,
            endMs: null,
            original: text,
            translation: '',
            selected: true
          }));
        }

        if (this.extractorPasteTranslation.trim() && !timingLines.some(l => l.translation)) {
          const transLines = this.extractorPasteTranslation.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          translations = transLines;
        }
      }

      if (timingLines.length === 0) {
        this.showToast('Nenhuma linha de letra identificada.', 'error');
        return;
      }

      if (translations.length > 0) {
        timingLines = this.lyricsParser.alignLyrics(timingLines, translations);
      }

      this.previewLines = timingLines;
      this.previewArtist = detectedArtist || '';
      this.previewTitle = detectedTitle || '';

      this.isExtractorModalOpen = false;
      this.isPreviewOpen = true;
      this.showToast(`${timingLines.length} linhas extraídas para pré-visualização!`, 'success');

    } catch (err: any) {
      this.showToast('Erro durante extração: ' + (err.message || err), 'error');
    } finally {
      this.isExtracting = false;
    }
  }

  // ================= PREVIEW ACTIONS =================
  public toggleAllPreview(checked: boolean): void {
    this.previewLines.forEach(l => l.selected = checked);
  }

  public applyPreviewToDeck(replace: boolean = false): void {
    const selected = this.previewLines.filter(l => l.selected);
    if (selected.length === 0) {
      this.showToast('Selecione ao menos uma linha para adicionar ao deck.', 'info');
      return;
    }

    if (replace) {
      this.cards = [];
    }

    const newTags = [...this.tagsList];
    if (this.previewArtist) {
      const artistTag = this.previewArtist.replace(/[^\w]/g, '');
      if (artistTag && !newTags.includes(artistTag)) newTags.push(artistTag);
    }
    if (this.previewTitle) {
      const titleTag = this.previewTitle.replace(/[^\w]/g, '');
      if (titleTag && !newTags.includes(titleTag)) newTags.push(titleTag);
    }

    for (const item of selected) {
      this.cards.push({
        id: (Date.now() + Math.random() * 1000).toString(),
        front: item.original,
        back: item.translation,
        startTime: item.startTime || undefined,
        endTime: item.endTime || undefined,
        startMs: item.startMs,
        endMs: item.endMs,
        tags: [...newTags],
        status: 'pending'
      });
    }

    this.isPreviewOpen = false;
    this.showToast(`${selected.length} cards adicionados ao deck!`, 'success');
  }

  public closePreview(): void {
    this.isPreviewOpen = false;
  }

  // ================= SETTINGS =================
  public async saveSettings(): Promise<void> {
    this.settings.defaultTags = this.tagsList.join(' ');
    await this.electronService.saveSettings(this.settings);
    this.isSettingsOpen = false;
    this.showToast('Configurações salvas com sucesso!', 'success');
  }

  public async browseExportFile(): Promise<void> {
    const file = await this.electronService.selectFile('Arquivo para Exportação TSV (.txt)');
    if (file) {
      this.settings.exportTxtPath = file;
    }
  }

  public async browseMediaDir(): Promise<void> {
    const dir = await this.electronService.selectDirectory('Pasta collection.media do Anki');
    if (dir) {
      this.settings.ankiCollectionMediaDir = dir;
    }
  }

  public async openExportPath(): Promise<void> {
    if (this.settings.exportTxtPath) {
      await this.electronService.openPath(this.settings.exportTxtPath);
    }
  }

  public openDevTools(): void {
    void this.electronService.toggleDevTools();
  }

  public formatSeconds(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  public showToast(message: string, type: 'success' | 'error' | 'info'): void {
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
    }
    this.notification = { message, type };
    this.notificationTimeout = setTimeout(() => {
      this.notification = null;
    }, 4000);
  }

  // ================= LOG CONSOLE HELPERS =================
  public getFilteredLogs(): LogEntry[] {
    let logs = this.logService.getLogs();
    if (this.logFilterLevel !== 'all') {
      logs = logs.filter(l => l.level === this.logFilterLevel);
    }
    if (this.logSearchTerm.trim()) {
      const term = this.logSearchTerm.toLowerCase();
      logs = logs.filter(l =>
        l.message.toLowerCase().includes(term) ||
        l.source.toLowerCase().includes(term) ||
        l.level.toLowerCase().includes(term)
      );
    }
    return logs;
  }

  public getLogCounts(): { total: number; errors: number; warns: number; infos: number } {
    const all = this.logService.getLogs();
    let errors = 0;
    let warns = 0;
    let infos = 0;
    for (const l of all) {
      if (l.level === 'error') errors++;
      else if (l.level === 'warn') warns++;
      else infos++;
    }
    return { total: all.length, errors, warns, infos };
  }

  public async copyLogsToClipboard(): Promise<void> {
    const logs = this.getFilteredLogs();
    if (logs.length === 0) {
      this.showToast('Nenhum log para copiar.', 'info');
      return;
    }
    const text = logs.map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.showToast(`${logs.length} logs copiados para a área de transferência!`, 'success');
    } catch {
      this.showToast('Erro ao copiar logs para a área de transferência.', 'error');
    }
  }
}

