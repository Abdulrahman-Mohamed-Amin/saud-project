import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private supa = inject(SupabaseService);
  private router = inject(Router);

  private _session = signal<Session | null>(null);
  readonly session = this._session.asReadonly();
  readonly isAuthenticated = computed(() => !!this._session());

  /** Resolves once the initial session has been loaded from storage */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.supa.getClient().auth.getSession().then(({ data }) => {
      this._session.set(data.session);
    });

    this.supa.getClient().auth.onAuthStateChange((_event, session) => {
      this._session.set(session);
    });
  }

  async signIn(username: string, password: string): Promise<string | null> {
    const email = username.trim().includes('@')
      ? username.trim()
      : `${username.trim()}@sababah.sa`;

    const { data, error } = await this.supa.getClient().auth.signInWithPassword({ email, password });
    if (error) return 'login.invalidCredentials'; // transloco key — resolved by the caller
    this._session.set(data.session);
    return null;
  }

  get currentUser() { return this._session()?.user ?? null; }

  /** false only when explicitly revoked via app_metadata; defaults to true */
  get canManagePayments(): boolean {
    return this.currentUser?.app_metadata?.['payments_manage'] !== false;
  }

  get displayName(): string {
    return this.currentUser?.user_metadata?.['name'] ?? '';
  }

  async updateProfile(data: Record<string, unknown>): Promise<string | null> {
    const { error } = await this.supa.getClient().auth.updateUser({ data });
    return error ? error.message : null;
  }

  async changePassword(newPassword: string): Promise<string | null> {
    const { error } = await this.supa.getClient().auth.updateUser({ password: newPassword });
    return error ? error.message : null;
  }

  async signOut(): Promise<void> {
    await this.supa.getClient().auth.signOut();
    this._session.set(null);
    this.router.navigate(['/login']);
  }
}
