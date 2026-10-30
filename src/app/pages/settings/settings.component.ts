import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { IconComponent } from '../../core/icon/icon.component';
import { AuthService } from '../../core/auth.service';
import { LanguageService } from '../../core/language.service';
import { SupabaseService, AppUser } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, TranslocoModule],
  templateUrl: './settings.component.html',
})
export class SettingsComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);
  private supa = inject(SupabaseService);
  private toast = inject(ToastService);
  private transloco = inject(TranslocoService);

  name = '';
  company = '';
  email = '';
  role = '';
  notificationEmail = '';
  dailyEmailEnabled = true;

  notifyOverdue = true;
  notifyNewContract = true;
  notifyPaymentDue = true;

  currency = 'SAR';

  saving = false;
  saved = false;
  errorMsg = '';

  // ── Change password ──────────────────────────────────────────────────────────
  newPassword = '';
  confirmPassword = '';
  changingPassword = false;
  passwordChanged = false;
  passwordError = '';

  get passwordValid(): boolean {
    return this.newPassword.length >= 6 && this.newPassword === this.confirmPassword;
  }

  async changePassword() {
    if (!this.passwordValid || this.changingPassword) return;
    this.changingPassword = true;
    this.passwordError = '';

    const err = await this.auth.changePassword(this.newPassword);

    this.changingPassword = false;
    if (err) {
      this.passwordError = err;
    } else {
      this.newPassword = '';
      this.confirmPassword = '';
      this.passwordChanged = true;
      setTimeout(() => this.passwordChanged = false, 2500);
    }
  }

  ngOnInit() {
    this.loadUsers();
    const meta = this.auth.currentUser?.user_metadata ?? {};
    this.name     = meta['name']    ?? 'عبدالرحمن الأمين';
    this.role     = meta['role']    ?? 'مدير لوحة التحكم';
    this.company  = meta['company'] ?? 'شركة سبابة';
    this.email    = this.auth.currentUser?.email ?? '';

    this.notificationEmail  = meta['notification_email']  ?? '';
    this.dailyEmailEnabled  = meta['daily_email_enabled'] ?? true;
    this.notifyOverdue      = meta['notifyOverdue']       ?? true;
    this.notifyNewContract  = meta['notifyNewContract']   ?? true;
    this.notifyPaymentDue   = meta['notifyPaymentDue']    ?? true;
  }

  async save() {
    if (this.saving) return;
    this.saving = true;
    this.errorMsg = '';

    const err = await this.auth.updateProfile({
      name:                this.name,
      role:                this.role,
      company:             this.company,
      notification_email:  this.notificationEmail.trim(),
      daily_email_enabled: this.dailyEmailEnabled,
      notifyOverdue:       this.notifyOverdue,
      notifyNewContract:   this.notifyNewContract,
      notifyPaymentDue:    this.notifyPaymentDue,
    });

    this.saving = false;
    if (err) {
      this.errorMsg = err;
    } else {
      this.saved = true;
      setTimeout(() => this.saved = false, 2500);
    }
  }

  // ── إدارة المستخدمين (تظهر للمدير فقط) ─────────────────────────────────────────
  /** null = الحساب الحالي ليس مديراً (القسم مخفي) */
  users: AppUser[] | null = null;
  usersBusyId = '';
  pwUserId: string | null = null;
  pwValue = '';
  deleteUserId: string | null = null;

  async loadUsers() {
    this.users = await this.supa.adminListUsers();
  }
  isSelf(u: AppUser): boolean { return u.id === this.auth.currentUser?.id; }
  formatLogin(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  openPassword(u: AppUser) { this.pwUserId = u.id; this.pwValue = ''; this.deleteUserId = null; }
  cancelPassword() { this.pwUserId = null; this.pwValue = ''; }
  async savePassword(u: AppUser) {
    if (this.pwValue.length < 6 || this.usersBusyId) return;
    this.usersBusyId = u.id;
    const err = await this.supa.adminSetPassword(u.id, this.pwValue);
    this.usersBusyId = '';
    if (err) { this.toast.error(err); return; }
    this.toast.success(this.transloco.translate('settings.userPasswordChanged'), u.email);
    this.cancelPassword();
  }

  async toggleSuspended(u: AppUser) {
    if (this.usersBusyId || this.isSelf(u)) return;
    this.usersBusyId = u.id;
    const suspend = !u.suspended;
    const err = await this.supa.adminSetSuspended(u.id, suspend);
    this.usersBusyId = '';
    if (err) { this.toast.error(err); return; }
    this.toast.success(this.transloco.translate(suspend ? 'settings.userSuspendedToast' : 'settings.userResumedToast'), u.email);
    await this.loadUsers();
  }

  askDeleteUser(u: AppUser) { this.deleteUserId = u.id; this.pwUserId = null; }
  async confirmDeleteUser(u: AppUser) {
    if (this.usersBusyId || this.isSelf(u)) return;
    this.usersBusyId = u.id;
    const err = await this.supa.adminDeleteUser(u.id);
    this.usersBusyId = '';
    this.deleteUserId = null;
    if (err) { this.toast.error(err); return; }
    this.toast.success(this.transloco.translate('settings.userDeletedToast'), u.email);
    await this.loadUsers();
  }
}
