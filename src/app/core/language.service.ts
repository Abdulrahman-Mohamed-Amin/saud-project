import { Injectable, signal, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';

export type AppLang = 'ar' | 'en';

const STORAGE_KEY = 'app-lang';

/** Reads the persisted language choice synchronously (used before Angular even
 *  bootstraps, in main.ts, so the page never flashes the wrong dir/lang on load). */
export function readStoredLang(): AppLang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

export function applyLangToDocument(lang: AppLang): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

/** Central place the rest of the app uses to read/change the active UI language.
 *  Keeps TranslocoService, the <html dir/lang> attributes, and localStorage in sync. */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private transloco = inject(TranslocoService);

  private _lang = signal<AppLang>(readStoredLang());
  readonly lang = this._lang.asReadonly();

  constructor() {
    // main.ts already set <html dir/lang> synchronously before bootstrap; just
    // make sure TranslocoService's active lang agrees with what we restored.
    this.transloco.setActiveLang(this._lang());
  }

  set(lang: AppLang): void {
    if (lang === this._lang()) return;
    this._lang.set(lang);
    this.transloco.setActiveLang(lang);
    applyLangToDocument(lang);
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  }

  toggle(): void {
    this.set(this._lang() === 'ar' ? 'en' : 'ar');
  }
}
