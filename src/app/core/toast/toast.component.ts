import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed top-6 right-6 z-[9999] flex flex-col gap-2.5 items-end pointer-events-none">
      @for (t of toast.toasts(); track t.id) {
        <div
          class="pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3 shadow-pop border text-sm min-w-[260px] max-w-sm anim-pop"
          [class]="typeClass(t.type)"
        >
          <span class="text-lg leading-none shrink-0 mt-0.5">{{ typeIcon(t.type) }}</span>
          <div class="flex-1 min-w-0">
            <p class="font-semibold leading-tight">{{ t.message }}</p>
            @if (t.sub) {
              <p class="text-xs opacity-75 mt-0.5 truncate">{{ t.sub }}</p>
            }
          </div>
          <button
            (click)="toast.dismiss(t.id)"
            class="shrink-0 opacity-50 hover:opacity-100 transition text-base leading-none mt-0.5">✕</button>
        </div>
      }
    </div>
  `,
})
export class ToastComponent {
  readonly toast = inject(ToastService);

  typeClass(type: string): string {
    return {
      success: 'bg-white border-[#BBF7D0] text-[#14532D]',
      error:   'bg-white border-[#FCA5A5] text-[#7F1D1D]',
      info:    'bg-white border-line text-ink',
    }[type] ?? 'bg-white border-line text-ink';
  }

  typeIcon(type: string): string {
    return { success: '✅', error: '❌', info: 'ℹ️' }[type] ?? 'ℹ️';
  }
}
