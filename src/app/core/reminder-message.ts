import { daysDiffFromToday } from './date-utils';

/** رسالة التذكير الموحّدة (واتساب + إيميل) — نص واحد يضم كل الدفعات المستحقة للعميل بتفاصيل كل دفعة
 *  (المبلغ، الموعد، الحالة، وما دُفع منها وما تبقى لو كانت مدفوعة جزئياً)، ويُبنى حسب جنس العميل. */

/** الدفعات تدخل في رسالة التذكير فقط لو متبقٍّ على استحقاقها هذا العدد من الأيام أو أقل (والمتأخرة طبعاً) */
export const REMINDER_WINDOW_DAYS = 20;

export interface ReminderPayment {
  /** رقم القسط (1، 2، 3...) — يُحوَّل داخلياً لصيغة عربية ("الدفعة الأولى"، "الدفعة الثانية"...) */
  installmentNumber: number;
  /** قيمة الدفعة */
  amount: number;
  /** ما دُفع منها حتى الآن (0 لو لم يُدفع شيء) */
  paidAmount: number;
  /** تاريخ الاستحقاق بصيغة dd/mm/yyyy */
  dueDateFormatted: string;
  /** الفرق بالأيام بين اليوم وتاريخ الاستحقاق — سالب يعني متأخرة، صفر يعني اليوم، موجب يعني لسه لم تحن */
  diffDays: number;
}

export interface ReminderMessageInput {
  clientName: string;
  gender: '' | 'male' | 'female';
  senderName: string;
  unitCode: string;
  projectName: string;
  /** الدفعات المطلوب التذكير بها، مرتبة بتاريخ الاستحقاق (يجب ألا تكون فارغة) */
  payments: ReminderPayment[];
}

/** الدفعات التي يُجهَّز لها تذكير: غير المسددة بالكامل، والمتأخرة أو متبقٍّ على استحقاقها 20 يوماً أو أقل.
 *  لو رجعت مصفوفة فارغة فلا يُجهَّز أي تذكير في الشات. */
export function reminderPaymentsOf(payments: {
  installment_number: number; amount: number; paid_amount?: number | null; paid: boolean; due_date: string;
}[]): ReminderPayment[] {
  return payments
    .filter(p => !p.paid && daysDiffFromToday(p.due_date) <= REMINDER_WINDOW_DAYS)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.installment_number - b.installment_number)
    .map(p => {
      const [y, m, d] = p.due_date.split('-');
      return {
        installmentNumber: p.installment_number,
        amount: p.amount,
        paidAmount: Math.min(p.amount, p.paid_amount ?? 0),
        dueDateFormatted: `${d}/${m}/${y}`,
        diffDays: daysDiffFromToday(p.due_date),
      };
    });
}

/** صيغة الترتيب العربي المؤنّث (يتوافق مع "الدفعة") لأي رقم من 1 إلى 60 — "الأولى"، "الثانية عشرة"،
 *  "الحادية والعشرون"... وما بعد 60 يرجع رقماً عادياً كحل احتياطي. */
export function arabicOrdinalFeminine(n: number): string {
  const unitsBase = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة'];
  const unitsCompound = ['', 'الحادية', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة'];
  const tensWords: Record<number, string> = { 20: 'العشرون', 30: 'الثلاثون', 40: 'الأربعون', 50: 'الخمسون', 60: 'الستون' };

  if (n >= 1 && n <= 9) return unitsBase[n];
  if (n === 10) return 'العاشرة';
  if (n >= 11 && n <= 19) return `${unitsCompound[n - 10]} عشرة`;
  if (n in tensWords) return tensWords[n];
  if (n > 20 && n < 30) return `${unitsCompound[n - 20]} والعشرون`;
  if (n > 30 && n < 40) return `${unitsCompound[n - 30]} والثلاثون`;
  if (n > 40 && n < 50) return `${unitsCompound[n - 40]} والأربعون`;
  if (n > 50 && n < 60) return `${unitsCompound[n - 50]} والخمسون`;
  return String(n);
}

export function paymentLabelAr(installmentNumber: number): string {
  return `الدفعة ${arabicOrdinalFeminine(installmentNumber)}`;
}

const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} ريال`;

function statusLine(diffDays: number): string {
  if (diffDays < 0) return `متأخرة — مضى على موعد استحقاقها (${Math.abs(diffDays)}) يوم`;
  if (diffDays === 0) return 'يحين موعد استحقاقها اليوم';
  return `سيحين موعد استحقاقها بعد (${diffDays}) يوم`;
}

/** تفاصيل دفعة واحدة كأسطر نصية: المبلغ، الموعد، الحالة، وتفصيل الجزء المدفوع لو وُجد */
function paymentBlock(p: ReminderPayment): string[] {
  const lines: string[] = [];
  const remaining = Math.max(0, p.amount - p.paidAmount);
  if (p.paidAmount > 0) {
    lines.push(`   • قيمة الدفعة: ${money(p.amount)}`);
    lines.push(`   • المدفوع منها: ${money(p.paidAmount)}`);
    lines.push(`   • المتبقي عليكم: ${money(remaining)}`);
  } else {
    lines.push(`   • المبلغ: ${money(p.amount)}`);
  }
  lines.push(`   • موعد الاستحقاق: ${p.dueDateFormatted}`);
  lines.push(`   • الحالة: ${statusLine(p.diffDays)}`);
  return lines;
}

export function buildReminderMessage(input: ReminderMessageInput): string {
  const { clientName, gender, senderName, unitCode, projectName, payments } = input;

  const honorific = gender === 'female' ? ' المحترمة' : gender === 'male' ? ' المحترم' : '';
  const single = payments.length === 1;

  const details = payments
    .map(p => [`▪️ ${paymentLabelAr(p.installmentNumber)}`, ...paymentBlock(p)].join('\n'))
    .join('\n\n');

  const totalRemaining = payments.reduce((sum, p) => sum + Math.max(0, p.amount - p.paidAmount), 0);
  const totalLine = single ? '' : `\n\n*إجمالي المستحق عليكم: ${money(totalRemaining)}*`;

  const anyOverdue = payments.some(p => p.diffDays < 0);
  const anyToday = payments.some(p => p.diffDays === 0);
  const callToAction = anyOverdue
    ? 'نأمل منكم التكرم بإتمام السداد في أقرب وقت ممكن.'
    : anyToday
      ? 'نأمل منكم التكرم بإتمام السداد اليوم.'
      : 'نرجو منكم التكرم بالاستعداد لإتمام السداد في الموعد المحدد.';

  const intro = single
    ? `حبيت أذكركم بخصوص ${paymentLabelAr(payments[0].installmentNumber)} المستحقة للوحدة (${unitCode}) في ${projectName}، وتفاصيلها كالتالي:`
    : `حبيت أذكركم بخصوص الدفعات المستحقة للوحدة (${unitCode}) في ${projectName}، وتفاصيلها كالتالي:`;

  return (
`السلام عليكم ورحمة الله وبركاته 🌹

أ/ ${clientName}${honorific}

معك ${senderName} من شركة ريادة وتعمير.

${intro}

${details}${totalLine}

${callToAction}


وإذا كان عندكم أي استفسار أو احتجتم أي مساعدة، يسعدني تواصلكم معي في أي وقت.

شاكرين لكم تعاونكم 🌷`
  );
}
