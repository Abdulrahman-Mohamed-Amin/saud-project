import { Component, ElementRef, ViewChild, effect, input, model, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/** حقل تاريخ بصيغة يوم/شهر/سنة (dd/mm/yyyy) بغض النظر عن لغة المتصفح، مع زر تقويم.
 *  القيمة المخزَّنة (`value`) دائماً بصيغة ISO (YYYY-MM-DD) أو نص فارغ لو التاريخ غير مكتمل. */
@Component({
  selector: 'app-date-input',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="relative">
      <input type="text" inputmode="numeric" dir="ltr" maxlength="10" placeholder="dd/mm/yyyy"
        [value]="text()" (input)="onInput($event)"
        [class]="inputClass() + ' pr-9'" />
      <button type="button" (click)="openPicker()" tabindex="-1"
        class="absolute inset-y-0 right-0 grid w-9 place-items-center text-ink-faint hover:text-brand transition cursor-pointer">
        <app-icon name="calOut" cls="h-4 w-4" />
      </button>
      <input #picker type="date" tabindex="-1" aria-hidden="true"
        class="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
        [value]="value()" (change)="onPicked($event)" />
    </div>
  `,
})
export class DateInputComponent {
  value = model<string>('');
  inputClass = input<string>('');

  text = signal('');
  @ViewChild('picker') private picker?: ElementRef<HTMLInputElement>;

  constructor() {
    // مزامنة النص مع القيمة لو اتغيّرت من برّه (توزيع تلقائي، اختيار من التقويم، فتح فورم...)
    effect(() => {
      const v = this.value();
      const current = this.parse(this.text());
      if (v && v !== current) this.text.set(this.format(v));
      else if (!v && current) this.text.set('');
    }, { allowSignalWrites: true });
  }

  onInput(e: Event) {
    const digits = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    (e.target as HTMLInputElement).value = out;
    this.text.set(out);
    this.value.set(this.parse(out));
  }

  openPicker() {
    const el = this.picker?.nativeElement;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  }

  onPicked(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (v) this.value.set(v);
  }

  private format(iso: string): string {
    const [y, m, d] = iso.split('-');
    return y && m && d ? `${d}/${m}/${y}` : '';
  }

  /** يحوّل dd/mm/yyyy إلى ISO، أو '' لو غير مكتمل/غير صحيح */
  private parse(text: string): string {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (!m) return '';
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
}
