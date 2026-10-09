import { Injectable } from '@angular/core';
import { Contract, RealEstateUnit, STATUS, StatusMeta, UnitStatus } from './models';

@Injectable({ providedIn: 'root' })
export class RealEstateService {
  /** تاريخ مرجعي لحساب العقود المنتهية — استبدله بـ new Date() في الإنتاج */
  readonly today = new Date('2026-05-29');

  /** البيانات الافتراضية (Mock Data) — ٦ وحدات متنوّعة الحالات */
  readonly units: RealEstateUnit[] = [
    {
      id: 1, code: 'A-101', type: 'شقة سكنية', floor: 'الطابق الأول', area: 120, status: 'rented',
      contract: { no: 'CN-2024-0142', tenant: 'محمد الشمري', start: '2024-02-01', end: '2026-06-20', rent: 14500 },
    },
    {
      id: 2, code: 'A-102', type: 'شقة سكنية', floor: 'الطابق الأول', area: 95, status: 'vacant',
      contract: null,
    },
    {
      id: 3, code: 'B-201', type: 'محل تجاري', floor: 'الطابق الأرضي', area: 60, status: 'rented',
      contract: { no: 'CN-2023-0098', tenant: 'مؤسسة النخبة', start: '2023-09-15', end: '2027-01-10', rent: 9800 },
    },
    {
      id: 4, code: 'B-202', type: 'مستودع', floor: 'الطابق الأرضي', area: 210, status: 'maintenance',
      contract: null,
    },
    {
      id: 5, code: 'C-301', type: 'فيلا دوبلكس', floor: 'الطابقان 3-4', area: 340, status: 'rented',
      contract: { no: 'CN-2024-0211', tenant: 'سارة القحطاني', start: '2024-06-22', end: '2026-06-15', rent: 26000 },
    },
    {
      id: 7, code: 'C-301', type: 'فيلا دوبلكس', floor: 'الطابقان 3-4', area: 340, status: 'rented',
      contract: { no: 'CN-2024-0211', tenant: 'سارة القحطاني', start: '2024-06-22', end: '2026-06-15', rent: 26000 },
    },
    {
      id: 6, code: 'C-302', type: 'شقة سكنية', floor: 'الطابق الثالث', area: 110, status: 'vacant',
      contract: null,
    },
  ];

  /** إضافة وحدة جديدة وإرجاعها (يُسنَد لها مُعرّف تلقائي) */
  addUnit(data: Omit<RealEstateUnit, 'id' | 'contract'>): RealEstateUnit {
    const id = this.units.reduce((max, u) => Math.max(max, u.id), 0) + 1;
    const unit: RealEstateUnit = { id, contract: null, ...data };
    this.units.unshift(unit);
    return unit;
  }

  /** الوحدات المتاحة لإسناد عقد جديد (شاغرة وبدون عقد) */
  get assignableUnits(): RealEstateUnit[] {
    return this.units.filter((u) => u.status === 'vacant' && !u.contract);
  }

  /** إسناد عقد (مستأجر) لوحدة شاغرة، وتحويل حالتها إلى مؤجَّرة */
  assignContract(unitId: number, contract: Contract): RealEstateUnit | null {
    const unit = this.units.find((u) => u.id === unitId);
    if (!unit) return null;
    unit.contract = contract;
    unit.status = 'rented';
    return unit;
  }

  /* ===================== KPIs ===================== */
  get totalUnits(): number {
    return this.units.length;
  }

  get rentedCount(): number {
    return this.units.filter((u) => u.status === 'rented').length;
  }

  get vacantCount(): number {
    return this.units.filter((u) => u.status === 'vacant').length;
  }

  get maintenanceCount(): number {
    return this.units.filter((u) => u.status === 'maintenance').length;
  }

  /** معدل الإشغال (نسبة المؤجَّر إلى الإجمالي) */
  get occupancyRate(): number {
    return this.totalUnits ? Math.round((this.rentedCount / this.totalUnits) * 100) : 0;
  }

  /** عدد العقود التي تنتهي خلال ٣٠ يوماً */
  get expiringSoonCount(): number {
    return this.units.filter((u) => this.isExpiringSoon(u.contract)).length;
  }

  /** إجمالي الإيرادات الشهرية من العقود النشطة */
  get monthlyRevenue(): number {
    return this.units.reduce((sum, u) => sum + (u.contract?.rent ?? 0), 0);
  }

  /* ===================== Helpers ===================== */
  status(key: UnitStatus): StatusMeta {
    return STATUS[key];
  }

  /** الأيام المتبقية حتى نهاية العقد */
  daysLeft(end: string): number {
    const diff = new Date(end).getTime() - this.today.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  /** هل ينتهي العقد خلال ٣٠ يوماً؟ */
  isExpiringSoon(contract: Contract | null): boolean {
    if (!contract) return false;
    const d = this.daysLeft(contract.end);
    return d >= 0 && d <= 30;
  }

  statusLabel(status: UnitStatus): string {
    return STATUS[status].label;
  }

  /** تنسيق رقم بفواصل الآلاف */
  fmt(n: number): string {
    return n.toLocaleString('en-US');
  }

  /** تنسيق التاريخ بالتقويم الميلادي بالعربية */
  fmtDate(d: string): string {
    return new Date(d).toLocaleDateString('ar-SA-u-ca-gregory', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
}
