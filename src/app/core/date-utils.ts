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
