import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslocoModule } from '@jsverse/transloco';
import { IconComponent } from '../../core/icon/icon.component';
import { AuthService } from '../../core/auth.service';
import { LanguageService } from '../../core/language.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, TranslocoModule],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  readonly lang = inject(LanguageService);

  username = '';
  password = '';
  showPassword = false;
  submitting = false;
  /** Translation key for the current error, or '' when there is none. */
  errorMsgKey = '';

  get valid(): boolean {
    return this.username.trim().length > 2 && this.password.length >= 6;
  }

  async submit(): Promise<void> {
    if (!this.valid || this.submitting) return;
    this.submitting = true;
    this.errorMsgKey = '';
    const err = await this.auth.signIn(this.username, this.password);
    if (err) {
      this.errorMsgKey = err;
      this.submitting = false;
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}
