import { Component, inject, computed, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslocoModule } from '@jsverse/transloco';
import { IconComponent } from '../../core/icon/icon.component';
import { PaymentsService } from '../../core/payments.service';
import { SupabaseService } from '../../core/supabase.service';
import { daysDiffFromToday } from '../../core/date-utils';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent, FormsModule, TranslocoModule],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  readonly notif = inject(PaymentsService);
  private supa = inject(SupabaseService);

  ngOnInit() { this.notif.refresh(); }

  private _c = this.notif.contracts;

  readonly totalClients = computed(() => this._c().length);

  readonly paidAmount = computed(() =>
    this._c().reduce((sum, c) =>
      sum + c.payments.filter(p => p.paid).reduce((s, p) => s + p.amount, 0), 0
    )
  );

  readonly remainingAmount = computed(() =>
    this._c().reduce((sum, c) =>
      sum + c.payments.filter(p => !p.paid).reduce((s, p) => s + p.amount, 0), 0
    )
  );

  readonly projectSummary = computed(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const map = new Map<string, { clients: number; overdue: number; monthlyPaid: number }>();
    for (const c of this._c()) {
      const e = map.get(c.project_name) ?? { clients: 0, overdue: 0, monthlyPaid: 0 };
      e.clients++;
      e.overdue += c.payments.filter(p => !p.paid && daysDiffFromToday(p.due_date) < 0).length;
      e.monthlyPaid += c.payments
        .filter(p => p.paid && p.paid_at && new Date(p.paid_at) >= monthStart)
        .reduce((s, p) => s + p.amount, 0);
      map.set(c.project_name, e);
    }
    return [...map.entries()]
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.overdue - a.overdue);
  });

  fmt(n: number): string { return n.toLocaleString('en-US'); }

  editingProject = signal<string | null>(null);
  editName = '';
  saving = false;

  startEdit(name: string, e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.editingProject.set(name);
    this.editName = name;
  }

  cancelEdit(): void {
    this.editingProject.set(null);
    this.editName = '';
  }

  async saveEdit(): Promise<void> {
    const old = this.editingProject();
    const trimmed = this.editName.trim();
    if (!old || !trimmed || trimmed === old || this.saving) return;
    this.saving = true;
    const ok = await this.supa.renameProject(old, trimmed);
    if (ok) await this.notif.refresh();
    this.saving = false;
    this.cancelEdit();
  }
}
