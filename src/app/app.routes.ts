import { Routes } from '@angular/router';
import { LayoutComponent } from './layout/layout.component';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
        data: { title: 'nav.dashboard', subtitle: 'layout.dashboardSubtitle' },
      },
      {
        path: 'payments',
        loadComponent: () => import('./pages/payments/payments.component').then((m) => m.PaymentsComponent),
        data: { title: 'nav.payments', subtitle: 'layout.paymentsSubtitle' },
      },
      {
        path: 'payments/status/due',
        loadComponent: () => import('./pages/payments/payments-status.component').then((m) => m.PaymentsStatusComponent),
        data: { title: 'dashboard.duePayments', subtitle: 'dashboard.dueToday', status: 'due' },
      },
      {
        path: 'payments/status/overdue',
        loadComponent: () => import('./pages/payments/payments-status.component').then((m) => m.PaymentsStatusComponent),
        data: { title: 'dashboard.overduePaymentsTitle', subtitle: 'dashboard.overduePaymentsSub', status: 'overdue' },
      },
      {
        path: 'payments/status/upcoming',
        loadComponent: () => import('./pages/payments/payments-status.component').then((m) => m.PaymentsStatusComponent),
        data: { title: 'dashboard.upcomingPayments', subtitle: 'dashboard.upcomingSoon', status: 'upcoming' },
      },
      {
        path: 'payments/:project',
        loadComponent: () => import('./pages/payments/payments-detail.component').then((m) => m.PaymentsDetailComponent),
        data: { title: 'layout.projectDetailsTitle', subtitle: 'layout.projectDetailsSubtitle' },
      },
      {
        path: 'payments/:project/client/:id',
        loadComponent: () => import('./pages/payments/client-detail.component').then((m) => m.ClientDetailComponent),
        data: { title: 'layout.clientDetailsTitle', subtitle: 'layout.clientDetailsSubtitle' },
      },
      {
        path: 'generate',
        loadComponent: () => import('./pages/generate/generate.component').then((m) => m.GenerateComponent),
        data: { title: 'nav.generate', subtitle: 'layout.generateSubtitle' },
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
        data: { title: 'nav.settings', subtitle: 'layout.settingsSubtitle' },
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
