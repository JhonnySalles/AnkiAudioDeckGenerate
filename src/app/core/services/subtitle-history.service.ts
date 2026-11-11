import { Injectable } from '@angular/core';
import { AlignedRow } from '../types/subtitle-project';

export interface HistorySnapshot {
  description: string;
  rowsJson: string;
}

@Injectable({
  providedIn: 'root'
})
export class SubtitleHistoryService {
  private undoStack: HistorySnapshot[] = [];
  private redoStack: HistorySnapshot[] = [];
  private readonly maxHistory = 40;

  public pushState(rows: AlignedRow[], description: string = 'Ação'): void {
    const snapshot: HistorySnapshot = {
      description,
      rowsJson: JSON.stringify(rows)
    };

    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    // Toda nova ação limpa a pilha de refazer
    this.redoStack = [];
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(currentRows: AlignedRow[]): { rows: AlignedRow[]; description: string } | null {
    if (!this.canUndo()) return null;

    const previousSnapshot = this.undoStack.pop()!;
    // Salva o estado atual na pilha de refazer
    this.redoStack.push({
      description: previousSnapshot.description,
      rowsJson: JSON.stringify(currentRows)
    });

    return {
      rows: JSON.parse(previousSnapshot.rowsJson),
      description: previousSnapshot.description
    };
  }

  public redo(currentRows: AlignedRow[]): { rows: AlignedRow[]; description: string } | null {
    if (!this.canRedo()) return null;

    const nextSnapshot = this.redoStack.pop()!;
    // Salva o estado atual na pilha de desfazer
    this.undoStack.push({
      description: nextSnapshot.description,
      rowsJson: JSON.stringify(currentRows)
    });

    return {
      rows: JSON.parse(nextSnapshot.rowsJson),
      description: nextSnapshot.description
    };
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

