import { Injectable } from '@angular/core';
import { SubtitleCue } from '../types/subtitle-project';

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

  public parseSubtitle(content: string, fileName: string = ''): SubtitleCue[] {
    const ext = fileName.toLowerCase();
    if (ext.endsWith('.ass') || ext.endsWith('.ssa') || content.includes('[Events]') || content.includes('Dialogue:')) {
      return this.parseAss(content);
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
    return this.parseSrt(content);
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
  public parseSrt(content: string): SubtitleCue[] {
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
        const rawText = textLines.join('\n').replace(/<[^>]+>/g, '').trim();

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

  // Parser de ASS/SSA
  public parseAss(content: string): SubtitleCue[] {
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
          const style = values[styleIdx] || '';
          let text = values[textIdx] || '';

          // Filtrar estilos comuns de Signs ou Abertura se necessário
          if (/^(sign|title|note)/i.test(style)) {
            // Pode ignorar se for somente placa, mas mantemos como padrão
          }

          // Limpar tags de estilo {\...} e quebras \N
          text = text
            .replace(/\{[^}]+\}/g, '')
            .replace(/\\N/gi, '\n')
            .replace(/\\n/gi, ' ')
            .replace(/\\h/gi, ' ')
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
}

