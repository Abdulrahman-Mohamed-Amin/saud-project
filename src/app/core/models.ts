/** حالة الوحدة العقارية */
export type UnitStatus = 'vacant' | 'rented' | 'maintenance';

/** عقد الإيجار المرتبط بوحدة مؤجَّرة */
export interface Contract {
  no: string; // رقم العقد
  tenant: string; // اسم المستأجر
  start: string; // تاريخ البداية (ISO: YYYY-MM-DD)
  end: string; // تاريخ النهاية (ISO: YYYY-MM-DD)
  rent: number; // قيمة الإيجار الشهري (ر.س)
}

/** ملف العقد المرفوع (PDF) */
export interface ContractFile {
  name: string; // اسم الملف
  url: string; // رابط مؤقت لعرض/تنزيل الملف (object URL)
  size: number; // حجم الملف بالبايت
}

/** الوحدة العقارية */
export interface RealEstateUnit {
  id: number;
  code: string; // رمز الوحدة، مثل A-101
  type: string; // نوع الوحدة (شقة، محل، مستودع…)
  floor: string; // الطابق
  area: number; // المساحة (م²)
  status: UnitStatus;
  contract: Contract | null;
  contractPdf?: ContractFile | null; // ملف عقد الوحدة (PDF)
}

/** بيانات العرض المرتبطة بكل حالة (ألوان وتسميات) */
export interface StatusMeta {
  key: UnitStatus;
  label: string;
  text: string;
  bg: string;
  dot: string;
  ring: string;
}

export const STATUS: Record<UnitStatus, StatusMeta> = {
  vacant: { key: 'vacant', label: 'شاغرة', text: '#16A34A', bg: '#E9F9EF', dot: '#22C55E', ring: '#BBE9CB' },
  rented: { key: 'rented', label: 'مؤجَّرة', text: '#DC3D42', bg: '#FCEBEC', dot: '#F2383A', ring: '#F6C9CB' },
  maintenance: { key: 'maintenance', label: 'تحت الصيانة', text: '#C77A12', bg: '#FFF4E3', dot: '#F99C30', ring: '#F8DDB0' },
};
