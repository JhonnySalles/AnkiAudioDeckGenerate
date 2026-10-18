import { net } from 'electron';
import { LrclibTrack } from '../types/lyrics';

export class LyricsService {
  private static instance: LyricsService;

  public static getInstance(): LyricsService {
    if (!LyricsService.instance) {
      LyricsService.instance = new LyricsService();
    }
    return LyricsService.instance;
  }

  public async fetchUrl(targetUrl: string): Promise<string> {
    const response = await net.fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    if (!response.ok) {
      throw new Error(`Falha ao acessar URL (HTTP ${response.status}: ${response.statusText})`);
    }

    return await response.text();
  }

  public async searchLrclib(params: { track?: string; artist?: string; q?: string }): Promise<LrclibTrack[]> {
    const url = new URL('https://lrclib.net/api/search');
    if (params.q) {
      url.searchParams.set('q', params.q);
    }
    if (params.track) {
      url.searchParams.set('track_name', params.track);
    }
    if (params.artist) {
      url.searchParams.set('artist_name', params.artist);
    }

    const response = await net.fetch(url.toString(), {
      headers: {
        'User-Agent': 'AnkiAudioDeckCreator/1.0.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Erro na busca do LRCLIB (HTTP ${response.status})`);
    }

    return (await response.json()) as LrclibTrack[];
  }

  public async getLrclib(artist: string, track: string): Promise<LrclibTrack | null> {
    const url = new URL('https://lrclib.net/api/get');
    url.searchParams.set('artist_name', artist);
    url.searchParams.set('track_name', track);

    try {
      const response = await net.fetch(url.toString(), {
        headers: {
          'User-Agent': 'AnkiAudioDeckCreator/1.0.0'
        }
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as LrclibTrack;
    } catch {
      return null;
    }
  }
}
