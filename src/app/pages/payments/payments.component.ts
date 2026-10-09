import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { IconComponent } from '../../core/icon/icon.component';
import { SupabaseService, ContractWithPayments } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { daysDiffFromToday } from '../../core/date-utils';

export interface ProjectSummary {
  id: string;
  name: string;
  clientCount: number;
  overdueCount: number;
  paidTotal: number;
  remaining: number;
}

@Component({
  selector: 'app-payments',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, TranslocoModule],
  templateUrl: './payments.component.html',
})
export class PaymentsComponent implements OnInit {
  private supa = inject(SupabaseService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private transloco = inject(TranslocoService);
  readonly auth = inject(AuthService);

  private _projectsList = signal<{ id: string; name: string }[]>([]);
  private _contracts = signal<ContractWithPayments[]>([]);
  loading = signal(true);

  projects = computed<ProjectSummary[]>(() => {
    const map = new Map<string, ContractWithPayments[]>();
    for (const c of this._contracts()) {
      const list = map.get(c.project_name) ?? [];
      list.push(c);
      map.set(c.project_name, list);
    }
    return this._projectsList().map(p => {
      const cs = map.get(p.name) ?? [];
      return {
        id: p.id,
        name: p.name,
        clientCount: cs.length,
        overdueCount: cs.reduce((s, c) =>
          s + c.payments.filter(pay => !pay.paid && daysDiffFromToday(pay.due_date) < 0).length, 0),
        paidTotal: cs.reduce((s, c) =>
          s + c.payments.filter(pay => pay.paid).reduce((ss, pay) => ss + pay.amount, 0), 0),
        remaining: cs.reduce((s, c) =>
          s + c.unit_price - c.payments.filter(pay => pay.paid).reduce((ss, pay) => ss + pay.amount, 0), 0),
      };
    });
  });

  async ngOnInit() {
    const [contracts, projects] = await Promise.all([
      this.supa.loadContracts(),
      this.supa.loadProjects(),
    ]);
    this._contracts.set(contracts);
    this._projectsList.set(projects);
    this.loading.set(false);
  }

  open(proj: ProjectSummary) {
    this.router.navigate(['/payments', encodeURIComponent(proj.name)]);
  }

  // ── Delete project ───────────────────────────────────────────────────────────
  deleteTarget: ProjectSummary | null = null;
  deleting = false;

  confirmDeleteProject(e: Event, proj: ProjectSummary) {
    e.stopPropagation();
    if (!this.auth.canManagePayments) return;
    this.deleteTarget = proj;
  }
  cancelDeleteProject() { this.deleteTarget = null; }
  async executeDeleteProject() {
    if (!this.deleteTarget || this.deleting || !this.auth.canManagePayments) return;
    this.deleting = true;
    const ok = await this.supa.deleteProject(this.deleteTarget.id);
    if (ok) {
      this._projectsList.update(list => list.filter(p => p.id !== this.deleteTarget!.id));
      this.toast.success(this.transloco.translate('payments.deletedToast'), this.deleteTarget.name);
    } else {
      this.toast.error(this.transloco.translate('payments.errorToast'), this.transloco.translate('payments.deleteFailedSub'));
    }
    this.deleteTarget = null;
    this.deleting = false;
  }

  // ── Rename project ───────────────────────────────────────────────────────────
  renameTarget: ProjectSummary | null = null;
  renameName = '';
  renameSaving = false;

  confirmRenameProject(e: Event, proj: ProjectSummary) {
    e.stopPropagation();
    if (!this.auth.canManagePayments) return;
    this.renameTarget = proj;
    this.renameName = proj.name;
  }
  cancelRenameProject() { this.renameTarget = null; this.renameName = ''; }
  async executeRenameProject() {
    const target = this.renameTarget;
    const newName = this.renameName.trim();
    if (!target || !newName || newName === target.name || this.renameSaving || !this.auth.canManagePayments) return;
    this.renameSaving = true;
    const ok = await this.supa.renameProject(target.name, newName);
    if (ok) {
      this._projectsList.update(list => list.map(p => p.id === target.id ? { ...p, name: newName } : p));
      const contracts = await this.supa.loadContracts();
      this._contracts.set(contracts);
      this.toast.success(this.transloco.translate('payments.renamedToast'), newName);
    } else {
      this.toast.error(this.transloco.translate('payments.errorToast'), this.transloco.translate('payments.renameFailedSub'));
    }
    this.renameSaving = false;
    this.cancelRenameProject();
  }

  // ── Add project ─────────────────────────────────────────────────────────────
  addOpen = false;
  addName = '';
  addSaving = false;

  openAdd() {
    if (!this.auth.canManagePayments) return;
    this.addName = '';
    this.addOpen = true;
  }
  closeAdd() { this.addOpen = false; }

  async submitAdd() {
    const name = this.addName.trim();
    if (!name || this.addSaving || !this.auth.canManagePayments) return;
    this.addSaving = true;
    const ok = await this.supa.saveProject(name);
    this.addSaving = false;
    if (ok) {
      const projects = await this.supa.loadProjects();
      this._projectsList.set(projects);
      this.toast.success(this.transloco.translate('payments.createdToast'), name);
      this.addOpen = false;
      this.router.navigate(['/payments', encodeURIComponent(name)]);
    } else {
      this.toast.error(this.transloco.translate('payments.alreadyExists'));
    }
  }

  fmt(n: number): string { return n.toLocaleString('en-US'); }
}
