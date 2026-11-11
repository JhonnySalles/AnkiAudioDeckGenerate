import { Injectable } from '@angular/core';
import { SubtitleTrack, AlignedRow, AlignedCell, SubtitleCue } from '../types/subtitle-project';

@Injectable({
  providedIn: 'root'
})
export class SubtitleAlignerService {

  /**
   * Alinha automaticamente as faixas secundárias em relação à faixa 1 (Base).
   * @param tracks Lista de faixas carregadas
   * @param toleranceMs Tolerância máxima em ms para vincular falas próximas (padrão: 500ms)
   */
  public autoAlignTracks(tracks: SubtitleTrack[], toleranceMs: number = 500): AlignedRow[] {
    if (!tracks || tracks.length === 0) return [];

    const baseTrack = tracks[0];
    const otherTracks = tracks.slice(1);

    const rows: AlignedRow[] = [];

    // Cada cue da faixa base gera uma linha inicial
    baseTrack.cues.forEach((baseCue: SubtitleCue, idx: number) => {
      const cells: Record<string, AlignedCell | null> = {
        [baseTrack.id]: {
          trackId: baseTrack.id,
          cueIds: [baseCue.id],
          startMs: baseCue.startMs,
          endMs: baseCue.endMs,
          text: baseCue.text
        }
      };

      // Inicializa as outras colunas como null
      otherTracks.forEach(t => {
        cells[t.id] = null;
      });

      rows.push({
        id: `row_${idx + 1}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        index: idx + 1,
        cells,
        excluded: false
      });
    });

    // Mapeia cues de cada outra faixa buscando a linha com melhor sobreposição temporal
    otherTracks.forEach(track => {
      const trackOffset = track.offsetMs || 0;

      track.cues.forEach((cue: SubtitleCue) => {
        const cueStart = cue.startMs + trackOffset;
        const cueEnd = cue.endMs + trackOffset;

        let bestRowIndex = -1;
        let maxOverlap = 0;
        let closestDist = Infinity;

        for (let r = 0; r < rows.length; r++) {
          const baseCell = rows[r].cells[baseTrack.id];
          if (!baseCell) continue;

          const baseStart = baseCell.startMs + (baseTrack.offsetMs || 0);
          const baseEnd = baseCell.endMs + (baseTrack.offsetMs || 0);

          const overlapStart = Math.max(cueStart, baseStart);
          const overlapEnd = Math.min(cueEnd, baseEnd);
          const overlap = overlapEnd - overlapStart;

          if (overlap > maxOverlap) {
            maxOverlap = overlap;
            bestRowIndex = r;
          }

          // Se não há sobreposição estrita, calcula proximidade com base na tolerância
          if (maxOverlap <= 0) {
            const dist = Math.min(
              Math.abs(cueStart - baseStart),
              Math.abs(cueEnd - baseEnd),
              Math.abs((cueStart + cueEnd) / 2 - (baseStart + baseEnd) / 2)
            );
            if (dist <= toleranceMs && dist < closestDist) {
              closestDist = dist;
              bestRowIndex = r;
            }
          }
        }

        if (bestRowIndex !== -1) {
          const currentCell = rows[bestRowIndex].cells[track.id];

          if (!currentCell) {
            rows[bestRowIndex].cells[track.id] = {
              trackId: track.id,
              cueIds: [cue.id],
              startMs: cue.startMs,
              endMs: cue.endMs,
              text: cue.text
            };
          } else {
            // Concatena na célula existente se múltiplos cues caírem na mesma fala
            currentCell.cueIds.push(cue.id);
            currentCell.startMs = Math.min(currentCell.startMs, cue.startMs);
            currentCell.endMs = Math.max(currentCell.endMs, cue.endMs);
            currentCell.text += '\n' + cue.text;
          }
        }
      });
    });

    return rows;
  }

  /**
   * Desloca (shift) as células de uma coluna a partir de uma dada linha para baixo (+1) ou para cima (-1)
   */
  public shiftColumn(rows: AlignedRow[], trackId: string, fromIndex: number, direction: 'down' | 'up'): AlignedRow[] {
    const updated = [...rows];
    if (direction === 'down') {
      // Abre espaço na linha fromIndex empurrando as de baixo
      let prevCell: AlignedCell | null = null;
      for (let i = fromIndex; i < updated.length; i++) {
        const current = updated[i].cells[trackId] || null;
        updated[i].cells = { ...updated[i].cells, [trackId]: prevCell };
        prevCell = current;
      }
      // Se sobrou uma célula no final, pode criar uma nova linha órfã ou descartar se vazia
      if (prevCell) {
        const newRow: AlignedRow = {
          id: `row_extra_${Date.now()}`,
          index: updated.length + 1,
          cells: { [trackId]: prevCell },
          excluded: false
        };
        updated.push(newRow);
      }
    } else {
      // Puxa as células para cima a partir de fromIndex
      for (let i = fromIndex; i < updated.length - 1; i++) {
        updated[i].cells = { ...updated[i].cells, [trackId]: updated[i + 1].cells[trackId] || null };
      }
      updated[updated.length - 1].cells = { ...updated[updated.length - 1].cells, [trackId]: null };
    }
    return updated;
  }

  /**
   * Move uma célula individual de uma faixa para cima ou para baixo
   */
  public moveCell(rows: AlignedRow[], trackId: string, rowIndex: number, direction: 'up' | 'down'): AlignedRow[] {
    const targetIndex = direction === 'up' ? rowIndex - 1 : rowIndex + 1;
    if (targetIndex < 0 || targetIndex >= rows.length) return rows;

    const updated = [...rows];
    const sourceCell = updated[rowIndex].cells[trackId] || null;
    const targetCell = updated[targetIndex].cells[trackId] || null;

    updated[rowIndex].cells = { ...updated[rowIndex].cells, [trackId]: targetCell };
    updated[targetIndex].cells = { ...updated[targetIndex].cells, [trackId]: sourceCell };

    return updated;
  }

  /**
   * Mescla a célula atual de uma faixa com a da linha de baixo
   */
  public mergeCellWithNext(rows: AlignedRow[], trackId: string, rowIndex: number): AlignedRow[] {
    if (rowIndex >= rows.length - 1) return rows;
    const updated = [...rows];
    const current = updated[rowIndex].cells[trackId];
    const next = updated[rowIndex + 1].cells[trackId];

    if (!current && !next) return rows;
    if (!current) {
      updated[rowIndex].cells = { ...updated[rowIndex].cells, [trackId]: next };
      updated[rowIndex + 1].cells = { ...updated[rowIndex + 1].cells, [trackId]: null };
      return updated;
    }
    if (!next) return rows;

    const merged: AlignedCell = {
      trackId,
      cueIds: [...current.cueIds, ...next.cueIds],
      startMs: Math.min(current.startMs, next.startMs),
      endMs: Math.max(current.endMs, next.endMs),
      text: `${current.text}\n${next.text}`
    };

    updated[rowIndex].cells = { ...updated[rowIndex].cells, [trackId]: merged };
    updated[rowIndex + 1].cells = { ...updated[rowIndex + 1].cells, [trackId]: null };

    return updated;
  }

  /**
   * Mescla a célula atual de uma faixa com a da linha de cima (anterior)
   */
  public mergeCellWithPrevious(rows: AlignedRow[], trackId: string, rowIndex: number): AlignedRow[] {
    if (rowIndex <= 0) return rows;
    const updated = [...rows];
    const prev = updated[rowIndex - 1].cells[trackId];
    const current = updated[rowIndex].cells[trackId];

    if (!prev && !current) return rows;
    if (!prev) {
      updated[rowIndex - 1].cells = { ...updated[rowIndex - 1].cells, [trackId]: current };
      updated[rowIndex].cells = { ...updated[rowIndex].cells, [trackId]: null };
      return updated;
    }
    if (!current) return rows;

    const merged: AlignedCell = {
      trackId,
      cueIds: [...prev.cueIds, ...current.cueIds],
      startMs: Math.min(prev.startMs, current.startMs),
      endMs: Math.max(prev.endMs, current.endMs),
      text: `${prev.text}\n${current.text}`
    };

    updated[rowIndex - 1].cells = { ...updated[rowIndex - 1].cells, [trackId]: merged };
    updated[rowIndex].cells = { ...updated[rowIndex].cells, [trackId]: null };

    return updated;
  }

  /**
   * Desvincula uma célula da linha atual, inserindo uma nova linha autônoma logo abaixo
   */
  public unlinkCell(rows: AlignedRow[], trackId: string, rowIndex: number): AlignedRow[] {
    const updated = [...rows];
    const cell = updated[rowIndex].cells[trackId];
    if (!cell) return rows;

    // Remove da linha atual
    updated[rowIndex].cells = { ...updated[rowIndex].cells, [trackId]: null };

    // Cria nova linha apenas com essa célula
    const newRow: AlignedRow = {
      id: `row_unlinked_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      index: updated.length + 1,
      cells: { [trackId]: cell },
      excluded: false
    };

    updated.splice(rowIndex + 1, 0, newRow);

    // Reindexar linhas
    updated.forEach((r, idx) => (r.index = idx + 1));
    return updated;
  }

  /**
   * Limpa/esvazia o conteúdo da célula de uma faixa na linha especificada
   */
  public clearCell(rows: AlignedRow[], trackId: string, rowIndex: number): AlignedRow[] {
    if (rowIndex < 0 || rowIndex >= rows.length) return rows;
    const updated = [...rows];
    updated[rowIndex].cells = { ...updated[rowIndex].cells, [trackId]: null };
    return updated;
  }

  /**
   * Aplica um deslocamento temporal (em ms) em todas as células de uma faixa,
   * seja na faixa inteira ou a partir da linha informada em diante.
   */
  public applyTimeShift(
    rows: AlignedRow[],
    trackId: string,
    fromRowIndex: number,
    deltaMs: number,
    scope: 'from_row' | 'all' = 'from_row'
  ): AlignedRow[] {
    if (!deltaMs || deltaMs === 0) return rows;
    const updated = [...rows];
    const startIdx = scope === 'all' ? 0 : Math.max(0, fromRowIndex);

    for (let i = startIdx; i < updated.length; i++) {
      const cell = updated[i].cells[trackId];
      if (cell) {
        const newStart = Math.max(0, cell.startMs + deltaMs);
        const newEnd = Math.max(newStart + 100, cell.endMs + deltaMs);
        updated[i].cells = {
          ...updated[i].cells,
          [trackId]: {
            ...cell,
            startMs: newStart,
            endMs: newEnd
          }
        };
      }
    }

    return updated;
  }
}

