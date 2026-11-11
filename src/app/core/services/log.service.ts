import { Injectable, NgZone } from '@angular/core';
import { ElectronService } from './electron.service';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
  details?: any;
}

@Injectable({
  providedIn: 'root'
})
export class LogService {
  private logs: LogEntry[] = [];
  private maxLogs = 500;

  constructor(
    private ngZone: NgZone,
    private electron: ElectronService
  ) {
    this.interceptConsole();
    this.listenGlobalErrors();
    this.listenElectronLogs();
    this.addLog('info', 'Sistema', 'Console de logs e diagnóstico inicializado com sucesso.');
  }

  private interceptConsole(): void {
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args: any[]) => {
      this.formatAndAdd('info', 'Console', args);
      originalLog.apply(console, args);
    };

    console.info = (...args: any[]) => {
      this.formatAndAdd('info', 'Console', args);
      originalInfo.apply(console, args);
    };

    console.warn = (...args: any[]) => {
      this.formatAndAdd('warn', 'Console', args);
      originalWarn.apply(console, args);
    };

    console.error = (...args: any[]) => {
      this.formatAndAdd('error', 'Console', args);
      originalError.apply(console, args);
    };
  }

  private listenGlobalErrors(): void {
    window.addEventListener('error', (event) => {
      this.addLog('error', 'WindowError', `${event.message} (${event.filename}:${event.lineno})`, event.error);
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const msg = reason?.message || String(reason || 'Rejeição de Promise não tratada');
      this.addLog('error', 'UnhandledPromise', msg, reason);
    });
  }

  private listenElectronLogs(): void {
    if (this.electron.isElectron) {
      this.electron.onMainLog((entry: any) => {
        if (entry && entry.message) {
          this.addLog(entry.level || 'info', entry.source || 'Electron', entry.message, entry.details);
        }
      });
    }
  }

  private formatAndAdd(level: 'info' | 'warn' | 'error', source: string, args: any[]): void {
    const message = args.map(a => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    }).join(' ');

    this.addLog(level, source, message);
  }

  public addLog(level: 'info' | 'warn' | 'error', source: string, message: string, details?: any): void {
    const now = new Date();
    const timeStr = `${now.toLocaleTimeString()}.${now.getMilliseconds().toString().padStart(3, '0')}`;

    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: timeStr,
      level,
      source,
      message,
      details
    };

    this.ngZone.run(() => {
      this.logs.unshift(entry);
      if (this.logs.length > this.maxLogs) {
        this.logs.pop();
      }
    });
  }

  public getLogs(): LogEntry[] {
    return [...this.logs];
  }

  public clearLogs(): void {
    this.logs = [];
  }
}

