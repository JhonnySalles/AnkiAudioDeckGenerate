import { Injectable } from '@angular/core';
import { SubtitleCue } from '../types/subtitle-project';

export interface SubtitleParseOptions {
  removeStyledLines?: boolean;
}

export type AnkiColumnType = 'ignore' | 'id' | 'text' | 'image' | 'audio';
export type AnkiColumnAction = 'new_track' | 'combine';

export interface AnkiColumnMapping {
  index: number;
  sampleValues: string[];
  type: AnkiColumnType;
  action: AnkiColumnAction;
  targetTrackLabel?: string;
  combineWithTrackIndex?: number;
}

export interface AnkiParseResult {
  fileName: string;
  separator: string;
  episodeName?: string;
  totalRows: number;
  columnsCount: number;
  rawRows: string[][];
  suggestedMappings: AnkiColumnMapping[];
}

@Injectable({
  providedIn: 'root'
})
export class SubtitleParserService {

  public timeToMs(timeStr: string): number | null {
    if (!timeStr) return null;
    const clean = timeStr.trim().replace(',', '.');

    // Formato hh:mm:ss.xxx ou h:mm:ss.xx
    const hourMatch = clean.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (hourMatch) {
      const hours = parseInt(hourMatch[1], 10);
      const minutes = parseInt(hourMatch[2], 10);
      const seconds = parseInt(hourMatch[3], 10);
      let ms = 0;
      if (hourMatch[4]) {
        ms = parseInt(hourMatch[4].padEnd(3, '0').slice(0, 3), 10);
      }
      return hours * 3600 * 1000 + minutes * 60 * 1000 + seconds * 1000 + ms;
    }

    // Formato mm:ss.xxx
    const minMatch = clean.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (minMatch) {
      const minutes = parseInt(minMatch[1], 10);
      const seconds = parseInt(minMatch[2], 10);
      let ms = 0;
      if (minMatch[3]) {
        ms = parseInt(minMatch[3].padEnd(3, '0').slice(0, 3), 10);
      }
      return minutes * 60 * 1000 + seconds * 1000 + ms;
    }

    return null;
  }

  // Gera string com formato 00:00:00.000
  public msToTimeStr(ms: number | null): string {
    if (ms === null || isNaN(ms) || ms < 0) return '00:00:00.000';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor(ms % 1000);

    const hStr = hours.toString().padStart(2, '0');
    const mStr = minutes.toString().padStart(2, '0');
    const sStr = seconds.toString().padStart(2, '0');
    const msStr = milliseconds.toString().padStart(3, '0');

    return `${hStr}:${mStr}:${sStr}.${msStr}`;
  }

  // Formato para nome de arquivo Anki (ex: 0.00.01.920)
  public msToFileNameTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor(ms % 1000);

    const mStr = minutes.toString().padStart(2, '0');
    const sStr = seconds.toString().padStart(2, '0');
    const msStr = milliseconds.toString().padStart(3, '0');

    return `${hours}.${mStr}.${sStr}.${msStr}`;
  }

  // Formato para ID (ex: 00:04:24)
  public msToIdTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const hStr = hours.toString().padStart(2, '0');
    const mStr = minutes.toString().padStart(2, '0');
    const sStr = seconds.toString().padStart(2, '0');

    return `${hStr}:${mStr}:${sStr}`;
  }

  public parseSubtitle(content: string, fileName: string = '', options?: SubtitleParseOptions): SubtitleCue[] {
    const ext = fileName.toLowerCase();
    if (ext.endsWith('.ass') || ext.endsWith('.ssa') || content.includes('[Events]') || content.includes('Dialogue:')) {
      return this.parseAss(content, options);
    }
    if (ext.endsWith('.sbv') || /^\d+:\d{2}:\d{2}\.\d{3},\d+:\d{2}:\d{2}\.\d{3}/m.test(content)) {
      return this.parseSbv(content);
    }
    if (ext.endsWith('.sub') || /^\{\d+\}\{\d+\}/m.test(content)) {
      return this.parseMicroDvd(content);
    }
    if (ext.endsWith('.lrc') || /^\[\d{2}:\d{2}/m.test(content)) {
      return this.parseLrc(content);
    }
    return this.parseSrt(content, options);
  }

  // Parser de YouTube (.sbv)
  public parseSbv(content: string): SubtitleCue[] {
    const blocks = content.split(/(?:\r?\n){2,}/);
    const cues: SubtitleCue[] = [];
    const timeRegex = /(\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*,\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?)/;

    let indexCounter = 1;
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      const match = lines[0].match(timeRegex);
      if (match) {
        const startMs = this.timeToMs(match[1]);
        const endMs = this.timeToMs(match[2]);
        const text = lines.slice(1).join('\n').trim();

        if (text && startMs !== null && endMs !== null) {
          cues.push({
            id: `cue_sbv_${indexCounter}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            originalIndex: indexCounter++,
            startMs,
            endMs,
            origStartMs: startMs,
            origEndMs: endMs,
            text
          });
        }
      }
    }
    return cues;
  }

  // Parser de MicroDVD (.sub) assumindo taxa padrão de 25 fps se não especificado
  public parseMicroDvd(content: string, fps = 25): SubtitleCue[] {
    const lines = content.split(/\r?\n/);
    const cues: SubtitleCue[] = [];
    let effectiveFps = fps;
    let indexCounter = 1;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const match = trimmed.match(/^\{(\d+)\}\{(\d+)\}(.*)$/);
      if (match) {
        const frameStart = parseInt(match[1], 10);
        const frameEnd = parseInt(match[2], 10);
        let text = match[3].replace(/\|/g, '\n').trim();

        // Linha de cabeçalho de FPS (ex: {1}{1}23.976 ou {1}{1}25)
        if (frameStart === 1 && frameEnd === 1 && !isNaN(parseFloat(text))) {
          effectiveFps = parseFloat(text);
          continue;
        }

        const startMs = Math.round((frameStart / effectiveFps) * 1000);
        const endMs = Math.round((frameEnd / effectiveFps) * 1000);

        if (text) {
          cues.push({
            id: `cue_sub_${indexCounter}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            originalIndex: indexCounter++,
            startMs,
            endMs,
            origStartMs: startMs,
            origEndMs: endMs,
            text
          });
        }
      }
    }
    return cues;
  }

  // Parser de LRC
  public parseLrc(content: string): SubtitleCue[] {
    const lines = content.split(/\r?\n/);
    const temp: { ms: number; text: string }[] = [];
    const lrcRegex = /\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || /^\[(ar|ti|al|by|offset):/i.test(line)) continue;

      const matches = Array.from(line.matchAll(lrcRegex));
      if (matches.length > 0) {
        const text = line.replace(lrcRegex, '').trim();
        if (text) {
          for (const m of matches) {
            const ms = this.timeToMs(m[1]);
            if (ms !== null) temp.push({ ms, text });
          }
        }
      }
    }

    temp.sort((a, b) => a.ms - b.ms);
    const cues: SubtitleCue[] = [];
    for (let i = 0; i < temp.length; i++) {
      const cur = temp[i];
      const endMs = (i + 1 < temp.length) ? temp[i + 1].ms : cur.ms + 3500;
      cues.push({
        id: `cue_lrc_${i + 1}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        originalIndex: i + 1,
        startMs: cur.ms,
        endMs,
        origStartMs: cur.ms,
        origEndMs: endMs,
        text: cur.text
      });
    }
    return cues;
  }

  // Parser de SRT e VTT
  public parseSrt(content: string, options?: SubtitleParseOptions): SubtitleCue[] {
    const removeStyled = options?.removeStyledLines !== false;
    const cleanContent = content.replace(/^WEBVTT.*(\r?\n)+/i, '');
    const blocks = cleanContent.split(/(?:\r?\n){2,}/);
    const cues: SubtitleCue[] = [];

    const timeRegex = /(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)/;

    let indexCounter = 1;
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      let timeLineIdx = -1;
      let match: RegExpMatchArray | null = null;

      for (let i = 0; i < lines.length; i++) {
        match = lines[i].match(timeRegex);
        if (match) {
          timeLineIdx = i;
          break;
        }
      }

      if (match && timeLineIdx !== -1) {
        const startMs = this.timeToMs(match[1]);
        const endMs = this.timeToMs(match[2]);

        const textLines = lines.slice(timeLineIdx + 1);
        const rawText = textLines
          .join(' ')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        if (removeStyled) {
          // Ignora créditos de fansub comuns em arquivos SRT
          if (/^(\[staff\]|staff:|\(staff\)|fansub|traduzido por|legendado por)/i.test(rawText)) {
            continue;
          }
        }

        if (rawText && startMs !== null && endMs !== null) {
          cues.push({
            id: `cue_${indexCounter}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            originalIndex: indexCounter++,
            startMs,
            endMs,
            origStartMs: startMs,
            origEndMs: endMs,
            text: rawText
          });
        }
      }
    }

    return cues;
  }

  // Parser de ASS/SSA com filtragem de linhas estilizadas (RemoveStyledLines)
  public parseAss(content: string, options?: SubtitleParseOptions): SubtitleCue[] {
    const removeStyled = options?.removeStyledLines !== false;
    const lines = content.split(/\r?\n/);
    const cues: SubtitleCue[] = [];
    let inEvents = false;
    let formatFields: string[] = [];

    let indexCounter = 1;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';')) continue;

      if (trimmed.toLowerCase() === '[events]') {
        inEvents = true;
        continue;
      }

      if (inEvents) {
        if (trimmed.startsWith('[')) {
          inEvents = false;
          continue;
        }

        if (trimmed.toLowerCase().startsWith('format:')) {
          formatFields = trimmed.substring(7).split(',').map(f => f.trim().toLowerCase());
          continue;
        }

        if (trimmed.toLowerCase().startsWith('dialogue:')) {
          const rawValues = trimmed.substring(9).trim();
          let values: string[] = [];

          if (formatFields.length > 0) {
            // Dialogue tem N campos, mas o último (Text) pode conter vírgulas
            const maxSplits = formatFields.length - 1;
            let current = '';
            let splits = 0;
            for (let i = 0; i < rawValues.length; i++) {
              if (rawValues[i] === ',' && splits < maxSplits) {
                values.push(current.trim());
                current = '';
                splits++;
              } else {
                current += rawValues[i];
              }
            }
            values.push(current.trim());
          } else {
            values = rawValues.split(',').map(v => v.trim());
          }

          const startIdx = formatFields.indexOf('start') !== -1 ? formatFields.indexOf('start') : 1;
          const endIdx = formatFields.indexOf('end') !== -1 ? formatFields.indexOf('end') : 2;
          const styleIdx = formatFields.indexOf('style') !== -1 ? formatFields.indexOf('style') : 3;
          const textIdx = formatFields.indexOf('text') !== -1 ? formatFields.indexOf('text') : values.length - 1;

          const startStr = values[startIdx];
          const endStr = values[endIdx];
          const style = (values[styleIdx] || '').trim();
          let rawText = values[textIdx] || '';

          if (removeStyled) {
            const normalizedStyle = style.toLowerCase();

            // Filtrar estilos de não-diálogo: Staff, Créditos, OP/ED, Músicas, Placas, Títulos
            const isNonDialogueStyle = /^(staff|credit|credits|op|ed|op[-_].*|ed[-_].*|.*[-_]op|.*[-_]ed|song|songs|kara|karaoke|lyrics|romaji|sign|signs|title|gamen|note|notes|screen|caption|eyecatch|next|preview|insert)/i.test(normalizedStyle);
            if (isNonDialogueStyle) {
              continue;
            }

            // Em arquivos de fansub bilíngues (ex: Kamigami), filtrar faixas chinesas
            if (/^(sub[-_]cn|sub[-_]cnup|op[-_]cn|ed[-_]cn)/i.test(normalizedStyle)) {
              continue;
            }

            // Ignorar comandos de desenho vetorial (ex: {\p1}...)
            if (/\{\\p[1-9]\}/i.test(rawText)) {
              continue;
            }

            // Ignorar placas posicionadas na tela com \pos ou \move na primeira tag de estilo
            if (/^\{[^}]*\\(pos|move|org|fad)\(/i.test(rawText)) {
              continue;
            }
          }

          // Limpar tags de estilo {\...} e normalizar quebras de linha para espaço simples (padrão subs2srs)
          const text = rawText
            .replace(/\{[^}]+\}/g, '')
            .replace(/\\N/gi, ' ')
            .replace(/\\n/gi, ' ')
            .replace(/\\h/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          const startMs = this.timeToMs(startStr);
          const endMs = this.timeToMs(endStr);

          if (text && startMs !== null && endMs !== null) {
            cues.push({
              id: `cue_ass_${indexCounter}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              originalIndex: indexCounter++,
              startMs,
              endMs,
              origStartMs: startMs,
              origEndMs: endMs,
              text
            });
          }
        }
      }
    }

    // Ordenar por tempo inicial
    cues.sort((a, b) => a.startMs - b.startMs);
    return cues;
  }

  // =========================================================================
  // PARSER DE ARQUIVOS TABULARES / EXPORTAÇÃO DO ANKI (CSV, TSV, TXT)
  // =========================================================================

  public isAnkiOrTabularContent(content: string, fileName: string = ''): boolean {
    const ext = fileName.toLowerCase();
    if (ext.endsWith('.csv')) return true;
    if (content.startsWith('#separator:') || content.includes('#separator:tab') || content.includes('#separator:comma') || content.includes('#separator:semicolon')) {
      return true;
    }
    // Se tiver '-->', é muito provavelmente um SRT ou WebVTT tradicional
    if (content.includes('-->')) return false;

    // Verificar consistência de delimitadores nas primeiras linhas
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#')).slice(0, 5);
    if (lines.length >= 2) {
      for (const sep of [';', '\t', '|', ',']) {
        const counts = lines.map(l => this.parseDelimitedRow(l, sep).length);
        if (counts[0] > 1 && counts.every(c => c === counts[0])) {
          return true;
        }
      }
    }
    return false;
  }

  public detectAnkiSeparator(content: string): string {
    const headerMatch = content.match(/^#separator:(.+)$/m);
    if (headerMatch) {
      const val = headerMatch[1].trim().toLowerCase();
      if (val === 'tab') return '\t';
      if (val === 'comma' || val === ',') return ',';
      if (val === 'semicolon' || val === ';') return ';';
      if (val === 'pipe' || val === '|') return '|';
      if (headerMatch[1].trim()) return headerMatch[1].trim();
    }

    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#')).slice(0, 10);
    if (lines.length === 0) return ';';

    const candidates = [';', '\t', '|', ','];
    let bestSep = ';';
    let maxConsistency = -1;

    for (const sep of candidates) {
      const counts = lines.map(l => this.parseDelimitedRow(l, sep).length);
      const isConsistent = counts.every(c => c === counts[0]);
      const avgCols = counts[0] || 0;
      if (isConsistent && avgCols > 1 && avgCols > maxConsistency) {
        maxConsistency = avgCols;
        bestSep = sep;
      }
    }

    return bestSep;
  }

  public parseDelimitedRow(line: string, separator: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuote = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuote = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuote = true;
        } else if (ch === separator) {
          cells.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    cells.push(current.trim());
    return cells;
  }

  public parseDelimitedRows(content: string, separator: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuote = false;

    for (let i = 0; i < content.length; i++) {
      const ch = content[i];

      if (inQuote) {
        if (ch === '"') {
          if (i + 1 < content.length && content[i + 1] === '"') {
            currentField += '"';
            i++;
          } else {
            inQuote = false;
          }
        } else {
          currentField += ch;
        }
      } else {
        if (ch === '"') {
          inQuote = true;
        } else if (ch === separator) {
          currentRow.push(currentField.trim());
          currentField = '';
        } else if (ch === '\r') {
          if (i + 1 < content.length && content[i + 1] === '\n') {
            i++;
          }
          currentRow.push(currentField.trim());
          if (currentRow.some(c => c.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentField = '';
        } else if (ch === '\n') {
          currentRow.push(currentField.trim());
          if (currentRow.some(c => c.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentField = '';
        } else {
          currentField += ch;
        }
      }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.some(c => c.length > 0)) {
        rows.push(currentRow);
      }
    }

    // Filtrar linhas de cabeçalho que começam com #
    return rows.filter(r => !(r.length === 1 && r[0].startsWith('#')) && !(r[0] && r[0].startsWith('#separator:')));
  }

  public parseAnkiDelimitedContent(content: string, fileName: string = ''): AnkiParseResult {
    const separator = this.detectAnkiSeparator(content);
    const rawRows = this.parseDelimitedRows(content, separator);

    let columnsCount = 0;
    for (const r of rawRows) {
      if (r.length > columnsCount) columnsCount = r.length;
    }

    // Normalizar todas as linhas para columnsCount
    for (const r of rawRows) {
      while (r.length < columnsCount) {
        r.push('');
      }
    }

    // Analisar cada coluna para determinar tipo provável e amostras
    const sampleRows = rawRows.slice(0, 15);
    const mappings: AnkiColumnMapping[] = [];

    let foundFirstId = false;
    let foundFirstText = false;
    let foundFirstImage = false;
    let foundFirstAudio = false;
    let extractedEpisodeName: string | undefined = undefined;

    for (let colIdx = 0; colIdx < columnsCount; colIdx++) {
      const samples = sampleRows.map(r => r[colIdx] || '').filter(v => v.trim().length > 0);
      const displaySamples = samples.slice(0, 3);

      let detectedType: AnkiColumnType = 'text';

      if (samples.length === 0) {
        detectedType = 'ignore';
      } else {
        // Testar ID / Tempo
        const idMatches = samples.filter(s => {
          return /-\s*\d{1,2}:\d{2}:\d{2}/.test(s) || /^\d{1,2}:\d{2}:\d{2}/.test(s);
        });

        const audioMatches = samples.filter(s => {
          return /\[sound:[^\]]+\]/i.test(s) || /\.(mp3|wav|ogg|opus|aac|flac|m4a)/i.test(s);
        });

        const imageMatches = samples.filter(s => {
          return /<img[^>]+src=/i.test(s) || /\.(jpg|jpeg|png|webp|gif|bmp)/i.test(s);
        });

        if (idMatches.length >= Math.ceil(samples.length * 0.5)) {
          detectedType = 'id';
          if (!extractedEpisodeName) {
            const firstIdSample = samples[0];
            const epMatch = firstIdSample.match(/^(.*?)\s*-\s*\d{1,2}:\d{2}:\d{2}/);
            if (epMatch && epMatch[1].trim()) {
              extractedEpisodeName = epMatch[1].trim();
            }
          }
        } else if (audioMatches.length >= Math.ceil(samples.length * 0.4)) {
          detectedType = 'audio';
        } else if (imageMatches.length >= Math.ceil(samples.length * 0.4)) {
          detectedType = 'image';
        } else {
          detectedType = 'text';
        }
      }

      // Regra 2.3: Por padrão apenas a primeira de cada tipo vem marcada
      let finalType: AnkiColumnType = 'ignore';
      let action: AnkiColumnAction = 'new_track';
      let targetTrackLabel = `Faixa ${colIdx + 1}`;

      if (detectedType === 'id' && !foundFirstId) {
        finalType = 'id';
        foundFirstId = true;
      } else if (detectedType === 'text' && !foundFirstText) {
        finalType = 'text';
        foundFirstText = true;
        // Detectar se contém caracteres japoneses (Hiragana, Katakana, Kanji)
        const hasJp = samples.some(s => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(s));
        targetTrackLabel = hasJp ? 'JP' : 'Sub 1';
      } else if (detectedType === 'image' && !foundFirstImage) {
        finalType = 'image';
        foundFirstImage = true;
        action = 'combine'; // anexa à faixa de texto principal
      } else if (detectedType === 'audio' && !foundFirstAudio) {
        finalType = 'audio';
        foundFirstAudio = true;
        action = 'combine'; // anexa à faixa de texto principal
      } else {
        finalType = 'ignore';
      }

      mappings.push({
        index: colIdx,
        sampleValues: displaySamples,
        type: finalType,
        action,
        targetTrackLabel,
        combineWithTrackIndex: 0
      });
    }

    return {
      fileName,
      separator,
      episodeName: extractedEpisodeName,
      totalRows: rawRows.length,
      columnsCount,
      rawRows,
      suggestedMappings: mappings
    };
  }

  public buildCuesFromAnkiImport(
    result: AnkiParseResult,
    mappings: AnkiColumnMapping[]
  ): { episodeName?: string; hasImportedId: boolean; tracks: { label: string; cues: SubtitleCue[] }[] } {
    const rawRows = result.rawRows;
    const idMapping = mappings.find(m => m.type === 'id');
    const idColIdx = idMapping ? idMapping.index : -1;
    const hasImportedId = idColIdx !== -1;

    // 1. Extrair os tempos de cada linha (startMs e endMs) e preservar o ID original selecionado
    const rowTimings: { startMs: number; endMs: number; rawId?: string }[] = [];

    for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
      const row = rawRows[rIdx];
      let startMs: number | null = null;
      let endMs: number | null = null;
      const rawId = idColIdx !== -1 ? (row[idColIdx] || '').trim() : '';

      // Tenta extrair timestamp do ID
      if (rawId) {
        const match = rawId.match(/(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/);
        if (match) {
          startMs = this.timeToMs(match[1]);
        }
      }

      // Tenta extrair timestamp de arquivo de áudio se disponível (ex: 0.00.01.000-0.00.03.500)
      for (const m of mappings) {
        if (m.type === 'audio' && row[m.index]) {
          const aText = row[m.index];
          const rangeMatch = aText.match(/(\d+)\.(\d{2})\.(\d{2})\.(\d{3})-(\d+)\.(\d{2})\.(\d{2})\.(\d{3})/);
          if (rangeMatch) {
            const sH = parseInt(rangeMatch[1], 10);
            const sM = parseInt(rangeMatch[2], 10);
            const sS = parseInt(rangeMatch[3], 10);
            const sMs = parseInt(rangeMatch[4], 10);
            const eH = parseInt(rangeMatch[5], 10);
            const eM = parseInt(rangeMatch[6], 10);
            const eS = parseInt(rangeMatch[7], 10);
            const eMs = parseInt(rangeMatch[8], 10);
            startMs = sH * 3600000 + sM * 60000 + sS * 1000 + sMs;
            endMs = eH * 3600000 + eM * 60000 + eS * 1000 + eMs;
            break;
          }
        }
      }

      if (startMs === null) {
        startMs = rIdx * 3000;
      }

      rowTimings.push({ startMs, endMs: endMs || 0, rawId: rawId || undefined });
    }

    // Calcular endMs relativo caso não tenha sido preenchido
    for (let rIdx = 0; rIdx < rowTimings.length; rIdx++) {
      if (!rowTimings[rIdx].endMs || rowTimings[rIdx].endMs <= rowTimings[rIdx].startMs) {
        if (rIdx + 1 < rowTimings.length) {
          const nextStart = rowTimings[rIdx + 1].startMs;
          if (nextStart > rowTimings[rIdx].startMs) {
            rowTimings[rIdx].endMs = Math.min(nextStart, rowTimings[rIdx].startMs + 7000);
          } else {
            rowTimings[rIdx].endMs = rowTimings[rIdx].startMs + 3000;
          }
        } else {
          rowTimings[rIdx].endMs = rowTimings[rIdx].startMs + 3000;
        }
      }
    }

    // 2. Identificar faixas a criar
    // Faixas são criadas para:
    // - Mappings com action === 'new_track' e type === 'text' (ou image/audio se usuário escolheu nova faixa)
    interface TargetTrackDef {
      label: string;
      primaryColIndex: number;
      combinedColIndices: number[];
    }

    const targetTracks: TargetTrackDef[] = [];

    // Primeiro mapeia as faixas primárias
    for (const m of mappings) {
      if (m.type !== 'ignore' && m.type !== 'id' && m.action === 'new_track') {
        targetTracks.push({
          label: m.targetTrackLabel || `Faixa ${m.index + 1}`,
          primaryColIndex: m.index,
          combinedColIndices: []
        });
      }
    }

    // Se nenhuma faixa foi criada com new_track, criar uma padrão para não perder dados
    if (targetTracks.length === 0) {
      const firstActive = mappings.find(m => m.type !== 'ignore' && m.type !== 'id') || mappings.find(m => m.type !== 'ignore');
      targetTracks.push({
        label: 'Sub 1',
        primaryColIndex: firstActive ? firstActive.index : 0,
        combinedColIndices: []
      });
    }

    // Mapeia colunas combinadas
    for (const m of mappings) {
      if (m.type !== 'ignore' && m.type !== 'id' && m.action === 'combine') {
        const targetIdx = Number(m.combineWithTrackIndex);
        const targetTrack = targetTracks.find(t => t.primaryColIndex === targetIdx) || targetTracks[0];
        if (targetTrack && !targetTrack.combinedColIndices.includes(m.index)) {
          targetTrack.combinedColIndices.push(m.index);
        }
      }
    }

    // 3. Gerar as faixas e cues
    const createdTracks: { label: string; cues: SubtitleCue[] }[] = [];

    for (let tIdx = 0; tIdx < targetTracks.length; tIdx++) {
      const def = targetTracks[tIdx];
      const cues: SubtitleCue[] = [];

      for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
        const row = rawRows[rIdx];
        const timing = rowTimings[rIdx];

        let text = row[def.primaryColIndex] || '';
        let audioFileName: string | undefined = undefined;
        let imageFileName: string | undefined = undefined;

        // Limpar tag sound se estiver no texto e extrair audioFileName
        const soundMatch = text.match(/\[sound:([^\]]+)\]/i);
        if (soundMatch) {
          audioFileName = soundMatch[1];
          text = text.replace(/\[sound:[^\]]+\]/gi, '').trim();
        }

        // Limpar tag img se estiver no texto e extrair imageFileName
        const imgMatch = text.match(/<img[^>]+src=["']?([^"'>\s]+)["']?[^>]*>/i);
        if (imgMatch) {
          imageFileName = imgMatch[1];
          text = text.replace(/<img[^>]*>/gi, '').trim();
        }

        // Processar colunas combinadas
        for (const cIdx of def.combinedColIndices) {
          const combVal = row[cIdx] || '';
          const combMapping = mappings.find(m => m.index === cIdx);

          if (combMapping?.type === 'audio') {
            const sm = combVal.match(/\[sound:([^\]]+)\]/i);
            audioFileName = sm ? sm[1] : (combVal.trim() || audioFileName);
          } else if (combMapping?.type === 'image') {
            const im = combVal.match(/<img[^>]+src=["']?([^"'>\s]+)["']?[^>]*>/i);
            imageFileName = im ? im[1] : (combVal.trim() || imageFileName);
          } else if (combMapping?.type === 'text') {
            if (combVal.trim()) {
              text = text ? `${text}<br>${combVal.trim()}` : combVal.trim();
            }
          }
        }

        cues.push({
          id: `cue_anki_${tIdx + 1}_${rIdx + 1}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          originalIndex: rIdx + 1,
          startMs: timing.startMs,
          endMs: timing.endMs,
          origStartMs: timing.startMs,
          origEndMs: timing.endMs,
          text: text.trim(),
          audioFileName,
          imageFileName,
          importedId: timing.rawId
        });
      }

      createdTracks.push({
        label: def.label,
        cues
      });
    }

    return {
      episodeName: result.episodeName,
      hasImportedId,
      tracks: createdTracks
    };
  }
}

