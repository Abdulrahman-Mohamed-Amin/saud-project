import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { SupabaseService, ContractWithPayments } from './supabase.service';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface OverdueItem {
  clientId: string;
  clientName: string;
  unitCode: string;
  projectName: string;
  payment: {
    id: string;
    /** رقم القسط (1-6) — يُستخدم لعرض اسم الدفعة مترجَماً حسب لغة الواجهة الحالية،
     *  بدل الاعتماد على `label` المخزَّن (نص عربي ثابت وقت إنشاء العقد لا يتغيّر مع اللغة) */
    installmentNumber: number;
    amount: number;
    date: string;
  };
}

@Injectable({ providedIn: 'root' })
export class PaymentsService implements OnDestroy {
  private supa = inject(SupabaseService);
  private channel: RealtimeChannel | null = null;

  private _contracts = signal<ContractWithPayments[]>([]);
  private _overdueList = signal<OverdueItem[]>([]);
  private _dueTodayList = signal<OverdueItem[]>([]);
  private _upcomingList = signal<OverdueItem[]>([]);

  readonly contracts = this._contracts.asReadonly();
  readonly overdueList = this._overdueList.asReadonly();
  readonly overdueCount = computed(() => this._overdueList().length);
  readonly dueTodayList = this._dueTodayList.asReadonly();
  readonly dueTodayCount = computed(() => this._dueTodayList().length);
  readonly upcomingList = this._upcomingList.asReadonly();
  readonly upcomingCount = computed(() => this._upcomingList().length);

  constructor() {
    this.refresh();
    this.subscribeRealtime();
  }

  async refresh(): Promise<void> {
    const contracts = await this.supa.loadContracts();
    this._contracts.set(contracts);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const upcomingLimit = new Date(todayStart);
    upcomingLimit.setDate(upcomingLimit.getDate() + 3);

    const overdue: OverdueItem[] = [];
    const dueToday: OverdueItem[] = [];
    const upcoming: OverdueItem[] = [];

    for (const c of contracts) {
      for (const p of c.payments) {
        if (p.paid) continue;
        const dueDate = this.dateOnly(p.due_date);
        const item: OverdueItem = {
          clientId: c.id,
          clientName: c.client_name,
          projectName: c.project_name,
          unitCode: (c.fields?.['unit_code'] ?? ''),
          payment: {
            id: p.id,
            installmentNumber: p.installment_number,
            amount: p.amount,
            date: this.formatDate(p.due_date),
          },
        };
        if (dueDate < todayStart) overdue.push(item);
        else if (dueDate.getTime() === todayStart.getTime()) dueToday.push(item);
        else if (dueDate <= upcomingLimit) upcoming.push(item);
      }
    }

    this._overdueList.set(overdue);
    this._dueTodayList.set(dueToday);
    this._upcomingList.set(upcoming);
  }

  private subscribeRealtime(): void {
    const cb = () => { this.refresh(); };
    this.channel = this.supa.getClient()
      .channel('global-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contracts' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, cb)
      .subscribe();
  }

  ngOnDestroy(): void {
    this.channel?.unsubscribe();
  }

  private formatDate(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  /** يحوّل تاريخ 'YYYY-MM-DD' إلى منتصف الليل بالتوقيت المحلي، بعيداً عن مشاكل التوقيت العالمي عند المقارنة بين التواريخ */
  private dateOnly(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }
}
