import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { IconComponent } from '../../core/icon/icon.component';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import * as XLSX from 'xlsx';

type Tab = 'contracts' | 'notifications';

interface DynamicField {
  varName: string;
  label: string;
  value: string;
  error: boolean;
}

interface PreviewRow {
  key: string;
  value: string;
  isHeader?: boolean;
}

const RESERVED = new Set([
  'unit_price', 'first_payment', 'contract_date',
  'unit_price_text', 'remaining_text',
  'p1_amount', 'p2_amount', 'p3_amount', 'p4_amount', 'p5_amount', 'p6_amount',
  'p1_date', 'p2_date', 'p3_date', 'p4_date', 'p5_date', 'p6_date',
]);

const INSTALL_PCT = [0.20, 0.20, 0.20, 0.20, 0.15, 0.05];
const INSTALL_MONTHS = [0, 3, 6, 9, 12, 15];
const INSTALL_NAMES_AR = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة'];
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** كلمات عناوين الأعمدة المعروفة (عربي/إنجليزي) — تُستخدم للتعرّف على صف العناوين الحقيقي
 *  في ملف الإكسل بدل الاعتماد على عدد الخلايا المملوءة، لأن صف عناوين قد يحتوي عمداً على
 *  خلية فارغة واحدة (عمود غير مستخدم) فيبدو "أقل امتلاءً" من صفوف البيانات نفسها */
const HEADER_KEYWORDS = [
  'name', 'اسم العميل', 'الاسم', 'client_name', 'اسم المشتري', 'اسم',
  'unit_price', 'السعر', 'سعر الوحدة', 'قيمة العقد', 'price', 'إجمالي السعر', 'اجمالي السعر',
  'first_payment', 'الدفعة الأولى', 'دفعة أولى', 'دفعة مقدمة', 'مقدم', 'الدفعة المقدمة',
  'contract_date', 'تاريخ العقد', 'التاريخ', 'تاريخ', 'تاريخ التعاقد',
  'unit_code', 'رقم الوحدة', 'id', 'رقم الهوية', 'natonal', 'الجنسية', 'phone', 'رقم الهاتف',
  'area', 'المساحة الإجمالية', 'floor', 'رقم الطابق', 'email', 'mail', 'البريد الإلكتروني',
  'address', 'العنوان الوطني',
];

const LABEL_MAP: Record<string, string> = {
  name: 'اسم المشتري',
  natonal: 'الجنسية',
  id: 'رقم الهوية',
  phone: 'رقم الهاتف',
  address: 'العنوان الوطني',
  mail: 'البريد الإلكتروني',
  unit_code: 'رقم الوحدة',
  floor: 'رقم الطابق',
  area: 'المساحة الإجمالية',
};

@Component({
  selector: 'app-generate',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, TranslocoModule],
  templateUrl: './generate.component.html',
})
export class GenerateComponent implements OnInit {
  private supa = inject(SupabaseService);
  private toast = inject(ToastService);
  private transloco = inject(TranslocoService);
  activeTab: Tab = 'contracts';
  cSaving = false;
  cSaveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';

  // ── Projects list ──────────────────────────────────────────────────────────────
  projectNames: string[] = [];
  selectedProject = '';

  async ngOnInit() {
    const projects = await this.supa.loadProjects();
    this.projectNames = projects.map(p => p.name);
  }

  // ── Contracts ──────────────────────────────────────────────────────────────────
  cTemplateFile: File | null = null;
  cTemplateName = '';
  cDynamicFields: DynamicField[] = [];
  cUnitPrice: any = '';
  cFirstPayment: any = '';
  cContractDate = '';
  cPreviewRows: PreviewRow[] = [];
  cShowPreview = false;
  cIsDragOver = false;
  cError = ''; // kept for cSaveStatus='error' display
  cGenerating = false;

  cUnitPriceError = false;
  cFirstPaymentError = false;
  cContractDateError = false;
  cProjectError = false;

  cExcelFile: File | null = null;
  cExcelRows: any[] = [];
  cExcelCols: string[] = [];
  cExcelName = '';
  cIsDragOverExcel = false;

  cNotifFile: File | null = null;
  cNotifName = '';
  cIsDragOverNotif = false;
  cBulkGenerating = false;
  cBulkStatus = '';

  // ── Notifications ──────────────────────────────────────────────────────────────
  nTemplateFile: File | null = null;
  nTemplateName = '';
  nDynamicFields: DynamicField[] = [];
  nIsDragOver = false;
  nError = '';
  nGenerating = false;

  nExcelFile: File | null = null;
  nExcelRows: any[] = [];
  nExcelCols: string[] = [];
  nExcelName = '';
  nIsDragOverExcel = false;
  nBulkGenerating = false;
  nBulkStatus = '';

  @ViewChild('cFileInput') cFileInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('cExcelInput') cExcelInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('cNotifInput') cNotifInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('nFileInput') nFileInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('nExcelInput') nExcelInputRef!: ElementRef<HTMLInputElement>;

  // ── Arabic utilities ────────────────────────────────────────────────────────────
  private toArabicWords(n: number): string {
    n = Math.round(n);
    if (n === 0) return 'صفر';
    const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
      'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
      'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
    const tens = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
    const hundreds = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

    const belowThousand = (num: number): string => {
      if (num === 0) return '';
      const parts: string[] = [];
      const h = Math.floor(num / 100);
      const rem = num % 100;
      if (h > 0) parts.push(hundreds[h]);
      if (rem > 0) {
        if (rem < 20) parts.push(ones[rem]);
        else {
          const t = Math.floor(rem / 10), u = rem % 10;
          parts.push(u > 0 ? ones[u] + ' و' + tens[t] : tens[t]);
        }
      }
      return parts.join(' و');
    };

    const parts: string[] = [];
    const mil = Math.floor(n / 1_000_000); n %= 1_000_000;
    if (mil === 1) parts.push('مليون');
    else if (mil === 2) parts.push('مليونان');
    else if (mil >= 3 && mil <= 10) parts.push(ones[mil] + ' ملايين');
    else if (mil > 10) parts.push(belowThousand(mil) + ' مليون');

    const thou = Math.floor(n / 1000); n %= 1000;
    if (thou === 1) parts.push('ألف');
    else if (thou === 2) parts.push('ألفان');
    else if (thou >= 3 && thou <= 10) parts.push(ones[thou] + ' آلاف');
    else if (thou >= 11 && thou <= 99) parts.push(belowThousand(thou) + ' ألفاً');
    else if (thou >= 100) parts.push(belowThousand(thou) + ' ألف');

    if (n > 0) parts.push(belowThousand(n));
    return parts.join(' و');
  }

  private parseISO(val: string): Date {
    const [y, m, d] = val.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  private parseAnyDate(val: string): Date | null {
    val = val.trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(val)) {
      const [y, m, d] = val.split('-').map(Number);
      return this.safeDate(y, m, d);
    }
    if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(val)) {
      const parts = val.split(/[\/\-.]/);
      const a = Number(parts[0]), b = Number(parts[1]);
      // سنة من رقمين (مثل 26) تُفهم كـ 2026
      const y = parts[2].length <= 2 ? 2000 + Number(parts[2]) : Number(parts[2]);
      // نفترض يوم/شهر/سنة (الشائع محلياً)، وإن كان غير صالح نجرّب شهر/يوم/سنة
      return this.safeDate(y, b, a) || this.safeDate(y, a, b);
    }
    // Excel date serial (e.g. 45292)
    if (/^\d{5}$/.test(val)) {
      const d = new Date(Math.round((Number(val) - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  /** يطبّع مفتاحاً (اسم عمود) للمقارنة بلا حساسية لحالة الأحرف أو المسافات/الشرطات السفلية
   *  أو الأحرف غير المرئية (علامات اتجاه، مسافات غير فاصلة) الشائعة في ملفات إكسل العربية */
  private normKey(s: string): string {
    return s
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00A0]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_\-]+/g, '');
  }

  /** يبحث عن قيمة صف بمطابقة متسامحة عبر عدّة أسماء أعمدة محتملة (بدائل عربية/إنجليزية) */
  private pickRow(row: Record<string, string>, aliases: string[]): string {
    const normalized = new Map<string, string>();
    for (const k of Object.keys(row)) normalized.set(this.normKey(k), row[k]);
    for (const a of aliases) {
      const v = normalized.get(this.normKey(a));
      if (v !== undefined && v.trim() !== '') return v.trim();
    }
    return '';
  }

  private safeDate(y: number, m: number, d: number): Date | null {
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  private addMonths(date: Date, months: number): Date {
    const d = new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
    if (d.getDate() !== date.getDate()) d.setDate(0);
    return d;
  }

  private fmt(date: Date): string {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  }

  private fmtAmt(n: number): string {
    return Math.round(n).toLocaleString('en-US');
  }

  private labelFor(v: string): string {
    return LABEL_MAP[v] ?? v.replace(/_/g, ' ');
  }

  // ── Template parsing ────────────────────────────────────────────────────────────
  private async parseDocxVars(file: File, filterReserved: boolean): Promise<string[]> {
    const buf = await file.arrayBuffer();
    const zip = new PizZip(buf);
    const tags = new Set<string>();
    const VALID = /^[؀-ۿa-zA-Z_][؀-ۿa-zA-Z0-9_ \-]*$/;
    for (const f of ['word/document.xml', 'word/header1.xml', 'word/footer1.xml', 'word/header2.xml', 'word/footer2.xml']) {
      if (!zip.files[f]) continue;
      const xml: string = (zip.files[f] as any).asText().replace(/<[^>]+>/g, '');
      for (const m of xml.matchAll(/\{\{([^}]{1,80})\}\}/g)) {
        const name = m[1].trim();
        if (VALID.test(name)) tags.add(name);
      }
    }
    const all = [...tags];
    return filterReserved ? all.filter(t => !RESERVED.has(t)) : all;
  }

  private toFields(vars: string[]): DynamicField[] {
    return vars.map(v => ({ varName: v, label: this.labelFor(v), value: '', error: false }));
  }

  // ── Contracts: template upload ──────────────────────────────────────────────────
  cDragOver(e: DragEvent) { e.preventDefault(); this.cIsDragOver = true; }
  cDragLeave() { this.cIsDragOver = false; }
  cDrop(e: DragEvent) { e.preventDefault(); this.cIsDragOver = false; const f = e.dataTransfer?.files[0]; if (f) this.handleContractFile(f); }
  cFileChange(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) this.handleContractFile(f); }
  cClickUpload() { this.cFileInputRef.nativeElement.click(); }

  async handleContractFile(file: File) {
    if (!file.name.endsWith('.docx')) { this.toast.error(this.transloco.translate('generate.chooseWordDocx')); return; }
    this.cTemplateFile = file;
    this.cTemplateName = file.name;
    try {
      this.cDynamicFields = this.toFields(await this.parseDocxVars(file, true));
      this.updatePreview();
    } catch (err: any) {
      this.toast.error(this.transloco.translate('generate.templateReadError') + (err.message || err));
      this.cTemplateFile = null; this.cTemplateName = '';
    }
  }

  clearContractTemplate() {
    this.cTemplateFile = null; this.cTemplateName = '';
    this.cDynamicFields = []; this.cUnitPrice = ''; this.cFirstPayment = ''; this.cContractDate = '';
    this.cPreviewRows = []; this.cShowPreview = false;
    this.cExcelFile = null; this.cExcelRows = []; this.cExcelCols = []; this.cExcelName = '';
    this.cNotifFile = null; this.cNotifName = ''; this.cBulkStatus = '';
    if (this.cFileInputRef) this.cFileInputRef.nativeElement.value = '';
    if (this.cExcelInputRef) this.cExcelInputRef.nativeElement.value = '';
    if (this.cNotifInputRef) this.cNotifInputRef.nativeElement.value = '';
  }

  // ── Contracts: computed values / preview ────────────────────────────────────────
  private computeReserved(unitPrice: number, firstPayment: number, baseDate: Date | null): Record<string, string> {
    const d: Record<string, string> = {};
    d['unit_price'] = this.fmtAmt(unitPrice);
    d['first_payment'] = this.fmtAmt(firstPayment);
    d['contract_date'] = baseDate ? this.fmt(baseDate) : '';
    d['unit_price_text'] = this.toArabicWords(unitPrice) + ' ريال سعودي';
    d['remaining_text'] = this.toArabicWords(Math.max(0, unitPrice - firstPayment)) + ' ريال سعودي';
    for (let i = 0; i < 6; i++) {
      d[`p${i + 1}_amount`] = this.fmtAmt(unitPrice * INSTALL_PCT[i]);
      d[`p${i + 1}_date`] = baseDate ? this.fmt(this.addMonths(baseDate, INSTALL_MONTHS[i])) : '';
    }
    return d;
  }

  updatePreview() {
    if (!this.cTemplateFile || !this.cUnitPrice || !this.cFirstPayment || !this.cContractDate) {
      this.cShowPreview = false; return;
    }
    const up = parseFloat(this.cUnitPrice) || 0;
    const fp = parseFloat(this.cFirstPayment) || 0;
    const bd = this.parseISO(this.cContractDate);
    const res = this.computeReserved(up, fp, bd);
    const rows: PreviewRow[] = [
      { key: this.transloco.translate('generate.previewWordsSection'), value: '', isHeader: true },
      { key: '{{unit_price_text}}', value: res['unit_price_text'] },
      { key: '{{remaining_text}}', value: res['remaining_text'] },
      { key: this.transloco.translate('generate.previewInstallmentsSection'), value: '', isHeader: true },
    ];
    for (let i = 1; i <= 6; i++) {
      rows.push({ key: `{{p${i}_amount}}`, value: res[`p${i}_amount`] });
      rows.push({ key: `{{p${i}_date}}`, value: res[`p${i}_date`] });
    }
    this.cPreviewRows = rows;
    this.cShowPreview = true;
  }

  // ── Contracts: generate ─────────────────────────────────────────────────────────
  async generateContract() {
    if (!this.cTemplateFile) return;
    this.cUnitPriceError = !this.cUnitPrice;
    this.cFirstPaymentError = this.cFirstPayment === '' || this.cFirstPayment === null || this.cFirstPayment === undefined;
    this.cContractDateError = !String(this.cContractDate).trim();
    this.cProjectError = !this.selectedProject;
    this.cDynamicFields.forEach(f => { f.error = !f.value.trim(); });
    const valid = !this.cUnitPriceError && !this.cFirstPaymentError && !this.cContractDateError
      && !this.cProjectError && this.cDynamicFields.every(f => !f.error);
    if (!valid) {
      const missing: string[] = [];
      if (this.cUnitPriceError) missing.push(this.transloco.translate('generate.unitPrice'));
      if (this.cFirstPaymentError) missing.push(this.transloco.translate('generate.firstPayment'));
      if (this.cContractDateError) missing.push(this.transloco.translate('generate.contractDate'));
      if (this.cProjectError) missing.push(this.transloco.translate('generate.project'));
      if (this.cDynamicFields.some(f => f.error)) missing.push(this.transloco.translate('generate.templateFields'));
      this.toast.error(this.transloco.translate('generate.emptyFieldsPrefix') + missing.join(' · '));
      return;
    }

    this.cGenerating = true;
    try {
      const up = parseFloat(this.cUnitPrice) || 0;
      const fp = parseFloat(this.cFirstPayment) || 0;
      const bd = this.parseISO(this.cContractDate);
      const reserved = this.computeReserved(up, fp, bd);
      const dynamic: Record<string, string> = {};
      this.cDynamicFields.forEach(f => { dynamic[f.varName] = f.value.trim(); });
      const data = this.normalizeFields({ ...dynamic, ...reserved });

      // تطبيع الحقول الأساسية للحفظ في Supabase
      const savedFields = this.normalizeFields(dynamic);

      // ── التحقق من التكرار أولاً — قبل توليد أي ملف ─────────────────────────────
      const dup = await this.supa.checkDuplicate(
        this.selectedProject, dynamic['name'] || '', dynamic['unit_code'] || ''
      );
      if (dup) {
        this.toast.error(this.transloco.translate(dup === 'name' ? 'generate.nameTakenNoContract' : 'generate.unitTakenNoContract'));
        this.cGenerating = false;
        return;
      }

      const templateBuf = await this.cTemplateFile.arrayBuffer();
      const fileLabel = [data['unit_code'], data['name']].filter(Boolean).map((s: string) => s.replace(/\s+/g, '_')).join('_') || 'عقد';

      if (this.cNotifFile) {
        // Pack contract + notifications into a single ZIP
        const notifBuf = await this.cNotifFile.arrayBuffer();
        const outputZip = new PizZip();
        outputZip.file(`عقد_${fileLabel}.docx`, this.renderDocx(templateBuf, data));
        for (let pi = 2; pi <= 6; pi++) {
          const notifData = { ...data, p_amount: reserved[`p${pi}_amount`], p_date: reserved[`p${pi}_date`], p_name: INSTALL_NAMES_AR[pi] };
          outputZip.file(`اشعار_الدفعة_${INSTALL_NAMES_AR[pi]}.docx`, this.renderDocx(notifBuf, notifData));
        }
        const zipBlob = outputZip.generate({ type: 'blob', mimeType: 'application/zip' });
        this.downloadBlob(zipBlob, `${fileLabel}.zip`);
      } else {
        const out = this.renderDocx(templateBuf, data);
        this.downloadBlob(new Blob([out], { type: DOCX_MIME }), `عقد_${fileLabel}.docx`);
      }

      // ── حفظ في Supabase ──────────────────────────────────────────────────────
      this.cSaveStatus = 'saving';
      const projectName = this.selectedProject;
      const clientName = dynamic['name'] || '';
      const installments = Array.from({ length: 6 }, (_, i) => ({
        amount: parseFloat(reserved[`p${i + 1}_amount`].replace(/,/g, '')) || 0,
        dueDate: this.isoFromDisplay(reserved[`p${i + 1}_date`]),
      }));
      const result = await this.supa.saveContract({
        projectName,
        clientName,
        unitPrice: up,
        firstPayment: fp,
        contractDate: this.cContractDate,
        fields: savedFields,
        installments,
      });
      this.cSaveStatus = 'error' in result ? 'error' : 'saved';
      if ('error' in result) this.toast.error(this.transloco.translate('generate.dbSaveError') + result.error);
      setTimeout(() => { this.cSaveStatus = 'idle'; }, 3000);
    } catch (err: any) {
      this.toast.error(this.transloco.translate('generate.templateProcessError') + (err.message || err));
    }
    this.cGenerating = false;
  }

  private isoFromDisplay(display: string): string {
    if (!display) return '';
    // display format: DD/MM/YYYY
    const [d, m, y] = display.split('/');
    if (!d || !m || !y) return display;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // ── Contracts: notification template (for bulk) ─────────────────────────────────
  cNotifDragOver(e: DragEvent) { e.preventDefault(); this.cIsDragOverNotif = true; }
  cNotifDragLeave() { this.cIsDragOverNotif = false; }
  cNotifDrop(e: DragEvent) { e.preventDefault(); this.cIsDragOverNotif = false; const f = e.dataTransfer?.files[0]; if (f) this.handleNotifFile(f); }
  cNotifChange(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) this.handleNotifFile(f); }
  cClickNotif() { this.cNotifInputRef?.nativeElement.click(); }

  handleNotifFile(file: File) {
    if (!file.name.endsWith('.docx')) { this.toast.error(this.transloco.translate('generate.notifTemplateMustBeDocx')); return; }
    this.cNotifFile = file; this.cNotifName = file.name;
  }

  clearNotifFile() { this.cNotifFile = null; this.cNotifName = ''; if (this.cNotifInputRef) this.cNotifInputRef.nativeElement.value = ''; }

  // ── Excel parsing ───────────────────────────────────────────────────────────────
  private parseExcel(file: File, extraKeywords: string[] = []): Promise<{ rows: any[]; cols: string[]; sheetNames: string[]; usedSheet: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array', cellDates: true });
          // نختار أول ورقة تحتوي بيانات فعلية بدل الاعتماد دائماً على الورقة الأولى بصمت،
          // حتى لا تختفي بيانات مشروع جديد أضافه المستخدم في ورقة أخرى ضمن نفس الملف
          let usedSheetName = wb.SheetNames[0];
          let raw: any[][] = [];
          for (const sn of wb.SheetNames) {
            const candidate: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
            const hasData = candidate.some(r => r.some((c: any) => String(c).trim() !== ''));
            if (hasData) { raw = candidate; usedSheetName = sn; break; }
          }
          // نبحث عن صف العناوين ضمن أول 15 صفاً بالتعرّف على كلمات عناوين معروفة (name, unit_price...)
          // بدل عدّ الخلايا المملوءة: صف عناوين قد يتعمّد ترك عمود بلا اسم (فيبدو "أقل امتلاءً" من
          // صفوف البيانات المكتملة تماماً)، فيؤدي عدّ الخلايا لاختيار صف بيانات خطأً كصف عناوين
          const keywordSet = new Set([...HEADER_KEYWORDS, ...extraKeywords].map(k => this.normKey(k)));
          let hi = -1;
          const scanRows = Math.min(raw.length, 15);
          let bestScore = 0;
          for (let r = 0; r < scanRows; r++) {
            const nonEmpty = raw[r].map((c: any) => String(c).trim()).filter((c: string) => c !== '');
            const score = nonEmpty.filter((c: string) => keywordSet.has(this.normKey(c))).length;
            if (score > bestScore) { bestScore = score; hi = r; }
          }
          if (hi === -1) {
            // لم نتعرّف على أي عمود معروف — رجوع احتياطي للصف الأكثر امتلاءً بالخلايا
            let bestCount = 0;
            for (let r = 0; r < scanRows; r++) {
              const count = raw[r].filter((c: any) => String(c).trim() !== '').length;
              if (count > bestCount) { bestCount = count; hi = r; }
            }
          }
          if (hi === -1) { resolve({ rows: [], cols: [], sheetNames: wb.SheetNames, usedSheet: usedSheetName }); return; }
          const cols = raw[hi].map((h: any) => String(h).trim());
          const rows: any[] = [];
          for (let i = hi + 1; i < raw.length; i++) {
            const row = raw[i];
            if (row.every((c: any) => String(c).trim() === '')) continue;
            const obj: Record<string, string> = {};
            cols.forEach((col, ci) => { obj[col] = String(row[ci] ?? '').trim(); });
            rows.push(obj);
          }
          resolve({ rows, cols, sheetNames: wb.SheetNames, usedSheet: usedSheetName });
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  // ── Contracts: Excel upload ─────────────────────────────────────────────────────
  cExcelDragOver(e: DragEvent) { e.preventDefault(); this.cIsDragOverExcel = true; }
  cExcelDragLeave() { this.cIsDragOverExcel = false; }
  cExcelDrop(e: DragEvent) { e.preventDefault(); this.cIsDragOverExcel = false; const f = e.dataTransfer?.files[0]; if (f) this.handleContractExcel(f); }
  cExcelChange(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) this.handleContractExcel(f); }
  cClickExcel() { this.cExcelInputRef?.nativeElement.click(); }

  async handleContractExcel(file: File) {
    if (!file.name.match(/\.(xlsx|xls)$/i)) { this.toast.error(this.transloco.translate('detail.unsupportedFileSub')); return; }
    try {
      const extraKeywords = this.cDynamicFields.flatMap(f => [f.varName, f.label]);
      const { rows, cols, sheetNames, usedSheet } = await this.parseExcel(file, extraKeywords);
      this.cExcelFile = file; this.cExcelName = file.name; this.cExcelRows = rows; this.cExcelCols = cols;
      if (!rows.length) {
        this.toast.error(
          this.transloco.translate('generate.noValidExcelData'),
          sheetNames.length > 1 ? this.transloco.translate('generate.sheetsFoundPrefix') + sheetNames.join('، ') : undefined
        );
      } else if (sheetNames.length > 1) {
        this.toast.info(
          this.transloco.translate('generate.readRowsFromSheet', { rows: rows.length, sheet: usedSheet }),
          this.transloco.translate('generate.remainingSheetsNotRead', { sheets: sheetNames.filter(s => s !== usedSheet).join('، ') })
        );
      }
    } catch (err: any) { this.toast.error(this.transloco.translate('generate.excelReadError') + (err.message || err)); }
  }

  clearContractExcel() { this.cExcelFile = null; this.cExcelName = ''; this.cExcelRows = []; this.cExcelCols = []; if (this.cExcelInputRef) this.cExcelInputRef.nativeElement.value = ''; }

  // ── Contracts: bulk generation ──────────────────────────────────────────────────
  async bulkGenerate() {
    if (!this.selectedProject) {
      this.cProjectError = true;
      this.cError = this.transloco.translate('detail.pickProjectFirst');
      this.toast.error(this.transloco.translate('detail.pickProjectFirst'));
      return;
    }
    if (!this.cTemplateFile || !this.cExcelRows.length) return;
    this.cBulkGenerating = true;
    try {
      const outputZip = new PizZip();
      const templateBuf = await this.cTemplateFile.arrayBuffer();
      const notifBuf = this.cNotifFile ? await this.cNotifFile.arrayBuffer() : null;
      const total = this.cExcelRows.length;

      const projectName = this.selectedProject;

      let skippedIncomplete = 0;
      let duplicateSkipped = 0;
      const missCounts = { name: 0, unit_price: 0, contract_date: 0 };
      const duplicateDetails: { name: string; reason: string }[] = [];
      for (let i = 0; i < total; i++) {
        const row = this.cExcelRows[i];
        const up = parseFloat(this.pickRow(row, ['unit_price', 'السعر', 'سعر الوحدة', 'قيمة العقد', 'price', 'إجمالي السعر', 'اجمالي السعر', 'سعر']).replace(/,/g, '')) || 0;
        const fp = parseFloat(this.pickRow(row, ['first_payment', 'الدفعة الأولى', 'دفعة أولى', 'دفعة مقدمة', 'مقدم', 'الدفعة المقدمة']).replace(/,/g, '')) || 0;
        const bd = this.parseAnyDate(this.pickRow(row, ['contract_date', 'تاريخ العقد', 'التاريخ', 'تاريخ', 'تاريخ التعاقد']));
        const dynamic: Record<string, string> = {};
        // نطابق كل حقل ديناميكي باسم متغيّره (varName) وأيضاً بتسميته العربية المعروضة فعلياً
        // في الواجهة (f.label)، حتى لو استخدم المستخدم عنوان العمود الظاهر له بدل اسم المتغيّر الخام
        this.cDynamicFields.forEach(f => { dynamic[f.varName] = this.pickRow(row, [f.varName, f.label]); });

        // ── تخطّي الصفوف الناقصة (اسم + سعر + تاريخ فقط) ──────────────────
        const clientName = dynamic['name'] || this.pickRow(row, ['name', 'اسم العميل', 'الاسم', 'client_name', 'اسم المشتري', 'اسم']);
        if (!up || !bd || !clientName) {
          skippedIncomplete++;
          if (!clientName) missCounts.name++;
          if (!up) missCounts.unit_price++;
          if (!bd) missCounts.contract_date++;
          const miss = [
            !clientName && this.transloco.translate('generate.shortName'),
            !up && this.transloco.translate('generate.shortPrice'),
            !bd && this.transloco.translate('generate.shortDate'),
          ].filter(Boolean).join('، ');
          this.cBulkStatus = this.transloco.translate('generate.rowSkippedIncomplete', { i: i + 1, total, miss });
          continue;
        }
        dynamic['name'] = clientName;

        const reserved = this.computeReserved(up, fp, bd);
        const data = this.normalizeFields({ ...row, ...dynamic, ...reserved });

        // ── التحقق من التكرار أولاً — قبل توليد أي ملف للصف ─────────────────
        const dup = await this.supa.checkDuplicate(
          projectName, data['name'] || '', data['unit_code'] || ''
        );
        if (dup) {
          duplicateSkipped++;
          const reason = this.transloco.translate(dup === 'name' ? 'generate.dupNameShort' : 'generate.dupUnitShort');
          duplicateDetails.push({ name: data['name'] || '', reason });
          this.cBulkStatus = this.transloco.translate('generate.clientSkippedDup', { i: i + 1, total, reason });
          continue;
        }

        const clientSlug = (data['name'] || '').replace(/\s+/g, '_');
        const unitCode = (data['unit_code'] || '').replace(/\s+/g, '_');
        const num = String(i + 1).padStart(3, '0');
        const label = [unitCode, clientSlug].filter(Boolean).join('_') || num;
        const folder = `${num}_${label}/`;

        // ── توليد العقد والإشعارات ───────────────────────────────────────────
        this.cBulkStatus = this.transloco.translate('generate.clientGeneratingContract', { i: i + 1, total });
        outputZip.file(folder + `${num}_عقد_${label}.docx`, this.renderDocx(templateBuf, data));

        if (notifBuf) {
          for (let pi = 2; pi <= 6; pi++) {
            this.cBulkStatus = this.transloco.translate('generate.clientGeneratingNotif', { i: i + 1, total, name: INSTALL_NAMES_AR[pi] });
            const notifData = { ...data, p_amount: reserved[`p${pi}_amount`], p_date: reserved[`p${pi}_date`], p_name: INSTALL_NAMES_AR[pi] };
            outputZip.file(folder + `اشعار_الدفعة_${INSTALL_NAMES_AR[pi]}.docx`, this.renderDocx(notifBuf, notifData));
          }
        }

        // ── حفظ في Supabase ──────────────────────────────────────────────────
        this.cBulkStatus = this.transloco.translate('generate.clientSavingPayments', { i: i + 1, total });
        const contractDateIso = bd
          ? `${bd.getFullYear()}-${String(bd.getMonth() + 1).padStart(2, '0')}-${String(bd.getDate()).padStart(2, '0')}`
          : '';
        const installments = Array.from({ length: 6 }, (_, idx) => ({
          amount: parseFloat(String(reserved[`p${idx + 1}_amount`] || '0').replace(/,/g, '')) || 0,
          dueDate: this.isoFromDisplay(reserved[`p${idx + 1}_date`]),
        }));
        const saveResult = await this.supa.saveContract({
          projectName,
          clientName: data['name'] || '',
          unitPrice: up,
          firstPayment: fp,
          contractDate: contractDateIso,
          fields: this.normalizeFields(dynamic, row),
          installments,
        });
        if ('error' in saveResult) {
          console.error(`[Supabase] عميل ${i + 1}:`, saveResult.error);
        }
      }

      const generated = total - skippedIncomplete - duplicateSkipped;

      if (generated === 0) {
        // كل الصفوف اتخطّت (بيانات ناقصة أو تكرار) — لا نعمّل تنزيل ZIP فارغ بصمت
        const parts: string[] = [];
        if (skippedIncomplete) parts.push(this.transloco.translate('generate.missingDataCount', { count: skippedIncomplete }));
        if (duplicateSkipped) parts.push(this.transloco.translate('generate.alreadyExistsCount', { count: duplicateSkipped }));
        this.cBulkStatus = this.transloco.translate('generate.noContractGeneratedStatus', { parts: parts.join(' · ') });
        this.toast.error(this.transloco.translate('generate.noContractGenerated'), parts.join(' · '));
        this.cBulkGenerating = false;
        return;
      }

      const zipBlob = outputZip.generate({ type: 'blob', mimeType: 'application/zip' });
      const fname = notifBuf ? `عقود_واشعارات_${generated}_عميل.zip` : `عقود_${generated}_عميل.zip`;
      this.downloadBlob(zipBlob, fname);
      if (skippedIncomplete > 0 || duplicateSkipped > 0) {
        const parts: string[] = [];
        if (skippedIncomplete) parts.push(this.transloco.translate('generate.missingDataCount', { count: skippedIncomplete }));
        if (duplicateSkipped) parts.push(this.transloco.translate('generate.alreadyExistsCount', { count: duplicateSkipped }));
        this.cBulkStatus = this.transloco.translate('generate.downloadedCountStatus', { count: generated, parts: parts.join(' · ') });
        // رسائل التخطّي تبقى ظاهرة (لا تختفي تلقائياً) لأن المستخدم قد لا يلاحظها خلال ثوانٍ معدودة
        if (skippedIncomplete) {
          const detail = this.transloco.translate('generate.missingDetail', {
            name: missCounts.name, price: missCounts.unit_price, date: missCounts.contract_date,
          });
          this.toast.error(this.transloco.translate('generate.skippedIncompleteToast', { count: skippedIncomplete }), detail);
        }
        if (duplicateSkipped) {
          const names = duplicateDetails.slice(0, 5).map(d => `${d.name} (${d.reason})`).join('، ')
            + (duplicateDetails.length > 5 ? this.transloco.translate('generate.andOthers', { count: duplicateDetails.length - 5 }) : '');
          this.toast.error(this.transloco.translate('generate.duplicateInProjectToast', { count: duplicateSkipped }), names);
        }
      } else {
        this.cBulkStatus = this.transloco.translate('generate.allDownloadedStatus', { count: total });
        setTimeout(() => { this.cBulkStatus = ''; }, 5000);
      }
    } catch (err: any) {
      this.toast.error(this.transloco.translate('generate.generationError') + (err.message || err));
      this.cBulkStatus = '';
    }
    this.cBulkGenerating = false;
  }

  /** تطبيع أسماء الحقول الشائعة إلى مفاتيح إنجليزية موحّدة للحفظ في Supabase */
  private normalizeFields(src: Record<string, string>, extra?: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = { ...src, ...(extra ?? {}) };
    const pick = (keys: string[]) => keys.map(k => out[k] || '').find(Boolean) || '';
    if (!out['email'])     out['email']     = pick(['mail','الايميل','البريد','البريد_الالكتروني','client_email','e_mail']);
    if (!out['mail'])      out['mail']      = out['email'] || '';
    if (!out['unit_code']) out['unit_code'] = pick(['كود_الوحدة','رقم_الوحدة','unitcode','unit']);
    if (!out['phone'])     out['phone']     = pick(['الجوال','الهاتف','mobile','tel']);
    if (!out['name'])      out['name']      = pick(['اسم_العميل','client_name','الاسم']);
    return out;
  }

  private renderDocx(templateBuf: ArrayBuffer, data: Record<string, string>): Uint8Array {
    const zip = new PizZip(templateBuf.slice(0));
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' } });
    doc.render(data);
    return doc.getZip().generate({ type: 'uint8array', mimeType: DOCX_MIME });
  }

  // ── Notifications: template upload ──────────────────────────────────────────────
  nDragOver(e: DragEvent) { e.preventDefault(); this.nIsDragOver = true; }
  nDragLeave() { this.nIsDragOver = false; }
  nDrop(e: DragEvent) { e.preventDefault(); this.nIsDragOver = false; const f = e.dataTransfer?.files[0]; if (f) this.handleNotifTemplate(f); }
  nFileChange(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) this.handleNotifTemplate(f); }
  nClickUpload() { this.nFileInputRef.nativeElement.click(); }

  async handleNotifTemplate(file: File) {
    if (!file.name.endsWith('.docx')) { this.toast.error(this.transloco.translate('generate.chooseWordDocx')); return; }
    this.nTemplateFile = file; this.nTemplateName = file.name;
    try {
      this.nDynamicFields = this.toFields(await this.parseDocxVars(file, false));
    } catch (err: any) {
      this.toast.error(this.transloco.translate('generate.templateReadError') + (err.message || err));
      this.nTemplateFile = null; this.nTemplateName = '';
    }
  }

  clearNotifTemplate() {
    this.nTemplateFile = null; this.nTemplateName = '';
    this.nDynamicFields = []; this.nExcelFile = null; this.nExcelRows = []; this.nExcelCols = []; this.nExcelName = '';
    this.nBulkStatus = '';
    if (this.nFileInputRef) this.nFileInputRef.nativeElement.value = '';
    if (this.nExcelInputRef) this.nExcelInputRef.nativeElement.value = '';
  }

  // ── Notifications: generate single ─────────────────────────────────────────────
  async generateNotif() {
    if (!this.nTemplateFile) return;
    let valid = true;
    this.nDynamicFields.forEach(f => { f.error = !f.value.trim(); if (f.error) valid = false; });
    if (!valid) { this.toast.error(this.transloco.translate('generate.fillRequiredFields')); return; }

    this.nGenerating = true;
    try {
      const data: Record<string, string> = {};
      this.nDynamicFields.forEach(f => { data[f.varName] = f.value.trim(); });
      const buf = await this.nTemplateFile.arrayBuffer();
      const zip = new PizZip(buf);
      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' } });
      doc.render(data);
      const out = doc.getZip().generate({ type: 'blob', mimeType: DOCX_MIME });
      const name = (data['name'] || data['اسم_العميل'] || 'اشعار').replace(/\s+/g, '_');
      this.downloadBlob(out, `اشعار_${name}.docx`);
    } catch (err: any) {
      this.toast.error(this.transloco.translate('generate.templateProcessError') + (err.message || err));
    }
    this.nGenerating = false;
  }

  // ── Notifications: Excel upload ─────────────────────────────────────────────────
  nExcelDragOver(e: DragEvent) { e.preventDefault(); this.nIsDragOverExcel = true; }
  nExcelDragLeave() { this.nIsDragOverExcel = false; }
  nExcelDrop(e: DragEvent) { e.preventDefault(); this.nIsDragOverExcel = false; const f = e.dataTransfer?.files[0]; if (f) this.handleNotifExcel(f); }
  nExcelChange(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) this.handleNotifExcel(f); }
  nClickExcel() { this.nExcelInputRef?.nativeElement.click(); }

  async handleNotifExcel(file: File) {
    if (!file.name.match(/\.(xlsx|xls)$/i)) { this.toast.error(this.transloco.translate('detail.unsupportedFileSub')); return; }
    try {
      const extraKeywords = this.nDynamicFields.flatMap(f => [f.varName, f.label]);
      const { rows, cols, sheetNames, usedSheet } = await this.parseExcel(file, extraKeywords);
      this.nExcelFile = file; this.nExcelName = file.name; this.nExcelRows = rows; this.nExcelCols = cols;
      if (!rows.length) {
        this.toast.error(
          this.transloco.translate('generate.noValidExcelData'),
          sheetNames.length > 1 ? this.transloco.translate('generate.sheetsFoundPrefix') + sheetNames.join('، ') : undefined
        );
      } else if (sheetNames.length > 1) {
        this.toast.info(
          this.transloco.translate('generate.readRowsFromSheet', { rows: rows.length, sheet: usedSheet }),
          this.transloco.translate('generate.remainingSheetsNotRead', { sheets: sheetNames.filter(s => s !== usedSheet).join('، ') })
        );
      }
    } catch (err: any) { this.toast.error(this.transloco.translate('generate.excelReadError') + (err.message || err)); }
  }

  clearNotifExcel() { this.nExcelFile = null; this.nExcelName = ''; this.nExcelRows = []; this.nExcelCols = []; if (this.nExcelInputRef) this.nExcelInputRef.nativeElement.value = ''; }

  // ── Notifications: bulk generation ─────────────────────────────────────────────
  async bulkGenerateNotif() {
    if (!this.nTemplateFile || !this.nExcelRows.length) return;
    this.nBulkGenerating = true;
    try {
      const outputZip = new PizZip();
      const templateBuf = await this.nTemplateFile.arrayBuffer();
      const total = this.nExcelRows.length;

      for (let i = 0; i < total; i++) {
        this.nBulkStatus = this.transloco.translate('generate.generatingProgress', { i: i + 1, total });
        const row = this.nExcelRows[i];
        const data: Record<string, string> = {};
        this.nDynamicFields.forEach(f => { data[f.varName] = this.pickRow(row, [f.varName, f.label]); });
        const out = this.renderDocx(templateBuf, data);
        const clientName = (data['name'] || data['اسم_العميل'] || '').replace(/\s+/g, '_');
        const unitCode = (data['unit_code'] || data['كود_الوحدة'] || '').replace(/\s+/g, '_');
        const num = String(i + 1).padStart(3, '0');
        outputZip.file(`${num}_اشعار_${[unitCode, clientName].filter(Boolean).join('_') || 'عقد'}.docx`, out);
      }

      const zipBlob = outputZip.generate({ type: 'blob', mimeType: 'application/zip' });
      this.downloadBlob(zipBlob, `اشعارات_${total}_ملف.zip`);
      this.nBulkStatus = this.transloco.translate('generate.allFilesDownloaded', { count: total });
      setTimeout(() => { this.nBulkStatus = ''; }, 4000);
    } catch (err: any) {
      this.toast.error(this.transloco.translate('generate.generationError') + (err.message || err));
      this.nBulkStatus = '';
    }
    this.nBulkGenerating = false;
  }

  // ── Utility ─────────────────────────────────────────────────────────────────────
  private downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
