import { Injectable } from '@angular/core';
import { SubtitleTrack, AlignedRow, AlignedCell, SubtitleCue } from '../types/subtitle-project';

export interface AutoAlignOptions {
  toleranceMs?: number;
  groupByCounterpart?: boolean;
  joinSentences?: boolean;
  excludeNoCounterpart?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class SubtitleAlignerService {

  /**
   * Alinha automaticamente as faixas secundárias em relação à faixa 1 (Base).
   * Suporta agrupamento N:1 pelo par secundário (padrão subs2srs), junção por continuação e filtragem.
   * @param tracks Lista de faixas carregadas
   * @param toleranceOrOptions Tolerância máxima em ms ou objeto de opções AutoAlignOptions
   * @param legacyOptions Opções adicionais se tolerance for passado como número
   */
  public autoAlignTracks(
    tracks: SubtitleTrack[],
    toleranceOrOptions: number | AutoAlignOptions = 500,
    legacyOptions?: AutoAlignOptions
  ): AlignedRow[] {
    if (!tracks || tracks.length === 0) return [];

    let options: AutoAlignOptions = {};
    if (typeof toleranceOrOptions === 'number') {
      options = { toleranceMs: toleranceOrOptions, ...legacyOptions };
    } else if (toleranceOrOptions && typeof toleranceOrOptions === 'object') {
      options = toleranceOrOptions;
    }

    const tolerance = options.toleranceMs ?? 500;
    const groupByCounterpart = options.groupByCounterpart !== false; // Padrão subs2srs: true
    const joinSentences = options.joinSentences !== false; // Padrão subs2srs: true
    const excludeNoCounterpart = options.excludeNoCounterpart === true;

    const baseTrack = tracks[0];
    const otherTracks = tracks.slice(1);

    // Clona as falas da faixa base
    let baseCues: Array<{
      id: string;
      originalIndex: number;
      startMs: number;
      endMs: number;
      origStartMs: number;
      origEndMs: number;
      text: string;
      importedId?: string;
      cueIds: string[];
    }> = baseTrack.cues.map(c => ({
      ...c,
      cueIds: [c.id]
    }));

    if (baseCues.length === 0) return [];

    // Etapa 1: Junção por continuação de pontuação (subs2srs: default_join_sentences_subs1 = True)
    if (joinSentences && baseCues.length > 1) {
      const joined: typeof baseCues = [];
      let current = { ...baseCues[0], cueIds: [...baseCues[0].cueIds] };

      for (let i = 1; i < baseCues.length; i++) {
        const next = baseCues[i];
        const endsWithContinuation = /[,、→…]$|\.{3}$/.test(current.text.trim());
        const gap = next.startMs - current.endMs;

        // Nunca mesclar linhas com ID importado distinto para manter correspondência 1:1 com o Anki
        const hasImported = Boolean(current.importedId || next.importedId);

        // Se termina com vírgula ou pontuação de continuação e a próxima começa em até 1200ms
        if (!hasImported && endsWithContinuation && gap >= -500 && gap <= 1200) {
          current.endMs = Math.max(current.endMs, next.endMs);
          current.origEndMs = Math.max(current.origEndMs, next.origEndMs);
          current.text = `${current.text} ${next.text}`;
          current.cueIds.push(...next.cueIds);
        } else {
          joined.push(current);
          current = { ...next, cueIds: [...next.cueIds] };
        }
      }
      joined.push(current);
      baseCues = joined;
    }

    // Etapa 2: Agrupamento N:1 pela legenda secundária (Subs2 / Counterpart)
    // Quando múltiplas falas consecutivas da base correspondem à mesma frase da legenda traduzida
    if (groupByCounterpart && otherTracks.length > 0) {
      const cpTrack = otherTracks[0];
      const cpOffset = cpTrack.offsetMs || 0;
      const baseOffset = baseTrack.offsetMs || 0;

      const findBestCounterpartCueId = (bCue: typeof baseCues[0]): string | null => {
        const bStart = bCue.startMs + baseOffset;
        const bEnd = bCue.endMs + baseOffset;
        let bestCpId: string | null = null;
        let maxOverlap = 0;

        for (const cp of cpTrack.cues) {
          const cpStart = cp.startMs + cpOffset;
          const cpEnd = cp.endMs + cpOffset;

          const overlapStart = Math.max(bStart, cpStart);
          const overlapEnd = Math.min(bEnd, cpEnd);
          const overlap = overlapEnd - overlapStart;

          if (overlap > maxOverlap) {
            maxOverlap = overlap;
            bestCpId = cp.id;
          }
        }

        // Se houve sobreposição real substancial (>= 80ms)
        if (maxOverlap >= 80) {
          return bestCpId;
        }

        // Se não houve sobreposição estrita, verificar ponto médio
        const bMid = (bStart + bEnd) / 2;
        for (const cp of cpTrack.cues) {
          const cpStart = cp.startMs + cpOffset;
          const cpEnd = cp.endMs + cpOffset;
          if (bMid >= cpStart - 250 && bMid <= cpEnd + 250) {
            return cp.id;
          }
        }

        return null;
      };

      const groupedBaseCues: typeof baseCues = [];
      let curGroup = { ...baseCues[0], cueIds: [...baseCues[0].cueIds] };
      let curCpId = findBestCounterpartCueId(baseCues[0]);

      for (let i = 1; i < baseCues.length; i++) {
        const nextCue = baseCues[i];
        const nextCpId = findBestCounterpartCueId(nextCue);
        const gap = nextCue.startMs - curGroup.endMs;

        // Se ambos pertencem à mesma cue da legenda secundária e o intervalo não é gigantesco (<= 2500ms)
        const hasImported = Boolean(curGroup.importedId || nextCue.importedId);
        if (!hasImported && curCpId !== null && nextCpId !== null && curCpId === nextCpId && gap <= 2500) {
          curGroup.endMs = Math.max(curGroup.endMs, nextCue.endMs);
          curGroup.origEndMs = Math.max(curGroup.origEndMs, nextCue.origEndMs);
          curGroup.text = `${curGroup.text} ${nextCue.text}`;
          curGroup.cueIds.push(...nextCue.cueIds);
        } else {
          groupedBaseCues.push(curGroup);
          curGroup = { ...nextCue, cueIds: [...nextCue.cueIds] };
          curCpId = nextCpId;
        }
      }
      groupedBaseCues.push(curGroup);
      baseCues = groupedBaseCues;
    }

    // Etapa 3: Criar linhas iniciais a partir da base (já agrupada)
    const rows: AlignedRow[] = [];
    baseCues.forEach((baseCue, idx) => {
      const matchedCues = baseTrack.cues.filter(c => baseCue.cueIds.includes(c.id));
      const firstWithImage = matchedCues.find(c => c.imageFileName || c.customImagePath);
      const firstWithAudio = matchedCues.find(c => c.audioFileName || c.customAudioPath);

      const firstWithImportedId = baseCue.importedId || matchedCues.find(c => c.importedId)?.importedId;

      const cells: Record<string, AlignedCell | null> = {
        [baseTrack.id]: {
          trackId: baseTrack.id,
          cueIds: baseCue.cueIds,
          startMs: baseCue.startMs,
          endMs: baseCue.endMs,
          text: baseCue.text,
          imageFileName: firstWithImage?.imageFileName,
          customImagePath: firstWithImage?.customImagePath,
          audioFileName: firstWithAudio?.audioFileName,
          customAudioPath: firstWithAudio?.customAudioPath,
          importedId: firstWithImportedId
        }
      };

      otherTracks.forEach(t => {
        cells[t.id] = null;
      });

      rows.push({
        id: `row_${idx + 1}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        index: idx + 1,
        cells,
        excluded: false,
        customId: firstWithImportedId
      });
    });

    // Etapa 4: Alinhar cada outra faixa secundária (suporta 1:M com junção por espaço)
    otherTracks.forEach(track => {
      const trackOffset = track.offsetMs || 0;
      const baseOffset = baseTrack.offsetMs || 0;

      // Mapeamento de rowIndex -> SubtitleCue[]
      const rowAssignedCues = new Map<number, SubtitleCue[]>();

      track.cues.forEach(cue => {
        const cueStart = cue.startMs + trackOffset;
        const cueEnd = cue.endMs + trackOffset;
        const cueMid = (cueStart + cueEnd) / 2;

        let bestRowIndex = -1;
        let maxOverlap = 0;
        let closestDist = Infinity;

        for (let r = 0; r < rows.length; r++) {
          const baseCell = rows[r].cells[baseTrack.id];
          if (!baseCell) continue;

          const baseStart = baseCell.startMs + baseOffset;
          const baseEnd = baseCell.endMs + baseOffset;

          const overlapStart = Math.max(cueStart, baseStart);
          const overlapEnd = Math.min(cueEnd, baseEnd);
          const overlap = overlapEnd - overlapStart;

          if (overlap > maxOverlap) {
            maxOverlap = overlap;
            bestRowIndex = r;
          }

          if (maxOverlap <= 0) {
            const dist = Math.min(
              Math.abs(cueStart - baseStart),
              Math.abs(cueEnd - baseEnd),
              Math.abs(cueMid - (baseStart + baseEnd) / 2)
            );
            if (dist <= tolerance && dist < closestDist) {
              closestDist = dist;
              bestRowIndex = r;
            }
          }
        }

        if (bestRowIndex !== -1) {
          if (!rowAssignedCues.has(bestRowIndex)) {
            rowAssignedCues.set(bestRowIndex, []);
          }
          rowAssignedCues.get(bestRowIndex)!.push(cue);
        }
      });

      // Atribui os dados agrupados à célula da linha
      rowAssignedCues.forEach((cuesList, rIdx) => {
        cuesList.sort((a, b) => a.startMs - b.startMs);
        const startMs = Math.min(...cuesList.map(c => c.startMs));
        const endMs = Math.max(...cuesList.map(c => c.endMs));
        const text = cuesList.map(c => c.text).join(' ');
        const cueIds = cuesList.map(c => c.id);
        const firstWithImage = cuesList.find(c => c.imageFileName || c.customImagePath);
        const firstWithAudio = cuesList.find(c => c.audioFileName || c.customAudioPath);
        const firstWithImportedId = cuesList.find(c => c.importedId)?.importedId;

        rows[rIdx].cells[track.id] = {
          trackId: track.id,
          cueIds,
          startMs,
          endMs,
          text,
          imageFileName: firstWithImage?.imageFileName,
          customImagePath: firstWithImage?.customImagePath,
          audioFileName: firstWithAudio?.audioFileName,
          customAudioPath: firstWithAudio?.customAudioPath,
          importedId: firstWithImportedId
        };

        if (firstWithImportedId && !rows[rIdx].customId) {
          rows[rIdx].customId = firstWithImportedId;
        }
      });
    });

    // Etapa 5: Se excludeNoCounterpart estiver ativo, marca linhas sem par
    if (excludeNoCounterpart && otherTracks.length > 0) {
      const primaryTrackId = otherTracks[0].id;
      rows.forEach(r => {
        if (!r.cells[primaryTrackId] || !r.cells[primaryTrackId]?.text.trim()) {
          r.excluded = true;
        }
      });
    }

    return rows;
  }

  private syncMovedImportedIds(rows: AlignedRow[], movedTrackId: string, hadImportedIdsOnTrack: boolean): void {
    if (!hadImportedIdsOnTrack) return;
    for (const row of rows) {
      const movedCell = row.cells[movedTrackId];
      if (movedCell?.importedId) {
        row.customId = movedCell.importedId;
      } else {
        const fallbackCell = Object.values(row.cells).find(c => c?.importedId);
        row.customId = fallbackCell?.importedId;
      }
    }
  }

  /**
   * Desloca (shift) as células de uma coluna a partir de uma dada linha para baixo (+1) ou para cima (-1)
   */
  public shiftColumn(rows: AlignedRow[], trackId: string, fromIndex: number, direction: 'down' | 'up'): AlignedRow[] {
    const trackHasImportedIds = rows.some(r => !!r.cells[trackId]?.importedId);
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
          excluded: false,
          customId: prevCell.importedId
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
    this.syncMovedImportedIds(updated, trackId, trackHasImportedIds);
    return updated;
  }

  /**
   * Move em bloco a célula a partir de fromIndex até o fim da coluna para toIndex,
   * deslocando todas as células subsequentes dessa coluna juntas (para cima ou para baixo).
   */
  public moveBlockToRow(rows: AlignedRow[], trackId: string, fromIndex: number, toIndex: number): AlignedRow[] {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return rows;
    const trackHasImportedIds = rows.some(r => !!r.cells[trackId]?.importedId);
    const updated = rows.map(r => ({ ...r, cells: { ...r.cells } }));

    // Extrai todas as células da coluna a partir de fromIndex
    const blockCells: (AlignedCell | null)[] = [];
    for (let i = fromIndex; i < updated.length; i++) {
      blockCells.push(updated[i].cells[trackId] || null);
      updated[i].cells[trackId] = null;
    }

    // Insere o bloco a partir de toIndex
    for (let i = 0; i < blockCells.length; i++) {
      const targetRowIdx = toIndex + i;
      const cell = blockCells[i];
      if (targetRowIdx < updated.length) {
        updated[targetRowIdx].cells[trackId] = cell;
      } else if (cell) {
        updated.push({
          id: `row_extra_${Date.now()}_${i}`,
          index: updated.length + 1,
          cells: { [trackId]: cell },
          excluded: false,
          customId: cell.importedId
        });
      }
    }

    if (toIndex < fromIndex) {
      // Garante que posições liberadas no final fiquem limpas
      for (let i = toIndex + blockCells.length; i < updated.length; i++) {
        updated[i].cells[trackId] = null;
      }

      // Remove linhas extras no final que estejam totalmente vazias
      while (
        updated.length > 0 &&
        Object.values(updated[updated.length - 1].cells).every(c => !c || !c.text?.trim())
      ) {
        updated.pop();
      }
    }

    this.syncMovedImportedIds(updated, trackId, trackHasImportedIds);
    updated.forEach((r, idx) => (r.index = idx + 1));
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
      text: `${current.text} ${next.text}`,
      audioFileName: current.audioFileName || next.audioFileName,
      imageFileName: current.imageFileName || next.imageFileName,
      customImagePath: current.customImagePath || next.customImagePath,
      customAudioPath: current.customAudioPath || next.customAudioPath,
      importedId: current.importedId || next.importedId
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
      text: `${prev.text} ${current.text}`,
      audioFileName: prev.audioFileName || current.audioFileName,
      imageFileName: prev.imageFileName || current.imageFileName,
      customImagePath: prev.customImagePath || current.customImagePath,
      customAudioPath: prev.customAudioPath || current.customAudioPath,
      importedId: prev.importedId || current.importedId
    };

    updated[rowIndex - 1].cells = { ...updated[rowIndex - 1].cells, [trackId]: merged };
    updated[rowIndex].cells = { ...updated[rowIndex].cells, [trackId]: null };

    return updated;
  }

  /**
   * Desvincula uma célula da linha atual, inserindo uma nova linha autônoma logo abaixo
   */
  public unlinkCell(rows: AlignedRow[], trackId: string, rowIndex: number): AlignedRow[] {
    const trackHasImportedIds = rows.some(r => !!r.cells[trackId]?.importedId);
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
      excluded: false,
      customId: cell.importedId
    };

    updated.splice(rowIndex + 1, 0, newRow);
    this.syncMovedImportedIds(updated, trackId, trackHasImportedIds);

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

