import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready;
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login']);
};

/** يمنع الحسابات "للمشاهدة فقط" من فتح صفحات الإضافة/التوليد — تُحوَّل للوحة التحكم */
export const writeGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready;
  return auth.canManagePayments ? true : router.createUrlTree(['/dashboard']);
};
