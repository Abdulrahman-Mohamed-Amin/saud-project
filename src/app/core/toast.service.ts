import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  sub?: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  success(message: string, sub?: string) { this.add('success', message, sub); }
  error(message: string, sub?: string)   { this.add('error',   message, sub); }
  info(message: string, sub?: string)    { this.add('info',    message, sub); }

  dismiss(id: string) {
    this._toasts.update(t => t.filter(x => x.id !== id));
  }

  private add(type: Toast['type'], message: string, sub?: string) {
    const id = Math.random().toString(36).slice(2);
    this._toasts.update(t => [...t, { id, type, message, sub }]);
    setTimeout(() => this.dismiss(id), 4000);
  }
}
