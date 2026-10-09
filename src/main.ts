import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { applyLangToDocument, readStoredLang } from './app/core/language.service';

// Set <html lang/dir> synchronously before Angular boots, so the page never
// flashes the wrong text direction while the app initializes.
applyLangToDocument(readStoredLang());

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
