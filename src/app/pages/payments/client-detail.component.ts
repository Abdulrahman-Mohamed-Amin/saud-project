import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { IconComponent } from '../../core/icon/icon.component';
import { SupabaseService, ContractWithPayments, PaymentRow, ArchivedContract, SUPABASE_URL } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { buildReminderMessage, paymentLabelAr } from '../../core/reminder-message';
import { daysDiffFromToday } from '../../core/date-utils';

@Component({
  selector: 'app-client-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, TranslocoModule],
  templateUrl: './client-detail.component.html',
})
export class ClientDetailComponent implements OnInit, OnDestroy {
  private supa = inject(SupabaseService);
  private transloco = inject(TranslocoService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(ToastService);
  readonly auth = inject(AuthService);
  private paramSub?: Subscription;
  private realtimeChannel?: RealtimeChannel;

  private clientId = '';
  projectName = signal('');
  contract = signal<ContractWithPayments | null>(null);
  loading = signal(true);

  ngOnInit() {
    this.paramSub = this.route.paramMap.subscribe(async params => {
      this.projectName.set(decodeURIComponent(params.get('project') ?? ''));
      this.clientId = params.get('id') ?? '';
      this.loading.set(true);
      await this.reload();
      this.loading.set(false);
      this.subscribeRealtime();
    });
  }

  ngOnDestroy() {
    this.paramSub?.unsubscribe();
    this.realtimeChannel?.unsubscribe();
  }

  private async reload() {
    const all = await this.supa.loadContracts();
    this.contract.set(all.find(c => c.id === this.clientId) ?? null);
    this.archive.set(await this.supa.loadArchive(this.clientId));
  }

  // ── Archive (العقود السابقة بعد تغيير العميل أو التجديد) ─────────────────────────
  archive = signal<ArchivedContract[]>([]);
  openArchiveId: string | null = null;
  toggleArchive(id: string) { this.openArchiveId = this.openArchiveId === id ? null : id; }
  archivePaidCount(a: ArchivedContract): number { return a.payments.filter(p => p.paid).length; }
  archivePaidTotal(a: ArchivedContract): number {
    return a.payments.reduce((sum, p) => sum + (p.paid ? p.amount : (p.paid_amount ?? 0)), 0);
  }
  archiveDate(iso: string): string { return this.formatDate(iso.slice(0, 10)); }

  private subscribeRealtime() {
    this.realtimeChannel?.unsubscribe();
    this.realtimeChannel = this.supa.getClient()
      .channel('client-detail-' + this.clientId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payments' }, () => {
        this.reload();
      })
      .subscribe();
  }

  back() { this.router.navigate(['/payments', this.projectName()]); }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  paidCount(c: ContractWithPayments): number { return c.payments.filter(p => p.paid).length; }
  progressWidth(c: ContractWithPayments): string { return `${(this.paidCount(c) / c.payments.length) * 100}%`; }
  remaining(c: ContractWithPayments): number {
    return c.unit_price - c.payments.filter(p => p.paid).reduce((s, p) => s + p.amount, 0);
  }
  isOverdue(p: PaymentRow): boolean { return !p.paid && daysDiffFromToday(p.due_date) < 0; }
  isDueToday(p: PaymentRow): boolean { return !p.paid && daysDiffFromToday(p.due_date) === 0; }
  isDueSoon(p: PaymentRow): boolean {
    return !p.paid && daysDiffFromToday(p.due_date) === 3;
  }
  canRemind(p: PaymentRow): boolean {
    if (p.paid) return false;
    return daysDiffFromToday(p.due_date) <= 20;
  }
  fmt(n: number): string { return n.toLocaleString('en-US'); }
  formatDate(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  /** يبني اسم القسط مترجَماً حسب لغة الواجهة الحالية من رقم القسط (بدل الاعتماد على
   *  حقل `label` المخزَّن، وهو نص عربي ثابت لا يتغيّر مع تبديل اللغة) */
  installmentLabel(p: PaymentRow): string {
    return `${this.transloco.translate('payments.installment')} ${p.installment_number}`;
  }
  clientEmail(c: ContractWithPayments): string {
    const f = c.fields ?? {};
    return f['email'] || f['mail'] || f['الايميل'] || f['البريد'] || f['البريد_الالكتروني'] || f['client_email'] || '';
  }
  /** رقم التواصل عبر واتساب — يُستخدم رقم الواتساب لو موجود، وإلا يرجع لرقم الجوال تلقائياً */
  clientWhatsApp(c: ContractWithPayments): string {
    const f = c.fields ?? {};
    return (f['whatsapp'] || f['phone'] || f['mobile'] || '').replace(/[\s\-\(\)]/g, '');
  }
  /** رقم الاتصال المباشر — يُستخدم رقم الجوال لو موجود، وإلا يرجع لرقم الواتساب تلقائياً
   *  (نفس مبدأ الاحتياط المتبادل: لو العميل عنده رقم واحد بس، يُستخدم في الاتصال وفي واتساب) */
  clientCallNumber(c: ContractWithPayments): string {
    const f = c.fields ?? {};
    return (f['phone'] || f['whatsapp'] || f['mobile'] || '').replace(/[\s\-\(\)]/g, '');
  }

  // ── Toggle paid / unpaid ──────────────────────────────────────────────────────
  async toggle(p: PaymentRow, c: ContractWithPayments) {
    const ok = await this.supa.togglePayment(p.id, p.paid, p.amount);
    if (ok) {
      const nowPaid = !p.paid;
      this.contract.set({
        ...c,
        payments: c.payments.map(pay =>
          pay.id !== p.id ? pay : { ...pay, paid: nowPaid, paid_at: nowPaid ? new Date().toISOString() : null, paid_amount: nowPaid ? p.amount : 0 }
        ),
      });
      const label = this.installmentLabel(p);
      if (nowPaid) {
        this.toast.success(this.transloco.translate('detail.paymentRegisteredToast'), `${label} — ${c.client_name}`);
      } else {
        this.toast.info(this.transloco.translate('detail.paymentCancelledToast'), `${label} — ${c.client_name}`);
      }
    } else {
      this.toast.error(this.transloco.translate('detail.genericError'), this.transloco.translate('detail.changeNotSavedRetry'));
    }
  }

  // ── Partial payment / remaining helpers ──────────────────────────────────────
  remainingOf(p: PaymentRow): number {
    return Math.max(0, p.amount - (p.paid_amount ?? 0));
  }
  isPartiallyPaid(p: PaymentRow): boolean {
    return !p.paid && (p.paid_amount ?? 0) > 0;
  }

  // ── Notes + partial payment per installment ──────────────────────────────────
  private notePaymentId: string | null = null;
  notePaymentAmount = '';
  notePaymentNote = '';
  savingNote = false;

  /** الدفعة المفتوحة في البوب أب — تُقرأ دائماً من العقد الحالي ليظهر أي تحديث فوراً */
  get notePaymentTarget(): PaymentRow | null {
    const id = this.notePaymentId;
    return id ? (this.contract()?.payments.find(p => p.id === id) ?? null) : null;
  }

  openPaymentNote(p: PaymentRow) {
    if (!this.auth.canManagePayments || p.paid) return;
    this.notePaymentId = p.id;
    this.notePaymentAmount = String(p.paid_amount ?? 0);
    this.notePaymentNote = '';
  }
  cancelPaymentNote() {
    this.notePaymentId = null;
  }

  get notePaymentRemaining(): number {
    const t = this.notePaymentTarget;
    return t ? Math.max(0, t.amount - (Number(this.notePaymentAmount) || 0)) : 0;
  }

  /** يضيف ملاحظة جديدة بتاريخ اليوم أسفل الملاحظات السابقة */
  async addPaymentNote() {
    const c = this.contract();
    const target = this.notePaymentTarget;
    const text = this.notePaymentNote.trim();
    if (!target || !c || !text || this.savingNote || !this.auth.canManagePayments) return;
    this.savingNote = true;

    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const notes = [...(target.notes ?? []), { text, date }];

    const ok = await this.supa.updatePayment(target.id, { notes });
    if (ok) {
      this.contract.set({ ...c, payments: c.payments.map(p => p.id !== target.id ? p : { ...p, notes }) });
      this.notePaymentNote = '';
      this.toast.success(this.transloco.translate('detail.paymentNoteSavedToast'), c.client_name);
    } else {
      this.toast.error(this.transloco.translate('detail.genericError'), this.transloco.translate('detail.changeNotSavedRetry'));
    }
    this.savingNote = false;
  }

  async savePaymentAmount() {
    const c = this.contract();
    const target = this.notePaymentTarget;
    if (!target || !c || this.savingNote || !this.auth.canManagePayments) return;
    this.savingNote = true;

    const paidAmount = Math.max(0, Math.min(target.amount, Math.round(Number(this.notePaymentAmount) || 0)));
    const nowFullyPaid = paidAmount >= target.amount;
    const paidAt = nowFullyPaid ? new Date().toISOString() : null;

    const ok = await this.supa.updatePayment(target.id, { paid_amount: paidAmount, paid: nowFullyPaid, paid_at: paidAt });
    if (ok) {
      this.contract.set({ ...c, payments: c.payments.map(p => p.id !== target.id ? p : { ...p, paid_amount: paidAmount, paid: nowFullyPaid, paid_at: paidAt }) });
      this.toast.success(this.transloco.translate('detail.paymentNoteSavedToast'), c.client_name);
      if (nowFullyPaid) this.cancelPaymentNote();
    } else {
      this.toast.error(this.transloco.translate('detail.genericError'), this.transloco.translate('detail.changeNotSavedRetry'));
    }
    this.savingNote = false;
  }

  // ── Early reminder ────────────────────────────────────────────────────────────
  remindingId = '';
  async sendEarlyReminder(p: PaymentRow, c: ContractWithPayments) {
    if (this.remindingId || p.reminder_count >= 2) return;
    this.remindingId = p.id;
    const res = await this.supa.sendEarlyReminder(p.id, this.projectName());
    this.remindingId = '';
    if (res.sent) {
      p.last_reminded_at = new Date().toISOString();
      p.reminder_count = res.reminder_count ?? (p.reminder_count + 1);
      this.toast.success(this.transloco.translate('detail.reminderSentToast'), `${c.client_name} · ${p.reminder_count}/2`);
    } else if (res.limit_reached) {
      this.toast.error(this.transloco.translate('detail.reminderLimitReached'));
    } else {
      this.toast.error(this.transloco.translate(res.error?.includes('إيميل') ? 'detail.noEmailForClient' : 'detail.reminderFailed'));
    }
  }

  /** إرسال كشف حساب تلقائي عبر Resend — معطَّل مؤقتاً من الواجهة لحد ما يتم توثيق دومين
   *  إرسال على الحساب (sendEmail في email.ts بيرجع خطأ بهدوء لو السيكريت مش موجود،
   *  بس الدومين غير الموثّق بيرفض الإرسال لإيميلات غير إيميل الحساب نفسه). إعادة التفعيل
   *  تتم بإرجاع زرار الإيميل في الـ HTML لاستخدام (click)="sendStatement(c)" بدل emailHref(c). */
  sendingStatementId = '';
  async sendStatement(c: ContractWithPayments) {
    if (this.sendingStatementId) return;
    if (!this.clientEmail(c)) {
      this.toast.error(this.transloco.translate('detail.noEmailForClient'));
      return;
    }
    this.sendingStatementId = c.id;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/send-statement`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contract_id: c.id }),
        }
      );
      const result = await res.json();
      if (result.sent) {
        this.toast.success(this.transloco.translate('detail.statementSentToast'), c.client_name);
      } else {
        this.toast.error(this.transloco.translate('detail.statementFailed'));
      }
    } catch {
      this.toast.error(this.transloco.translate('detail.statementFailed'));
    }
    this.sendingStatementId = '';
  }

  /** يبني رسالة بريد جاهزة (موضوع + نص) بخصوص أقرب دفعة مستحقة/متأخرة — بديل مؤقت لحين
   *  توثيق دومين إرسال في Resend: بتفتح برنامج البريد المحلي بالرسالة جاهزة ليبعتها الموظف
   *  بنفسه يدوياً، بالضبط بنفس فكرة زرار الواتساب. */
  private buildEmailMessage(c: ContractWithPayments): { to: string; subject: string; body: string } | null {
    const to = this.clientEmail(c);
    if (!to) return null;

    const target = this.targetPaymentFor(c);
    if (!target) return null;

    const unitCode = c.fields?.['unit_code'] ?? '';
    const subject = `بخصوص ${paymentLabelAr(target.installmentNumber)} — وحدة ${unitCode} — ${this.projectName()}`;
    const body = buildReminderMessage({
      clientName: c.client_name,
      gender: (c.fields['gender'] as '' | 'male' | 'female') ?? '',
      senderName: this.auth.displayName || 'عبدالرحمن أمين',
      unitCode,
      projectName: this.projectName(),
      installmentNumber: target.installmentNumber,
      dueDateFormatted: target.dueDateFormatted,
      diffDays: target.diffDays,
    });

    return { to, subject, body };
  }

  /** رابط إنشاء رسالة Gmail جاهزة بموضوع ونص الرسالة، تُفتح في تاب جديد بالمتصفح —
   *  بديل عن mailto: اللي بيعتمد على وجود برنامج بريد افتراضي مُسجَّل على الجهاز (غالباً
   *  غير موجود)، بينما ده بيفتح فعلياً في المتصفح زي ما يحصل مع واتساب بالضبط. */
  emailHref(c: ContractWithPayments): string {
    const built = this.buildEmailMessage(c);
    if (!built) return '';
    const params = new URLSearchParams({
      view: 'cm',
      fs: '1',
      to: built.to,
      su: built.subject,
      body: built.body,
    });
    return `https://mail.google.com/mail/?${params.toString()}`;
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────────
  /** يحوّل رقم جوال محلي أو دولي إلى الصيغة الدولية بدون "+" (مثال: 966501234567) */
  private toIntlPhone(raw: string): string {
    let phone = raw;
    if (phone.startsWith('00')) phone = phone.slice(2);
    if (phone.startsWith('+')) phone = phone.slice(1);
    if (phone.startsWith('05')) phone = '966' + phone.slice(1);
    else if (/^5\d{8}$/.test(phone)) phone = '966' + phone;
    else if (!phone.startsWith('966')) phone = '966' + phone;
    return phone;
  }

  /** رابط اتصال مباشر (tel:) برقم التواصل — فاضي لو مفيش رقم محفوظ أصلاً */
  callHref(c: ContractWithPayments): string {
    const raw = this.clientCallNumber(c);
    return raw ? `tel:+${this.toIntlPhone(raw)}` : '';
  }

  /** الدفعة الأنسب للتذكير بها: المتأخرة أولاً، وإلا أقرب دفعة غير مسددة قادمة —
   *  يرجع null لو كل الدفعات مسددة (مفيش داعي لتذكير) */
  private targetPaymentFor(c: ContractWithPayments): { installmentNumber: number; dueDateFormatted: string; diffDays: number } | null {
    const target =
      c.payments.find(p => !p.paid && daysDiffFromToday(p.due_date) < 0) ??
      c.payments.find(p => !p.paid);
    if (!target) return null;
    return {
      installmentNumber: target.installment_number,
      dueDateFormatted: this.formatDate(target.due_date),
      diffDays: daysDiffFromToday(target.due_date),
    };
  }

  /** يبني رقم الهاتف الدولي ونص رسالة التذكير لعميل */
  private buildWhatsAppMessage(c: ContractWithPayments): { phone: string; text: string } | null {
    const raw = this.clientWhatsApp(c);
    if (!raw) return null;
    const phone = this.toIntlPhone(raw);

    const target = this.targetPaymentFor(c);
    if (!target) return null;

    const unitCode = c.fields?.['unit_code'] ?? '';
    // ملاحظة: نستخدم النص العربي مباشرة عمداً — رسالة الواتساب موجّهة للعميل مباشرة
    // وتبقى عربية دائماً بغضّ النظر عن لغة واجهة الموظف
    const text = buildReminderMessage({
      clientName: c.client_name,
      gender: (c.fields['gender'] as '' | 'male' | 'female') ?? '',
      senderName: this.auth.displayName || 'عبدالرحمن أمين',
      unitCode,
      projectName: this.projectName(),
      installmentNumber: target.installmentNumber,
      dueDateFormatted: target.dueDateFormatted,
      diffDays: target.diffDays,
    });

    return { phone, text };
  }

  openWhatsApp(c: ContractWithPayments): void {
    const built = this.buildWhatsAppMessage(c);
    if (!built) return;
    window.location.href = `whatsapp://send?phone=${built.phone}&text=${encodeURIComponent(built.text)}`;
  }


  // ── Edit client (نفس فورم الإضافة بالكامل: البيانات الشخصية وخطة الدفعات) ────────────
  editOpen = false;
  editName = '';
  editEmail = '';
  editPhone = '';
  editWhatsapp = '';
  editGender: '' | 'male' | 'female' = '';
  editUnitCode = '';
  editUnitPrice = '';
  editContractDate = '';
  editInstallmentsCount = '12';
  editInstallments: { amount: string; percent: string }[] = [];
  private editAmountsTouched = true;
  /** edit = تعديل عادي، replace = تغيير العميل (أرشفة القديم)، renew = تجديد سنة جديدة (أرشفة السنة السابقة) */
  editMode: 'edit' | 'replace' | 'renew' = 'edit';
  saving = false;

  openEdit() {
    const c = this.contract();
    if (!c || !this.auth.canManagePayments) return;
    this.editName = c.client_name;
    this.editEmail = c.fields['email'] ?? '';
    this.editPhone = c.fields['phone'] ?? '';
    this.editWhatsapp = c.fields['whatsapp'] ?? '';
    this.editGender = (c.fields['gender'] as '' | 'male' | 'female') ?? '';
    this.editUnitCode = c.fields['unit_code'] ?? '';
    this.editUnitPrice = String(c.unit_price);
    this.editContractDate = c.contract_date ?? '';
    const sorted = [...c.payments].sort((a, b) => a.installment_number - b.installment_number);
    this.editInstallmentsCount = String(sorted.length || 12);
    this.editInstallments = sorted.map(p => ({
      amount: String(p.amount),
      percent: c.unit_price ? String(+(p.amount / c.unit_price * 100).toFixed(2)) : '',
    }));
    this.editAmountsTouched = true;
    this.editMode = 'edit';
    this.editOpen = true;
  }

  /** تغيير العميل: نفس الوحدة والسعر، بيانات شخصية فارغة، وتاريخ بداية اليوم */
  openReplace() {
    this.openEdit();
    if (!this.editOpen) return;
    this.editMode = 'replace';
    this.editName = '';
    this.editEmail = '';
    this.editPhone = '';
    this.editWhatsapp = '';
    this.editGender = '';
    this.editContractDate = this.toDateStr(new Date());
  }

  /** تجديد سنة جديدة: نفس العميل، تاريخ البداية بعد سنة من التاريخ القديم */
  openRenew() {
    this.openEdit();
    if (!this.editOpen) return;
    this.editMode = 'renew';
    const [y, m, d] = (this.contract()?.contract_date ?? this.toDateStr(new Date())).split('-').map(Number);
    this.editContractDate = this.toDateStr(new Date(y + 1, m - 1, d));
  }
  cancelEdit() { this.editOpen = false; }

  /** يعيد توزيع قيمة الإيجار الحالية بالتساوي على عدد الدفعات المحدد (editInstallmentsCount) */
  autoSplitEditInstallments() {
    const price = Number(this.editUnitPrice) || 0;
    const n = Math.max(1, Math.min(60, Math.round(Number(this.editInstallmentsCount)) || 12));
    const base = Math.round(price / n);
    this.editInstallments = Array.from({ length: n }, (_, i) => {
      const amount = i < n - 1 ? base : price - base * (n - 1);
      return { amount: price ? String(amount) : '', percent: String(+(100 / n).toFixed(2)) };
    });
    this.editAmountsTouched = false;
  }

  onEditPriceChange() {
    if (!this.editAmountsTouched) this.autoSplitEditInstallments();
  }
  onEditInstallmentsCountChange() {
    this.autoSplitEditInstallments();
  }
  onEditPercentEdit(i: number) {
    this.editAmountsTouched = true;
    const price = Number(this.editUnitPrice) || 0;
    const pct = Number(this.editInstallments[i].percent);
    if (!price || !pct) return;
    const amount = Math.round(price * pct / 100);
    this.editInstallments[i].amount = String(amount);
    this.redistributeEditRemaining(i, amount, price);
  }
  onEditAmountEdit(i: number) {
    this.editAmountsTouched = true;
    const price = Number(this.editUnitPrice) || 0;
    const amount = Number(this.editInstallments[i].amount);
    if (!price || !amount) return;
    this.editInstallments[i].percent = String(+(amount / price * 100).toFixed(2));
    this.redistributeEditRemaining(i, amount, price);
  }
  /** بعد تعديل دفعة واحدة يدوياً، يوزّع الباقي بالتساوي تلقائياً على باقي الدفعات
   *  بدل ما يضطر المستخدم يعدّلها هو بنفسه واحدة واحدة عشان الإجمالي يرجع يطابق قيمة الإيجار. */
  private redistributeEditRemaining(editedIndex: number, editedAmount: number, price: number) {
    const otherIndexes = this.editInstallments.map((_, idx) => idx).filter(idx => idx !== editedIndex);
    if (!otherIndexes.length) return;
    const remaining = price - editedAmount;
    const base = Math.round(remaining / otherIndexes.length);
    otherIndexes.forEach((idx, k) => {
      const amount = k < otherIndexes.length - 1 ? base : remaining - base * (otherIndexes.length - 1);
      this.editInstallments[idx].amount = String(amount);
      this.editInstallments[idx].percent = price ? String(+(amount / price * 100).toFixed(2)) : '';
    });
  }
  removeEditInstallmentRow(i: number) {
    if (this.editInstallments.length <= 1) return;
    this.editAmountsTouched = true;
    this.editInstallments.splice(i, 1);
  }

  get editInstallmentsTotal(): number {
    return this.editInstallments.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  }
  get editInstallmentsRemaining(): number {
    return (Number(this.editUnitPrice) || 0) - this.editInstallmentsTotal;
  }

  get editValid(): boolean {
    return !!this.editName.trim()
      && !!this.editUnitPrice
      && !!this.editContractDate
      && this.editInstallments.length > 0
      && this.editInstallments.every(r => Number(r.amount) > 0)
      && Math.abs(this.editInstallmentsRemaining) < 1;
  }

  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async saveEdit() {
    const target = this.contract();
    if (!target || !this.editValid || this.saving || !this.auth.canManagePayments) return;
    if (this.editMode !== 'edit') return this.saveRestart(target);
    this.saving = true;

    const price = Number(this.editUnitPrice);
    const newFields = {
      ...(target.fields ?? {}),
      unit_code: this.editUnitCode,
      email: this.editEmail.trim(),
      phone: this.editPhone.trim(),
      whatsapp: this.editWhatsapp.trim(),
      gender: this.editGender,
    };

    // تقسيم السنة بالتساوي على عدد الدفعات الحالي (n) من تاريخ العقد (الجديد أو كما هو)
    const [y, m, d] = this.editContractDate.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    const end = new Date(y + 1, m - 1, d);
    const spanMs = end.getTime() - start.getTime();
    const n = this.editInstallments.length;
    const existing = [...target.payments].sort((a, b) => a.installment_number - b.installment_number);

    const updateOps: Promise<boolean>[] = [];
    const newRows: { installmentNumber: number; amount: number; dueDate: string }[] = [];
    for (let i = 0; i < n; i++) {
      const amount = Math.round(Number(this.editInstallments[i].amount));
      const dueDate = this.toDateStr(new Date(start.getTime() + Math.round((i * spanMs) / n)));
      if (i < existing.length) {
        updateOps.push(this.supa.updatePayment(existing[i].id, { amount, due_date: dueDate }));
      } else {
        newRows.push({ installmentNumber: i + 1, amount, dueDate });
      }
    }
    const removedIds = existing.slice(n).map(p => p.id);

    const ok = await this.supa.updateContract(target.id, {
      client_name: this.editName,
      contract_date: this.editContractDate,
      unit_price: price,
      first_payment: Math.round(Number(this.editInstallments[0].amount)),
      fields: newFields,
    });

    if (!ok) {
      this.toast.error(this.transloco.translate('detail.genericError'), this.transloco.translate('detail.changeNotSavedRetry'));
      this.saving = false;
      return;
    }

    await Promise.all([
      ...updateOps,
      newRows.length ? this.supa.addPayments(target.id, newRows) : Promise.resolve(true),
      ...removedIds.map(id => this.supa.deletePayment(id)),
    ]);

    await this.reload();
    this.toast.success(this.transloco.translate('detail.updatedToast'), this.editName.trim());
    this.editOpen = false;
    this.saving = false;
  }

  /** تغيير العميل / التجديد: يؤرشف العقد الحالي بدفعاته كاملة ثم يبدأ بدفعات جديدة غير مسددة */
  private async saveRestart(target: ContractWithPayments) {
    this.saving = true;
    const reason = this.editMode === 'replace' ? 'replaced' : 'renewed';

    const [y, m, d] = this.editContractDate.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    const spanMs = new Date(y + 1, m - 1, d).getTime() - start.getTime();
    const n = this.editInstallments.length;
    const rows = this.editInstallments.map((r, i) => ({
      installmentNumber: i + 1,
      amount: Math.round(Number(r.amount)),
      dueDate: this.toDateStr(new Date(start.getTime() + Math.round((i * spanMs) / n))),
    }));

    const ok = await this.supa.archiveAndRestart(target, reason, {
      client_name: this.editName.trim(),
      contract_date: this.editContractDate,
      unit_price: Number(this.editUnitPrice),
      first_payment: rows[0].amount,
      fields: {
        ...(target.fields ?? {}),
        unit_code: this.editUnitCode,
        email: this.editEmail.trim(),
        phone: this.editPhone.trim(),
        whatsapp: this.editWhatsapp.trim(),
        gender: this.editGender,
      },
    }, rows);

    if (!ok) {
      this.toast.error(this.transloco.translate('detail.genericError'), this.transloco.translate('detail.changeNotSavedRetry'));
      this.saving = false;
      await this.reload();
      return;
    }

    await this.reload();
    this.toast.success(this.transloco.translate(reason === 'replaced' ? 'detail.replacedToast' : 'detail.renewedToast'), this.editName.trim());
    this.editOpen = false;
    this.saving = false;
  }
}
