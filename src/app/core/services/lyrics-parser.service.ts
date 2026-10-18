import { Injectable } from '@angular/core';

export interface ParsedLyricLine {
  index: number;
  startTime: string; // "00:15.300"
  endTime: string;   // "00:18.450"
  startMs: number | null;
  endMs: number | null;
  original: string;   // Frente
  translation: string;// Verso
  audioFileName?: string;
  tags?: string[];
  selected?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class LyricsParserService {

  // Converte "mm:ss.xx" ou "hh:mm:ss,xxx" em milissegundos
  public timeToMs(timeStr: string): number | null {
    if (!timeStr) return null;
    const clean = timeStr.trim().replace(',', '.');

    // Formato mm:ss.xx ou mm:ss.xxx
    const minSecMatch = clean.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (minSecMatch) {
      const minutes = parseInt(minSecMatch[1], 10);
      const seconds = parseInt(minSecMatch[2], 10);
      let ms = 0;
      if (minSecMatch[3]) {
        const msStr = minSecMatch[3].padEnd(3, '0').slice(0, 3);
        ms = parseInt(msStr, 10);
      }
      return minutes * 60 * 1000 + seconds * 1000 + ms;
    }

    // Formato hh:mm:ss.xxx
    const hourMatch = clean.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (hourMatch) {
      const hours = parseInt(hourMatch[1], 10);
      const minutes = parseInt(hourMatch[2], 10);
      const seconds = parseInt(hourMatch[3], 10);
      let ms = 0;
      if (hourMatch[4]) {
        const msStr = hourMatch[4].padEnd(3, '0').slice(0, 3);
        ms = parseInt(msStr, 10);
      }
      return hours * 3600 * 1000 + minutes * 60 * 1000 + seconds * 1000 + ms;
    }

    return null;
  }

  // Converte milissegundos em "mm:ss.mmm" (ex: 00:20.780)
  public msToTimeStr(ms: number | null): string {
    if (ms === null || isNaN(ms) || ms < 0) return '';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor(ms % 1000);

    const mStr = minutes.toString().padStart(2, '0');
    const sStr = seconds.toString().padStart(2, '0');
    const msStr = milliseconds.toString().padStart(3, '0');

    return `${mStr}:${sStr}.${msStr}`;
  }

  // Parser de LRC padrão: [00:17.12] I feel your breath
  public parseLrc(lrcContent: string): ParsedLyricLine[] {
    const lines = lrcContent.split(/\r?\n/);
    const tempItems: { ms: number; text: string }[] = [];

    const lrcRegex = /\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Pular tags de cabeçalho como [ar:Artist], [ti:Title], etc.
      if (/^\[(ar|ti|al|by|offset|length):/i.test(line)) {
        continue;
      }

      // Encontrar todos os timestamps da linha
      const matches = Array.from(line.matchAll(lrcRegex));
      if (matches.length > 0) {
        const text = line.replace(lrcRegex, '').trim();
        // Não incluir linhas vazias ou apenas instrumentais sem texto
        for (const m of matches) {
          const ms = this.timeToMs(m[1]);
          if (ms !== null) {
            tempItems.push({ ms, text });
          }
        }
      }
    }

    // Ordenar por tempo
    tempItems.sort((a, b) => a.ms - b.ms);

    // Calcular endMs com base no próximo item
    const result: ParsedLyricLine[] = [];
    for (let i = 0; i < tempItems.length; i++) {
      const current = tempItems[i];
      if (!current.text) continue; // Pular marcações sem texto

      let endMs: number;
      if (i + 1 < tempItems.length) {
        endMs = tempItems[i + 1].ms;
      } else {
        // Último item: adicionar 4 segundos por padrão
        endMs = current.ms + 4000;
      }

      result.push({
        index: result.length + 1,
        startTime: this.msToTimeStr(current.ms),
        endTime: this.msToTimeStr(endMs),
        startMs: current.ms,
        endMs: endMs,
        original: current.text,
        translation: '',
        selected: true
      });
    }

    return result;
  }

  // Parser de Legendas SRT ou VTT
  public parseSrtOrVtt(subtitleContent: string): ParsedLyricLine[] {
    const cleanContent = subtitleContent.replace(/^WEBVTT.*(\r?\n)+/i, '');
    const blocks = cleanContent.split(/(?:\r?\n){2,}/);
    const result: ParsedLyricLine[] = [];

    const timeRegex = /(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)/;

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

        // O texto são as linhas seguintes
        const textLines = lines.slice(timeLineIdx + 1);
        const rawText = textLines.join(' ').replace(/<[^>]+>/g, '').trim();

        if (rawText && startMs !== null) {
          result.push({
            index: result.length + 1,
            startTime: this.msToTimeStr(startMs),
            endTime: this.msToTimeStr(endMs || startMs + 4000),
            startMs: startMs,
            endMs: endMs,
            original: rawText,
            translation: '',
            selected: true
          });
        }
      }
    }

    return result;
  }

  // Parser de HTML bilíngue (Letras.mus.br, Vagalume ou genérico)
  public parseBilingualHtml(html: string): { originals: string[]; translations: string[]; title?: string; artist?: string } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    let title: string | undefined;
    let artist: string | undefined;

    // Tentar obter título e artista da página
    const h1 = doc.querySelector('h1');
    if (h1) {
      title = h1.textContent?.trim();
    }
    const h2 = doc.querySelector('h2');
    if (h2) {
      artist = h2.textContent?.trim();
    }

    const originals: string[] = [];
    const translations: string[] = [];

    // 1. Letras.mus.br (/traducao.html)
    // Na estrutura do Letras.mus.br, há parágrafos originais e traduzidos sincronizados
    const letraOriginalEl = doc.querySelector('.lyric-original, .cnt-letra-original, .lyric-cnt--original');
    const letraTraducaoEl = doc.querySelector('.lyric-translate, .cnt-letra-traducao, .lyric-cnt--traducao');

    if (letraOriginalEl && letraTraducaoEl) {
      const origPs = Array.from(letraOriginalEl.querySelectorAll('p'));
      const tradPs = Array.from(letraTraducaoEl.querySelectorAll('p'));

      for (let i = 0; i < Math.max(origPs.length, tradPs.length); i++) {
        const origLines = (origPs[i]?.innerHTML || '').split(/<br\s*\/?>/i).map(l => this.cleanHtmlText(l)).filter(Boolean);
        const tradLines = (tradPs[i]?.innerHTML || '').split(/<br\s*\/?>/i).map(l => this.cleanHtmlText(l)).filter(Boolean);

        for (let j = 0; j < Math.max(origLines.length, tradLines.length); j++) {
          if (origLines[j]) originals.push(origLines[j]);
          if (tradLines[j]) translations.push(tradLines[j]);
        }
      }

      if (originals.length > 0) {
        return { originals, translations, title, artist };
      }
    }

    // 2. Vagalume (-traducao.html)
    // No Vagalume tradicionalmente há colunas com #orig e #trad
    const vagalumeOrig = doc.querySelector('#orig, .orig');
    const vagalumeTrad = doc.querySelector('#trad, .trad');

    if (vagalumeOrig && vagalumeTrad) {
      const origPs = Array.from(vagalumeOrig.querySelectorAll('p'));
      const tradPs = Array.from(vagalumeTrad.querySelectorAll('p'));

      for (let i = 0; i < Math.max(origPs.length, tradPs.length); i++) {
        const origLines = (origPs[i]?.innerHTML || '').split(/<br\s*\/?>/i).map(l => this.cleanHtmlText(l)).filter(Boolean);
        const tradLines = (tradPs[i]?.innerHTML || '').split(/<br\s*\/?>/i).map(l => this.cleanHtmlText(l)).filter(Boolean);

        for (let j = 0; j < Math.max(origLines.length, tradLines.length); j++) {
          if (origLines[j]) originals.push(origLines[j]);
          if (tradLines[j]) translations.push(tradLines[j]);
        }
      }

      if (originals.length > 0) {
        return { originals, translations, title, artist };
      }
    }

    // 3. Fallback genérico: buscar blocos de texto ou parágrafos
    const allParagraphs = Array.from(doc.querySelectorAll('article p, .lyric p, .letra p, main p'));
    for (const p of allParagraphs) {
      const lines = p.innerHTML.split(/<br\s*\/?>/i).map(l => this.cleanHtmlText(l)).filter(Boolean);
      for (const line of lines) {
        originals.push(line);
      }
    }

    return { originals, translations, title, artist };
  }

  // Alinhador inteligente: combina linhas sincronizadas (tempo + original) com traduções
  public alignLyrics(timingLines: ParsedLyricLine[], translations: string[]): ParsedLyricLine[] {
    if (!translations || translations.length === 0) {
      return timingLines;
    }

    // Se o número de linhas for aproximadamente igual, faz pareamento direto
    const aligned: ParsedLyricLine[] = [];

    for (let i = 0; i < timingLines.length; i++) {
      const line = { ...timingLines[i] };
      if (i < translations.length) {
        line.translation = translations[i].trim();
      } else {
        line.translation = '';
      }
      aligned.push(line);
    }

    return aligned;
  }

  // Parser de Texto Delimitado com suporte a [ini-fim] e separadores customizados
  public parseDelimitedText(
    content: string,
    options?: {
      delimiter?: 'auto' | '\t' | '|' | ';' | '-' | string;
      defaultDurationMs?: number;
    }
  ): ParsedLyricLine[] {
    const lines = content.split(/\r?\n/);
    const result: ParsedLyricLine[] = [];

    // Regex para [00:15.30] ou [00:15.30-00:16.30] ou [00:15.30 - 00:16.30]
    const bracketedTimeRegex = /^\[\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)(?:\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?))?\s*\]/;

    // Regex para timestamp sem colchetes no início (ex: 00:15.30-00:16.30|Texto)
    const unbracketedTimeRegex = /^(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)(?:\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?))(?:\s*([|\t;]|-))\s*/;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      let startTimeStr: string | undefined = undefined;
      let endTimeStr: string | undefined = undefined;
      let rest = line;

      // 1. Verificar timestamp entre colchetes
      const bracketMatch = line.match(bracketedTimeRegex);
      if (bracketMatch) {
        startTimeStr = bracketMatch[1];
        endTimeStr = bracketMatch[2];
        rest = line.substring(bracketMatch[0].length).trim();
      } else {
        // 2. Verificar timestamp sem colchetes com delimitador imediato
        const unbracketMatch = line.match(unbracketedTimeRegex);
        if (unbracketMatch) {
          startTimeStr = unbracketMatch[1];
          endTimeStr = unbracketMatch[2];
          const sep = unbracketMatch[3] || '';
          rest = sep + line.substring(unbracketMatch[0].length).trim();
        }
      }

      // 3. Determinar o separador
      let selectedDelimiter: string | null = null;
      const userDelimiter = options?.delimiter || 'auto';

      if (userDelimiter !== 'auto' && userDelimiter.length > 0) {
        selectedDelimiter = userDelimiter;
        if (rest.startsWith(selectedDelimiter)) {
          rest = rest.substring(selectedDelimiter.length).trim();
        }
      } else {
        // Auto-detecção inteligente
        if (rest.startsWith('|')) {
          selectedDelimiter = '|';
          rest = rest.substring(1).trim();
        } else if (rest.startsWith('\t')) {
          selectedDelimiter = '\t';
          rest = rest.substring(1).trim();
        } else if (rest.startsWith(';')) {
          selectedDelimiter = ';';
          rest = rest.substring(1).trim();
        } else if (rest.startsWith('-')) {
          selectedDelimiter = '-';
          rest = rest.substring(1).trim();
        } else if (rest.includes('\t')) {
          selectedDelimiter = '\t';
        } else if (rest.includes('|')) {
          selectedDelimiter = '|';
        } else if (rest.includes(';')) {
          selectedDelimiter = ';';
        } else if (rest.includes(' - ')) {
          selectedDelimiter = ' - ';
        }
      }

      // 4. Dividir as colunas
      const parts = selectedDelimiter
        ? rest.split(selectedDelimiter).map(p => p.trim())
        : [rest];

      const original = (parts[0] || '').trim();
      if (!original) continue;

      const translation = (parts[1] || '').trim();
      let audioFileName: string | undefined = undefined;
      let tags: string[] | undefined = undefined;

      // Suporte a coluna de áudio e tags adicionais (retrocompatibilidade Anki TSV)
      if (parts[2]) {
        const soundPart = parts[2].trim();
        const soundMatch = soundPart.match(/\[sound:(.*?)\]/);
        if (soundMatch && soundMatch[1]) {
          audioFileName = soundMatch[1].trim();
        } else if (soundPart.match(/\.(mp3|wav|ogg|m4a)$/i)) {
          audioFileName = soundPart;
        }
      }

      if (parts[3] && parts[3].trim()) {
        tags = parts[3].trim().split(/\s+/).filter(Boolean);
      }

      const startMs = startTimeStr ? this.timeToMs(startTimeStr) : null;
      const endMs = endTimeStr ? this.timeToMs(endTimeStr) : null;

      result.push({
        index: result.length + 1,
        startTime: this.msToTimeStr(startMs),
        endTime: this.msToTimeStr(endMs),
        startMs,
        endMs,
        original,
        translation,
        audioFileName,
        tags,
        selected: true
      });
    }

    // 5. Preencher tempo final ausente quando há tempo inicial
    const defaultDuration = options?.defaultDurationMs || 4000;
    for (let i = 0; i < result.length; i++) {
      const cur = result[i];
      if (cur.startMs !== null && cur.endMs === null) {
        if (i + 1 < result.length && result[i + 1].startMs !== null && (result[i + 1].startMs as number) > cur.startMs) {
          cur.endMs = result[i + 1].startMs;
        } else {
          cur.endMs = cur.startMs + defaultDuration;
        }
        cur.endTime = this.msToTimeStr(cur.endMs);
      }
    }

    return result;
  }

  private cleanHtmlText(htmlSnippet: string): string {
    const temp = document.createElement('div');
    temp.innerHTML = htmlSnippet;
    return (temp.textContent || temp.innerText || '').trim();
  }
}
