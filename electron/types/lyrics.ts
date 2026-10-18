export interface LyricLine {
  index: number;
  startTime: string; // Ex: "00:15.300"
  endTime: string;   // Ex: "00:18.450"
  startMs: number | null;
  endMs: number | null;
  original: string;   // Frente
  translation: string;// Verso
  selected?: boolean;
}

export interface LyricsExtractionResult {
  source: 'lrclib' | 'letras' | 'vagalume' | 'lrc' | 'srt' | 'vtt' | 'html' | 'text';
  artist?: string;
  title?: string;
  durationSec?: number;
  lines: LyricLine[];
  warnings: string[];
}

export interface LrclibTrack {
  id: number;
  name: string;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}
