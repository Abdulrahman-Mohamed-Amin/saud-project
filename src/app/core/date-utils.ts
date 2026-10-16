/** مقارنات تواريخ على مستوى اليوم الكامل (بدون وقت) — لتفادي تصنيف دفعة "مستحقة اليوم"
 *  كـ"متأخرة" بالخطأ بسبب اختلاف وقت اليوم الحالي عن منتصف الليل. */

/** يحوّل 'YYYY-MM-DD' إلى منتصف الليل بالتوقيت المحلي */
export function dateOnly(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** بداية اليوم الحالي (منتصف الليل بالتوقيت المحلي) */
export function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** الفرق بالأيام الكاملة بين تاريخ الاستحقاق واليوم — سالب يعني متأخرة، صفر يعني اليوم، موجب يعني لسه لم يحن */
export function daysDiffFromToday(iso: string): number {
  return Math.round((dateOnly(iso).getTime() - todayStart().getTime()) / 86400000);
}

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

function parseIso(iso: string): [number, number, number] | null {
  const [y, m, d] = (iso || '').split('-').map(Number);
  return y && m && d ? [y, m, d] : null;
}

/** نفس تاريخ البداية بعد سنة (كتاريخ نهاية افتراضي: بداية 10/09 → نهاية 10/09 السنة التالية) */
export function addYearIso(iso: string): string {
  const p = parseIso(iso);
  return p ? toIso(new Date(p[0] + 1, p[1] - 1, p[2])) : '';
}

/** البداية والحدّ الفاصل للمدة. تاريخ النهاية قد يُكتب كنفس يوم البداية بعد المدة (10/09 → 10/09)
 *  أو كآخر يوم في العقد (10/09 → 09/09)؛ في الحالتين الحدّ الفاصل هو اليوم الذي يطابق يوم البداية. */
function resolvePeriod(startIso: string, endIso?: string): { start: Date; boundary: Date; d: number; m: number; y: number } | null {
  const s = parseIso(startIso);
  if (!s) return null;
  const [y, m, d] = s;
  const start = new Date(y, m - 1, d);
  const e = parseIso(endIso || '');
  let boundary = e ? new Date(e[0], e[1] - 1, e[2]) : new Date(y + 1, m - 1, d);
  if (boundary.getDate() !== d) boundary = new Date(boundary.getFullYear(), boundary.getMonth(), boundary.getDate() + 1);
  if (boundary.getTime() <= start.getTime()) boundary = new Date(y + 1, m - 1, d);
  return { start, boundary, d, m, y };
}

/** عدد الأشهر الكاملة بين تاريخ البداية والنهاية (0 لو أحدهما غير مكتمل) */
export function monthsBetween(startIso: string, endIso: string): number {
  if (!parseIso(endIso)) return 0;
  const p = resolvePeriod(startIso, endIso);
  if (!p) return 0;
  const months = (p.boundary.getFullYear() - p.y) * 12 + (p.boundary.getMonth() - (p.m - 1));
  return Math.max(0, p.boundary.getDate() < p.d ? months - 1 : months);
}

/** يوزّع n تاريخ استحقاق بين تاريخ البداية (startIso) وتاريخ النهاية (endIso، الافتراضي بعد سنة).
 *  لو عدد الأشهر الكاملة بين التاريخين يقبل القسمة على n (مثل سنة على 12/6/4/3/2/1، أو 6 أشهر على 6/3/2/1)
 *  تكون الدفعات كل (الأشهر ÷ n) شهر بنفس اليوم من الشهر (بداية 10 → كل 10)، ولو اليوم غير موجود في الشهر
 *  (مثل 31) يُستخدم آخر يوم فيه. لأي حالة أخرى (5، 7 دفعات...) يُقسَّم بالتساوي بالأيام.
 *  يرجع نصوصاً فارغة لو تاريخ البداية غير مكتمل. */
export function spreadInstallmentDates(startIso: string, n: number, endIso?: string): string[] {
  const p = resolvePeriod(startIso, endIso);
  if (!p) return Array.from({ length: n }, () => '');
  const { start, boundary, d, m, y } = p;

  const months = (boundary.getFullYear() - y) * 12 + (boundary.getMonth() - (m - 1));
  const exactMonths = boundary.getDate() === d && months > 0;

  if (n > 0 && exactMonths && months % n === 0) {
    const stepMonths = months / n;
    return Array.from({ length: n }, (_, i) => {
      const monthIndex = m - 1 + i * stepMonths;
      const lastDay = new Date(y, monthIndex + 1, 0).getDate();
      return toIso(new Date(y, monthIndex, Math.min(d, lastDay)));
    });
  }

  const spanMs = boundary.getTime() - start.getTime();
  return Array.from({ length: n }, (_, i) => toIso(new Date(start.getTime() + Math.round((i * spanMs) / n))));
}
