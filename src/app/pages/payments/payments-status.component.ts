import { Component, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoModule } from '@jsverse/transloco';
import { IconComponent } from '../../core/icon/icon.component';
import { PaymentsService, OverdueItem } from '../../core/payments.service';

export type PaymentStatus = 'due' | 'overdue' | 'upcoming';

@Component({
  selector: 'app-payments-status',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent, TranslocoModule],
  templateUrl: './payments-status.component.html',
})
export class PaymentsStatusComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly notif = inject(PaymentsService);

  status: PaymentStatus = 'due';

  readonly list = computed<OverdueItem[]>(() => {
    switch (this.status) {
      case 'overdue': return this.notif.overdueList();
      case 'upcoming': return this.notif.upcomingList();
      default: return this.notif.dueTodayList();
    }
  });

  readonly titleKey = computed(() => {
    switch (this.status) {
      case 'overdue': return 'dashboard.overduePaymentsTitle';
      case 'upcoming': return 'dashboard.upcomingPayments';
      default: return 'dashboard.duePayments';
    }
  });

  readonly emptyKey = computed(() => {
    switch (this.status) {
      case 'overdue': return 'common.noOverduePayments';
      case 'upcoming': return 'dashboard.noUpcomingPayments';
      default: return 'dashboard.noDuePayments';
    }
  });

  ngOnInit() {
    this.status = (this.route.snapshot.data['status'] as PaymentStatus) ?? 'due';
    this.notif.refresh();
  }

  open(item: OverdueItem) {
    this.router.navigate(['/payments', encodeURIComponent(item.projectName), 'client', item.clientId]);
  }

  fmt(n: number): string { return n.toLocaleString('en-US'); }
}
