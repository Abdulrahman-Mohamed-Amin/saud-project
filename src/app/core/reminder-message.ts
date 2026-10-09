/** رسالة التذكير الموحّدة (واتساب + إيميل) — نص واحد يُبنى حسب حالة الدفعة (قريبة/اليوم/متأخرة)
 *  وجنس العميل (ذكر/أنثى)، بدل نص ثابت واحد لجميع الحالات. */
export interface ReminderMessageInput {
  clientName: string;
  gender: '' | 'male' | 'female';
  senderName: string;
  unitCode: string;
  projectName: string;
  /** رقم القسط (1، 2، 3...) — يُحوَّل داخلياً لصيغة عربية ("الدفعة الأولى"، "الدفعة الثانية"...) */
  installmentNumber: number;
  /** تاريخ الاستحقاق بصيغة dd/mm/yyyy */
  dueDateFormatted: string;
  /** الفرق بالأيام بين اليوم وتاريخ الاستحقاق — سالب يعني متأخرة، صفر يعني اليوم، موجب يعني لسه لم تحن */
  diffDays: number;
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

export function buildReminderMessage(input: ReminderMessageInput): string {
  const { clientName, gender, senderName, unitCode, projectName, installmentNumber, dueDateFormatted, diffDays } = input;

  const honorific = gender === 'female' ? ' المحترمة' : gender === 'male' ? ' المحترم' : '';
  const paymentLabel = paymentLabelAr(installmentNumber);

  let statusClause: string;
  let callToAction: string;
  if (diffDays < 0) {
    statusClause = `واللي كان موعد استحقاقها بتاريخ (${dueDateFormatted})، ومضى على موعد استحقاقها (${Math.abs(diffDays)}) يوم حتى الآن.`;
    callToAction = 'نأمل منكم التكرم بإتمام السداد في أقرب وقت ممكن.';
  } else if (diffDays === 0) {
    statusClause = `واللي يحين موعد استحقاقها اليوم بتاريخ (${dueDateFormatted}).`;
    callToAction = 'نأمل منكم التكرم بإتمام السداد اليوم.';
  } else {
    statusClause = `واللي سيحين موعد استحقاقها بتاريخ (${dueDateFormatted})، وذلك بعد (${diffDays}) يوم من تاريخه.`;
    callToAction = 'نرجو منكم التكرم بالاستعداد لإتمام السداد في الموعد المحدد.';
  }

  return (
`السلام عليكم ورحمة الله وبركاته 🌹

أ/ ${clientName}${honorific}

معك ${senderName} من شركة ريادة وتعمير.

حبيت أذكركم بخصوص ${paymentLabel} المستحقة للوحدة (${unitCode}) في ${projectName}، ${statusClause}

${callToAction}


وإذا كان عندكم أي استفسار أو احتجتم أي مساعدة، يسعدني تواصلكم معي في أي وقت.

شاكرين لكم تعاونكم 🌷`
  );
}
