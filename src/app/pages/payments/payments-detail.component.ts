import { Component, ElementRef, inject, OnInit, OnDestroy, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { IconComponent } from '../../core/icon/icon.component';
import { SupabaseService, ContractWithPayments } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { buildReminderMessage } from '../../core/reminder-message';
import { daysDiffFromToday } from '../../core/date-utils';

interface XlsxRow {
  name: string;
  unit_code: string;
  unit_price: string;
  first_payment: string;
  contract_date: string;
  email: string;
  phone: string;
  whatsapp: string;
  gender: '' | 'male' | 'female';
  /** عدد الدفعات في السنة لهذا العميل — فاضي يعني الافتراضي (12) */
  installments_count: string;
  /** per-installment paid flag, index 0 = installment 1 ... index 11 = installment 12 */
  paid: boolean[];
  /** whether the file actually included any of the دفعة_1..دفعة_12 columns for this row */
  paidProvided: boolean;
  error?: string;
}

/** أقصى عدد دفعات مدعوم في الاستيراد الجماعي (يطابق الحد الأقصى في فورم الإضافة اليدوية) */
const MAX_XLSX_INSTALLMENTS = 12;

@Component({
  selector: 'app-payments-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, TranslocoModule],
  templateUrl: './payments-detail.component.html',
})
export class PaymentsDetailComponent implements OnInit, OnDestroy {
  private supa = inject(SupabaseService);
  private transloco = inject(TranslocoService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(ToastService);
  readonly auth = inject(AuthService);
  private paramSub?: Subscription;
  private querySub?: Subscription;
  private realtimeChannel?: RealtimeChannel;
  private highlightTimer?: ReturnType<typeof setTimeout>;

  highlightId = signal<string | null>(null);

  projectName = signal('');
  contracts = signal<ContractWithPayments[]>([]);
  loading = signal(true);

  // sorted alphabetically by unit_code
  sorted = computed(() =>
    [...this.contracts()].sort((a, b) =>
      (a.fields?.['unit_code'] ?? '').localeCompare(b.fields?.['unit_code'] ?? '', 'ar')
    )
  );

  // ── Search / filter (client name or unit code) ────────────────────────────────
  searchQuery = signal('');
  /** يطبّع نصاً للمقارنة: يحذف الأحرف الخفية (علامات اتجاه/تنسيق) الشائعة في بيانات
   *  إكسل العربية، ويوحّد أشكال الشرطة المختلفة (– — ‑) إلى شرطة عادية "-" */
  private normSearch(s: string): string {
    return s
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00A0]/g, '')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .trim()
      .toLowerCase();
  }
  filtered = computed(() => {
    const q = this.normSearch(this.searchQuery());
    if (!q) return this.sorted();
    return this.sorted().filter(c =>
      this.normSearch(c.client_name).includes(q) ||
      this.normSearch(c.fields?.['unit_code'] ?? '').includes(q)
    );
  });
  clearSearch() { this.searchQuery.set(''); }

  // ── Delete ──────────────────────────────────────────────────────────────────
  deleteTargetId: string | null = null;
  deleting = false;

  confirmDelete(id: string) {
    if (!this.auth.canManagePayments) return;
    this.deleteTargetId = id;
  }
  cancelDelete() { this.deleteTargetId = null; }
  async executeDelete() {
    if (!this.deleteTargetId || !this.auth.canManagePayments) return;
    this.deleting = true;
    const ok = await this.supa.deleteContract(this.deleteTargetId);
    if (ok) this.contracts.update(list => list.filter(c => c.id !== this.deleteTargetId));
    this.deleteTargetId = null;
    this.deleting = false;
  }

  // ── Add Client ──────────────────────────────────────────────────────────────
  addOpen = false;
  addName = '';
  addEmail = '';
  addPhone = '';
  addWhatsapp = '';
  addGender: '' | 'male' | 'female' = '';
  addUnitCode = '';
  addUnitPrice = '';
  addFirstPaymentDate = '';
  /** عدد الدفعات في السنة — الافتراضي 12 (شهرية)، قابل للتغيير (مثلاً 6 كل شهرين، أو 4 كل 3 شهور) */
  addInstallmentsCount = '12';
  addSaving = false;

  /** خطة الدفعات القابلة للتعديل يدوياً في مودال إضافة عميل — تبدأ موزّعة تلقائياً
   *  بالتساوي على عدد الدفعات المحدد (addInstallmentsCount)، وتتحدّث تلقائياً مع تغيير
   *  السعر أو العدد طالما المستخدم لم يعدّلها يدوياً؛ بمجرد أي تعديل يدوي (مبلغ، إضافة، حذف)
   *  تتوقف عن إعادة التوزيع التلقائي حتى يطلبه صراحةً.
   *  كل صف فيه حقلا "نسبة %" و"مبلغ" متزامنين: تعديل أيّهما يحسب الآخر تلقائياً من قيمة الإيجار. */
  addInstallments: { amount: string; percent: string }[] = [];
  private addAmountsTouched = false;

  openAdd() {
    if (!this.auth.canManagePayments) return;
    this.addName = '';
    this.addEmail = '';
    this.addPhone = '';
    this.addWhatsapp = '';
    this.addGender = '';
    this.addUnitCode = '';
    this.addUnitPrice = '';
    this.addFirstPaymentDate = '';
    this.addInstallmentsCount = '12';
    this.addInstallments = [];
    this.addAmountsTouched = false;
    this.autoSplitInstallments();
    this.addOpen = true;
  }
  closeAdd() { this.addOpen = false; }

  /** يعيد توزيع قيمة الإيجار الحالية بالتساوي على عدد الدفعات المحدد (addInstallmentsCount) */
  autoSplitInstallments() {
    const price = Number(this.addUnitPrice) || 0;
    const n = Math.max(1, Math.min(60, Math.round(Number(this.addInstallmentsCount)) || 12));
    const base = Math.round(price / n);
    this.addInstallments = Array.from({ length: n }, (_, i) => {
      const amount = i < n - 1 ? base : price - base * (n - 1);
      return { amount: price ? String(amount) : '', percent: String(+(100 / n).toFixed(2)) };
    });
    this.addAmountsTouched = false;
  }

  /** يُستدعى عند تغيير قيمة الإيجار — يعيد التوزيع التلقائي فقط لو المستخدم لسه ما لمسش الدفعات يدوياً */
  onAddPriceChange() {
    if (!this.addAmountsTouched) this.autoSplitInstallments();
  }

  /** يُستدعى عند تغيير عدد الدفعات — يعيد التوزيع دايماً لأنه طلب صريح من المستخدم لعدد جديد */
  onInstallmentsCountChange() {
    this.autoSplitInstallments();
  }

  /** كتابة نسبة مئوية في صف تحسب المبلغ تلقائياً (نسبة × سعر الوحدة) */
  onAddPercentEdit(i: number) {
    this.addAmountsTouched = true;
    const price = Number(this.addUnitPrice) || 0;
    const pct = Number(this.addInstallments[i].percent);
    if (price && pct) this.addInstallments[i].amount = String(Math.round(price * pct / 100));
  }
  /** كتابة مبلغ مباشرة تحدّث نسبته المقابلة للعرض فقط */
  onAddAmountEdit(i: number) {
    this.addAmountsTouched = true;
    const price = Number(this.addUnitPrice) || 0;
    const amount = Number(this.addInstallments[i].amount);
    if (price && amount) this.addInstallments[i].percent = String(+(amount / price * 100).toFixed(2));
  }

  removeInstallmentRow(i: number) {
    if (this.addInstallments.length <= 1) return;
    this.addAmountsTouched = true;
    this.addInstallments.splice(i, 1);
  }

  get addInstallmentsTotal(): number {
    return this.addInstallments.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  }
  get addInstallmentsRemaining(): number {
    return (Number(this.addUnitPrice) || 0) - this.addInstallmentsTotal;
  }

  get addValid(): boolean {
    return !!this.addName.trim()
      && !!this.addUnitPrice
      && !!this.addFirstPaymentDate
      && this.addInstallments.length > 0
      && this.addInstallments.every(r => Number(r.amount) > 0)
      && Math.abs(this.addInstallmentsRemaining) < 1;
  }

  async submitAdd() {
    if (!this.addValid || this.addSaving || !this.auth.canManagePayments) return;
    this.addSaving = true;

    const dup = await this.supa.checkDuplicate(
      this.projectName(), this.addName.trim(), this.addUnitCode.trim()
    );
    if (dup) {
      this.toast.error(this.transloco.translate(dup === 'name' ? 'detail.nameTaken' : 'detail.unitTaken'));
      this.addSaving = false;
      return;
    }

    const price = Number(this.addUnitPrice);
    const [y, m, d] = this.addFirstPaymentDate.split('-').map(Number);

    // تقسيم السنة بالتساوي على عدد الدفعات (n) — من تاريخ البداية إلى نفس التاريخ في السنة التالية،
    // مقسّم بالتساوي بالأيام (لا بالأشهر) حتى يصح القسمة مهما كان عدد الدفعات
    const start = new Date(y, m - 1, d);
    const end = new Date(y + 1, m - 1, d);
    const spanMs = end.getTime() - start.getTime();
    const n = this.addInstallments.length;
    const installments = this.addInstallments.map((row, i) => ({
      amount: Math.round(Number(row.amount)),
      dueDate: this.toDateStr(new Date(start.getTime() + Math.round((i * spanMs) / n))),
    }));

    const result = await this.supa.saveContract({
      projectName: this.projectName(),
      clientName: this.addName.trim(),
      unitPrice: price,
      firstPayment: installments[0].amount,
      contractDate: this.addFirstPaymentDate,
      fields: {
        unit_code: this.addUnitCode.trim(),
        email: this.addEmail.trim(),
        phone: this.addPhone.trim(),
        whatsapp: this.addWhatsapp.trim(),
        gender: this.addGender,
      },
      installments,
    });

    this.addSaving = false;

    if ('error' in result) {
      this.toast.error(this.transloco.translate('detail.saveError'), result.error);
    } else {
      // Reload contracts for this project
      const all = await this.supa.loadContracts();
      this.contracts.set(all.filter(c => c.project_name === this.projectName()));
      this.toast.success(this.transloco.translate('detail.addedToast'), this.addName.trim());
      this.addOpen = false;
    }
  }

  // ── Edit ────────────────────────────────────────────────────────────────────
  editTarget: ContractWithPayments | null = null;
  editName = '';
  editEmail = '';
  editPhone = '';
  editWhatsapp = '';
  editGender: '' | 'male' | 'female' = '';
  editUnitCode = '';
  editUnitPrice = '';
  editContractDate = '';
  editInstallmentsCount = '12';
  /** خطة الدفعات القابلة للتعديل — تبدأ من دفعات العميل الفعلية الحالية (لا من توزيع تلقائي)
   *  حتى لا تُفقَد أي تخصيص سابق، وتتوقف عن اعتبارها "لمسوسة يدوياً" (touched) إلا بعد
   *  تعديل فعلي أو تغيير عدد الدفعات صراحةً — بنفس منطق فورم الإضافة تماماً. */
  editInstallments: { amount: string; percent: string }[] = [];
  private editAmountsTouched = true;
  saving = false;

  openEdit(c: ContractWithPayments) {
    if (!this.auth.canManagePayments) return;
    this.editTarget = c;
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
  }
  cancelEdit() { this.editTarget = null; }

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

  async saveEdit() {
    if (!this.editTarget || !this.editValid || this.saving || !this.auth.canManagePayments) return;
    const target = this.editTarget;
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

    await this.reloadContracts();
    this.toast.success(this.transloco.translate('detail.updatedToast'), this.editName.trim());
    this.editTarget = null;
    this.saving = false;
  }

  // ── Excel bulk import ────────────────────────────────────────────────────────
  @ViewChild('xlsxInput') xlsxInputRef!: ElementRef<HTMLInputElement>;
  xlsxOpen = false;
  xlsxRows: XlsxRow[] = [];
  xlsxImporting = false;
  remindingId = '';
  xlsxStatus = '';

  get xlsxValidCount() { return this.xlsxRows.filter(r => !r.error).length; }
  get xlsxErrorCount() { return this.xlsxRows.filter(r => !!r.error).length; }
  getPaidCount(r: XlsxRow): number { return r.paid.filter(Boolean).length; }
  /** عدد الدفعات الفعلي لهذا الصف — من عمود عدد_الدفعات لو موجود، وإلا الافتراضي 12 */
  rowInstallmentsCount(r: XlsxRow): number {
    return Math.max(1, Math.min(MAX_XLSX_INSTALLMENTS, Math.round(Number(r.installments_count)) || 12));
  }

  isDragging = false;

  openXlsx() {
    if (!this.auth.canManagePayments) return;
    if (!this.projectName()) { this.toast.error(this.transloco.translate('detail.pickProjectFirst')); return; }
    this.xlsxRows = []; this.xlsxStatus = ''; this.xlsxOpen = true; this.xlsxSkippedDetails = []; this.xlsxDuplicateDetails = [];
  }
  closeXlsx() { this.xlsxOpen = false; if (this.xlsxInputRef) this.xlsxInputRef.nativeElement.value = ''; }
  triggerXlsxInput() { this.xlsxInputRef?.nativeElement.click(); }

  onDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation(); this.isDragging = true; }
  onDragLeave(e: DragEvent) { e.preventDefault(); e.stopPropagation(); this.isDragging = false; }
  onDrop(e: DragEvent) {
    e.preventDefault(); e.stopPropagation();
    this.isDragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls)$/i)) { this.toast.error(this.transloco.translate('detail.unsupportedFile'), this.transloco.translate('detail.unsupportedFileSub')); return; }
    this.processXlsxFile(file);
  }

  downloadTemplate() {
    const paidHeaders = Array.from({ length: MAX_XLSX_INSTALLMENTS }, (_, i) => `دفعة_${i + 1}`);
    const paidSample = Array.from({ length: MAX_XLSX_INSTALLMENTS }, (_, i) => i === 0 ? 'نعم' : 'لا');
    const headers = ['name', 'unit_code', 'unit_price', 'first_payment', 'contract_date', 'email', 'phone', 'whatsapp', 'gender', 'installments_count', ...paidHeaders];
    const sample  = ['محمد عبدالله', '1-A', '24000', '', '18/06/2026', 'email@example.com', '0501234567', '', 'ذكر', '12', ...paidSample];
    const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'العملاء');
    XLSX.writeFile(wb, 'قالب_العملاء.xlsx');
  }

  /** Formats a locally-constructed Date as YYYY-MM-DD using its local getters.
   *  Never use .toISOString() for this — it converts to UTC first, which silently
   *  shifts the date back a day in any positive-UTC-offset timezone (e.g. Riyadh, UTC+3). */
  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private parseContractDate(raw: string): string | null {
    if (!raw) return null;
    // strip trailing timestamp (2026-06-18T00:00:00 → 2026-06-18)
    const s = raw.split('T')[0].trim();
    // YYYY-MM-DD exact
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // split on any separator including space
    const parts = s.split(/[\/\-\.\s]+/);
    if (parts.length === 3) {
      const [a, b, c] = parts;
      // YYYY/MM/DD
      if (a.length === 4 && +a > 1900) {
        const d = new Date(+a, +b - 1, +c);
        if (!isNaN(d.getTime())) return this.toDateStr(d);
      }
      // DD/MM/YYYY
      if (c.length === 4 && +c > 1900) {
        const d = new Date(+c, +b - 1, +a);
        if (!isNaN(d.getTime())) return this.toDateStr(d);
      }
      // DD/MM/YY → 20YY
      if (c.length <= 2 && +c >= 0 && +c <= 99) {
        const d = new Date(2000 + +c, +b - 1, +a);
        if (!isNaN(d.getTime())) return this.toDateStr(d);
      }
      // YY/MM/DD → 20YY (e.g. 26/06/18)
      if (a.length <= 2 && +a >= 0 && +a <= 99 && +c <= 31) {
        const d = new Date(2000 + +a, +b - 1, +c);
        if (!isNaN(d.getTime())) return this.toDateStr(d);
      }
    }
    // Excel serial number
    const serial = Number(raw);
    if (!isNaN(serial) && serial > 1000 && serial < 100000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    return null;
  }

  handleXlsxFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.processXlsxFile(file);
  }

  processXlsxFile(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      const isCell = (c: any) => c !== null && c !== undefined && String(c).trim() !== '';
      const hi = raw.findIndex(r => Array.isArray(r) && r.some(isCell));
      if (hi === -1) { this.xlsxRows = []; return; }

      // Normalize header: lowercase, trim, collapse any symbol/space to _
      const normalizeKey = (s: string) =>
        String(s).trim().toLowerCase()
          .replace(/[\s\-\.\/\(\)\*\#\+،,]+/g, '_')
          .replace(/_+/g, '_').replace(/^_|_$/g, '');

      const cols = raw[hi].map((h: any) => normalizeKey(h));

      // Aliases for column names (English + Arabic) — all get normalizeKey applied
      const colAliases: Record<string, string[]> = {
        name: [
          'name', 'client_name', 'customer_name', 'full_name', 'fullname', 'client',
          'اسم', 'الاسم', 'اسم_العميل', 'اسم_الزبون', 'اسم_المالك', 'اسم_المستأجر',
          'العميل', 'الزبون', 'المستأجر', 'المشتري',
        ],
        unit_code: [
          'unit_code', 'unitcode', 'unit_number', 'unit_no', 'unit', 'apt', 'apartment',
          'كود_الوحدة', 'رقم_الوحدة', 'كود', 'الوحدة', 'رقم_الشقة', 'الشقة',
          'رقم_الغرفة', 'رقم_العقار',
        ],
        unit_price: [
          'unit_price', 'unitprice', 'price', 'total_price', 'total', 'contract_value', 'amount',
          'rent', 'rent_value', 'yearly_rent', 'annual_rent',
          'سعر_الوحدة', 'السعر', 'سعر', 'القيمة', 'قيمة_العقد', 'المبلغ', 'اجمالي_السعر',
          'إجمالي_السعر', 'ثمن_الوحدة', 'قيمة_الايجار', 'قيمة_الإيجار', 'الايجار', 'الإيجار',
          'ايجار_سنوي', 'إيجار_سنوي',
        ],
        first_payment: [
          'first_payment', 'firstpayment', 'fp', 'down_payment', 'downpayment',
          'advance', 'deposit', 'initial_payment',
          'الدفعة_الاولى', 'الدفعة_الأولى', 'دفعة_اولى', 'دفعة_أولى',
          'المقدم', 'العربون', 'دفعة_مقدمة',
        ],
        contract_date: [
          'contract_date', 'contractdate', 'date', 'signing_date', 'start_date', 'agreement_date',
          'تاريخ_العقد', 'تاريخ', 'التاريخ', 'تاريخ_التعاقد', 'تاريخ_الاتفاقية',
          'تاريخ_التوقيع', 'تاريخ_البدء',
        ],
        email: [
          'email', 'mail', 'e_mail', 'e-mail', 'client_email', 'customer_email',
          'الايميل', 'الإيميل', 'البريد', 'البريد_الالكتروني', 'البريد_الإلكتروني',
          'ايميل', 'إيميل', 'بريد',
        ],
        phone: [
          'phone', 'mobile', 'tel', 'telephone', 'cell', 'phone_number', 'mobile_number',
          'phonenumber', 'mobilenumber',
          'الجوال', 'الهاتف', 'رقم_الجوال', 'رقم_الهاتف', 'جوال', 'هاتف',
          'موبايل', 'رقم_الموبايل', 'رقم_التليفون', 'تليفون',
        ],
        whatsapp: [
          'whatsapp', 'whats_app', 'wa', 'wa_number', 'whatsapp_number',
          'واتساب', 'الواتساب', 'رقم_الواتساب', 'واتس', 'الواتس', 'رقم_الواتس',
        ],
        gender: [
          'gender', 'sex',
          'الجنس', 'جنس', 'نوع',
        ],
        installments_count: [
          'installments_count', 'installment_count', 'payments_count', 'payment_count',
          'num_installments', 'installments', 'installments_no',
          'عدد_الدفعات', 'عدد_الاقساط', 'عدد_الأقساط', 'عدد_دفعات', 'عدد_الدفعه',
        ],
        ...Object.fromEntries(
          Array.from({ length: MAX_XLSX_INSTALLMENTS }, (_, i) => {
            const n = i + 1;
            const arabicDigits = String(n).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[+d]);
            return [`paid_${n}`, [`دفعة_${n}`, `دفعة${n}`, `الدفعة_${n}`, `دفعة_${arabicDigits}`, `paid_${n}`, `installment_${n}`, `payment_${n}`]];
          })
        ),
      };

      const findCol = (key: string): number => {
        for (const alias of colAliases[key] ?? [key]) {
          const idx = cols.indexOf(normalizeKey(alias));
          if (idx !== -1) return idx;
        }
        return -1;
      };

      // Normalize Arabic-Indic numerals to Western
      const toWestern = (s: string) =>
        s.replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

      const getStr = (r: any[], key: string): string => {
        const idx = findCol(key);
        if (idx === -1) return '';
        const val = r[idx];
        if (val === null || val === undefined) return '';
        return toWestern(String(val)).trim();
      };

      const TRUE_VALUES = ['نعم', 'ايوه', 'ايوة', 'صح', 'مدفوع', 'مدفوعة', 'تم', 'yes', 'y', 'true', '1', '✓', 'paid'];
      const isPaidCol = (r: any[], key: string): { has: boolean; paid: boolean } => {
        const idx = findCol(key);
        if (idx === -1) return { has: false, paid: false };
        const raw = r[idx];
        if (raw === null || raw === undefined || String(raw).trim() === '') return { has: false, paid: false };
        const v = toWestern(String(raw)).trim().toLowerCase();
        return { has: true, paid: TRUE_VALUES.includes(v) };
      };

      const MALE_VALUES = ['ذكر', 'male', 'm', 'رجل'];
      const FEMALE_VALUES = ['انثى', 'أنثى', 'female', 'f', 'امرأة', 'إمرأة'];
      const parseGender = (raw: string): '' | 'male' | 'female' => {
        const v = raw.trim().toLowerCase();
        if (!v) return '';
        if (MALE_VALUES.includes(v)) return 'male';
        if (FEMALE_VALUES.includes(v)) return 'female';
        return '';
      };

      this.xlsxRows = raw.slice(hi + 1)
        .filter(r => Array.isArray(r) && r.some(isCell))
        .map(r => {
          const paidCols = Array.from({ length: MAX_XLSX_INSTALLMENTS }, (_, i) => isPaidCol(r, `paid_${i + 1}`));
          const row: XlsxRow = {
            name:               getStr(r, 'name'),
            unit_code:          getStr(r, 'unit_code'),
            unit_price:         getStr(r, 'unit_price'),
            first_payment:      getStr(r, 'first_payment'),
            contract_date:      getStr(r, 'contract_date').replace(/^[_\-]+$/, ''),
            email:              getStr(r, 'email'),
            phone:              getStr(r, 'phone').replace(/^pdi\s*/i, '').trim(),
            whatsapp:           getStr(r, 'whatsapp').replace(/^pdi\s*/i, '').trim(),
            gender:             parseGender(getStr(r, 'gender')),
            installments_count: getStr(r, 'installments_count'),
            paid:               paidCols.map(p => p.paid),
            paidProvided:       paidCols.some(p => p.has),
          };
          // تخطّي فقط لو مفيش اسم
          if (!row.name) {
            row.error = this.transloco.translate('detail.rowIncomplete');
            return row;
          }
          if (row.contract_date) {
            const parsedDate = this.parseContractDate(row.contract_date);
            if (!parsedDate) row.error = this.transloco.translate('detail.invalidDate', { date: row.contract_date });
            else row.contract_date = parsedDate;
          }
          return row;
        });
    };
    reader.readAsArrayBuffer(file);
  }

  xlsxSkippedDetails: { name: string; reason: string }[] = [];
  xlsxDuplicateDetails: { name: string; unit: string }[] = [];
  closeXlsxDuplicates() { this.xlsxDuplicateDetails = []; }

  async submitXlsx() {
    if (!this.auth.canManagePayments) return;
    if (!this.projectName()) { this.toast.error(this.transloco.translate('detail.pickProjectFirst')); return; }
    const validRows = this.xlsxRows.filter(r => !r.error);
    if (!validRows.length || this.xlsxImporting) return;
    this.xlsxImporting = true;
    let added = 0, skipped = 0, duplicates = 0;
    const skippedDetails: { name: string; reason: string }[] = [];
    const duplicateDetails: { name: string; unit: string }[] = [];

    let updated = 0;
    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      this.xlsxStatus = `${i + 1} / ${validRows.length} — ${row.name}`;

      try {
        const newFields = {
          unit_code: row.unit_code,
          email:     row.email,
          phone:     row.phone,
          whatsapp:  row.whatsapp,
          gender:    row.gender,
        };

        // ── تحقّق من التكرار الكامل: نفس الاسم + نفس رقم الوحدة معاً ────────
        // (منفصل عن checkDuplicate أدناه، التي تطابق الوحدة أو الاسم منفردَين
        // لدعم تصحيح بيانات عميل موجود — هنا نريد رصد إعادة استيراد نفس العميل بالضبط)
        if (row.unit_code) {
          const exactId = await this.supa.findExactDuplicateId(this.projectName(), row.name, row.unit_code);
          if (exactId) {
            duplicates++;
            duplicateDetails.push({ name: row.name, unit: row.unit_code });
            if (row.paidProvided) await this.supa.syncPaymentStatuses(exactId, row.paid);
            continue;
          }
        }

        const dup = await this.supa.checkDuplicate(this.projectName(), row.name, row.unit_code);
        if (dup === 'unit') {
          const contractId = await this.supa.updateContractByUnitCode(
            this.projectName(), row.unit_code, { client_name: row.name, fields: newFields }
          );
          if (contractId) {
            if (row.paidProvided) await this.supa.syncPaymentStatuses(contractId, row.paid);
            updated++;
          } else {
            skipped++;
            skippedDetails.push({ name: row.name, reason: this.transloco.translate('detail.clientByUnitNotFound', { unit: row.unit_code }) });
          }
          continue;
        }
        if (dup === 'name') {
          const contractId = await this.supa.updateContractByName(
            this.projectName(), row.name, { client_name: row.name, fields: newFields }
          );
          if (contractId) {
            if (row.paidProvided) await this.supa.syncPaymentStatuses(contractId, row.paid);
            updated++;
          } else {
            skipped++;
            skippedDetails.push({ name: row.name, reason: this.transloco.translate('detail.clientByNameNotFound') });
          }
          continue;
        }

        const price = row.unit_price ? Number(row.unit_price.replace(/,/g, '')) : 0;
        const dateStr = row.contract_date || this.toDateStr(new Date());
        const [y, m, d] = dateStr.split('-').map(Number);
        const start = new Date(y, m - 1, d);
        const end = new Date(y + 1, m - 1, d);
        const spanMs = end.getTime() - start.getTime();
        const n = this.rowInstallmentsCount(row);

        // تقسيم قيمة الإيجار بالتساوي على n دفعة خلال السنة؛ عمود "الدفعة الأولى" اختياري
        // ويُستخدم فقط لو حبيت تحدد دفعة أولى مختلفة (مثل تأمين أو مقدم)، والباقي يُوزَّع بالتساوي
        const fpOverride = row.first_payment ? Number(row.first_payment.replace(/,/g, '')) : null;
        const installments = Array.from({ length: n }, (_, idx) => {
          const dt = new Date(start.getTime() + Math.round((idx * spanMs) / n));
          let amount: number;
          if (fpOverride !== null && n > 1) {
            const remaining = price - fpOverride;
            const base = Math.round(remaining / (n - 1));
            amount = idx === 0 ? fpOverride : idx < n - 1 ? base : remaining - base * (n - 2);
          } else {
            const base = Math.round(price / n);
            amount = idx < n - 1 ? base : price - base * (n - 1);
          }
          return {
            amount,
            dueDate: this.toDateStr(dt),
            paid: row.paidProvided ? row.paid[idx] : idx === 0,
          };
        });

        const result = await this.supa.saveContract({
          projectName: this.projectName(),
          clientName: row.name,
          unitPrice: price,
          firstPayment: installments[0].amount,
          contractDate: dateStr,
          fields: newFields,
          installments,
        });
        if (!('error' in result)) {
          added++;
        } else {
          skipped++;
          skippedDetails.push({ name: row.name, reason: result.error });
        }
      } catch (e: any) {
        skipped++;
        skippedDetails.push({ name: row.name, reason: e?.message ?? this.transloco.translate('detail.unexpectedError') });
      }
    }

    const all = await this.supa.loadContracts();
    this.contracts.set(all.filter(c => c.project_name === this.projectName()));
    this.xlsxImporting = false;
    this.xlsxOpen = false;
    this.xlsxSkippedDetails = skippedDetails;
    this.xlsxDuplicateDetails = duplicateDetails;

    const parts = [];
    if (added)      parts.push(this.transloco.translate('detail.addedCount', { count: added }));
    if (updated)    parts.push(this.transloco.translate('detail.updatedCount', { count: updated }));
    if (duplicates) parts.push(this.transloco.translate('detail.duplicateCount', { count: duplicates }));
    if (skipped)    parts.push(this.transloco.translate('detail.skippedCount', { count: skipped }));
    this.toast.success(this.transloco.translate('detail.importedToast'), parts.join(' · '));
    if (duplicates) {
      this.toast.info(
        this.transloco.translate('detail.duplicateCountToast', { count: duplicates }),
        this.transloco.translate('detail.duplicateCountSub')
      );
    }
  }

  closeXlsxSkipped() { this.xlsxSkippedDetails = []; }

  // ── Init ────────────────────────────────────────────────────────────────────
  ngOnInit() {
    this.paramSub = this.route.paramMap.subscribe(async params => {
      const name = decodeURIComponent(params.get('project') ?? '');
      this.projectName.set(name);
      this.loading.set(true);
      await this.reloadContracts();
      this.loading.set(false);
      const hid = this.route.snapshot.queryParamMap.get('highlight');
      if (hid) this.applyHighlight(hid);
      this.subscribeRealtime();
    });

    this.querySub = this.route.queryParamMap.subscribe(qp => {
      if (this.loading()) return;
      const hid = qp.get('highlight');
      if (hid) this.applyHighlight(hid);
    });
  }

  ngOnDestroy() {
    this.paramSub?.unsubscribe();
    this.querySub?.unsubscribe();
    this.realtimeChannel?.unsubscribe();
    clearTimeout(this.highlightTimer);
  }

  private async reloadContracts() {
    const all = await this.supa.loadContracts();
    this.contracts.set(all.filter(c => c.project_name === this.projectName()));
  }

  private subscribeRealtime() {
    this.realtimeChannel?.unsubscribe();
    this.realtimeChannel = this.supa.getClient()
      .channel('detail-payments-' + this.projectName())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payments' }, () => {
        this.reloadContracts();
      })
      .subscribe();
  }

  private applyHighlight(id: string) {
    clearTimeout(this.highlightTimer);
    this.highlightId.set(id);
    setTimeout(() => {
      document.getElementById('client-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    this.highlightTimer = setTimeout(() => this.highlightId.set(null), 3000);
  }

  back() { this.router.navigate(['/payments']); }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  paidCount(c: ContractWithPayments): number { return c.payments.filter(p => p.paid).length; }
  progressWidth(c: ContractWithPayments): string { return `${(this.paidCount(c) / c.payments.length) * 100}%`; }
  fmt(n: number): string { return n.toLocaleString('en-US'); }

  /** نقطة تنبيه على كارد العميل: حمراء لو عنده دفعة متأخرة، صفراء لو عنده دفعة مستحقة اليوم
   *  أو خلال 3 أيام قادمة، وفاضية (بلا نقطة) غير ذلك — الأولوية للمتأخرة. */
  cardDot(c: ContractWithPayments): 'red' | 'yellow' | '' {
    const hasOverdue = c.payments.some(p => !p.paid && daysDiffFromToday(p.due_date) < 0);
    if (hasOverdue) return 'red';
    const hasDueIn3Days = c.payments.some(p => !p.paid && daysDiffFromToday(p.due_date) === 3);
    if (hasDueIn3Days) return 'yellow';
    return '';
  }

  /** رقم التواصل عبر واتساب — يُستخدم رقم الواتساب لو موجود، وإلا يرجع لرقم الجوال تلقائياً */
  clientWhatsApp(c: ContractWithPayments): string {
    const f = c.fields ?? {};
    return (f['whatsapp'] || f['phone'] || f['mobile'] || '').replace(/[\s\-\(\)]/g, '');
  }

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

  /** يبني رقم الهاتف الدولي ونص رسالة التذكير لعميل — مشتركة بين الإرسال الفردي والجماعي */
  private buildWhatsAppMessage(c: ContractWithPayments): { phone: string; text: string } | null {
    const raw = this.clientWhatsApp(c);
    if (!raw) return null;
    const phone = this.toIntlPhone(raw);

    const targetPayment =
      c.payments.find(p => !p.paid && daysDiffFromToday(p.due_date) < 0) ??
      c.payments.find(p => !p.paid);
    if (!targetPayment) return null;

    const unitCode = c.fields?.['unit_code'] ?? '';
    // ملاحظة: نستخدم النص العربي مباشرة عمداً — رسالة الواتساب موجّهة للعميل مباشرة
    // وتبقى عربية دائماً بغضّ النظر عن لغة واجهة الموظف
    const text = buildReminderMessage({
      clientName: c.client_name,
      gender: (c.fields['gender'] as '' | 'male' | 'female') ?? '',
      senderName: this.auth.displayName || 'عبدالرحمن أمين',
      unitCode,
      projectName: this.projectName(),
      installmentNumber: targetPayment.installment_number,
      dueDateFormatted: this.formatDate(targetPayment.due_date),
      diffDays: daysDiffFromToday(targetPayment.due_date),
    });

    return { phone, text };
  }

  // ── Bulk WhatsApp reminders (شبه-جماعي: نافذة تسير على العملاء واحداً واحداً) ───
  waQueue: ContractWithPayments[] = [];
  waQueueIndex = 0;
  waQueueOpen = false;
  waSentCount = 0;

  get waQueueCurrent(): ContractWithPayments | null {
    return this.waQueue[this.waQueueIndex] ?? null;
  }

  startWhatsAppReminders(): void {
    this.waQueue = this.contracts().filter(c =>
      c.payments.some(p => !p.paid && daysDiffFromToday(p.due_date) < 0) && !!this.clientWhatsApp(c)
    );
    if (!this.waQueue.length) {
      this.toast.info(this.transloco.translate('detail.noWaClients'), this.transloco.translate('detail.noWaClientsSub'));
      return;
    }
    this.waQueueIndex = 0;
    this.waSentCount = 0;
    this.waQueueOpen = true;
  }

  /** يفتح واتساب للعميل الحالي في تبويب جديد (بلا مغادرة الصفحة) وينتقل تلقائياً للتالي */
  sendCurrentWhatsApp(): void {
    const c = this.waQueueCurrent;
    if (!c) return;
    const built = this.buildWhatsAppMessage(c);
    if (built) {
      window.open(`https://wa.me/${built.phone}?text=${encodeURIComponent(built.text)}`, '_blank');
      this.waSentCount++;
    }
    this.advanceWhatsAppQueue();
  }

  skipCurrentWhatsApp(): void {
    this.advanceWhatsAppQueue();
  }

  private advanceWhatsAppQueue(): void {
    if (this.waQueueIndex < this.waQueue.length - 1) {
      this.waQueueIndex++;
    } else {
      this.toast.success(this.transloco.translate('detail.waDoneToast'), this.transloco.translate('detail.waDoneSub', { count: this.waSentCount }));
      this.closeWhatsAppQueue();
    }
  }

  closeWhatsAppQueue(): void {
    this.waQueueOpen = false;
    this.waQueue = [];
    this.waQueueIndex = 0;
  }

  formatDate(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  /** ينتقل لصفحة تفاصيل العميل (قائمة الدفعات الكاملة والإجراءات الخاصة به) */
  openClient(c: ContractWithPayments): void {
    this.router.navigate(['/payments', this.projectName(), 'client', c.id]);
  }
}
