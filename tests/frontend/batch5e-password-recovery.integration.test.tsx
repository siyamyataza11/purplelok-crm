import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Profile } from '@/types';
import { OrganizationProvider, useOrganization } from '@/context/OrganizationContext';
import { TenantDataProvider, useTenantData } from '@/context/TenantDataContext';
import { PERMISSION_KEYS } from '@/lib/authorization';

type Result<T> = { data: T; error: { message: string } | null };
type AuthCallback = (event: AuthChangeEvent, session: Session | null) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const dependencies = vi.hoisted(() => ({ client: null as FakeSupabase | null }));

vi.mock('@/lib/supabase', () => ({
  exchangePasswordRecoveryCodeOnce: (code: string) =>
    dependencies.client!.exchangeRecoveryCode(code),
  claimPasswordRecoveryEvent: (event: AuthChangeEvent, session: Session | null) =>
    dependencies.client!.claimRecovery(event, session),
  consumeBufferedPasswordRecoveryEvent: () => dependencies.client!.consumeRecovery(),
  clearPasswordRecoveryEventProvenance: () => dependencies.client?.clearRecoveryProvenance(),
  supabase: {
    auth: {
      getSession: () => dependencies.client!.getSession(),
      getUser: () => dependencies.client!.getUser(),
      onAuthStateChange: (callback: AuthCallback) => dependencies.client!.onAuthStateChange(callback),
      signInWithPassword: (credentials: { email: string; password: string }) =>
        dependencies.client!.signInWithPassword(credentials),
      signOut: (options?: { scope?: string }) => dependencies.client!.signOut(options),
      resetPasswordForEmail: (email: string, options: { redirectTo: string }) =>
        dependencies.client!.resetPasswordForEmail(email, options),
      updateUser: (attributes: { password: string }) => dependencies.client!.updateUser(attributes),
    },
    from: (table: string) => dependencies.client!.from(table),
  },
}));

vi.mock('@/lib/supabase-auth-storage', () => ({
  beginSupabaseAuthPersistence: () => dependencies.client!.beginAuthPersistence(),
  canSafelyClearRecoveryQuarantineAfterPurge: () => dependencies.client!.storageBlocked,
  clearRecoveryQuarantineAfterSafePurge: () => dependencies.client!.storageBlocked
    && dependencies.client!.setRecoveryQuarantine(false),
  clearRecoveryQuarantineAfterVerifiedRecovery: () =>
    dependencies.client!.setRecoveryQuarantine(false),
  establishRecoveryQuarantine: () => dependencies.client!.setRecoveryQuarantine(true),
  getSupabaseAuthStorageRevision: () => dependencies.client!.storageRevision,
  isRecoveryQuarantined: () => dependencies.client!.recoveryQuarantined,
  purgeSupabaseAuthStorage: () => dependencies.client!.purgeAuthStorage(),
  subscribeRecoveryQuarantine: (listener: (active: boolean) => void) =>
    dependencies.client!.subscribeRecoveryQuarantine(listener),
  withPurgedSupabaseAuthSession: (operation: () => Promise<unknown>) => operation(),
}));

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { PasswordRecoveryScreen } from '@/components/auth/PasswordRecoveryScreen';
import { AUTH_MESSAGES, PASSWORD_RESET_REQUEST_CONFIRMATION } from '@/lib/auth-errors';
import {
  getPasswordRecoveryRedirectUrl,
  MINIMUM_PASSWORD_LENGTH,
  validateRecoveryPassword,
} from '@/lib/password-recovery';

function authUser(id: string): User {
  return { id, email: `${id}@example.test` } as User;
}

function authSession(
  id: string,
  token = `${id}-token`,
  sessionState: string | null = 'normal_v1',
): Session {
  const encode = (value: unknown) => btoa(JSON.stringify(value))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const accessToken = [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({
      sub: id,
      session_id: id === 'user-b'
        ? '00000000-0000-4000-8000-000000000002'
        : '00000000-0000-4000-8000-000000000001',
      ...(sessionState === null ? {} : { purplelok_session_state: sessionState }),
    }),
    encode(token),
  ].join('.');
  return { access_token: accessToken, user: authUser(id) } as Session;
}

function profile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    email: `${id}@example.test`,
    full_name: `User ${id}`,
    avatar_url: null,
    phone: null,
    position: null,
    role: 'staff',
    active: true,
    created_at: '2026-08-28T00:00:00.000Z',
    updated_at: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

class ProfileQuery implements PromiseLike<Result<unknown[]>> {
  private userId = '';
  constructor(private readonly client: FakeSupabase) {}
  select() { return this; }
  eq(_column: string, value: string) { this.userId = value; return this; }
  limit() { return this; }
  then<TResult1 = Result<unknown[]>, TResult2 = never>(
    onfulfilled?: ((value: Result<unknown[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    this.client.calls.push(`profile:${this.userId}`);
    return Promise.resolve(this.client.profileHandler(this.userId)).then(onfulfilled, onrejected);
  }
}

class OrganizationQuery implements PromiseLike<Result<unknown[]>> {
  constructor(private readonly client: FakeSupabase, private readonly table: string) {}
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  abortSignal() { return this; }
  then<TResult1 = Result<unknown[]>, TResult2 = never>(
    onfulfilled?: ((value: Result<unknown[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    this.client.calls.push(`organization:${this.table}`);
    const handler = this.client.organizationHandlers[this.table];
    const result = handler
      ? handler()
      : Promise.resolve({
        data: this.client.organizationFixtures[this.table] ?? [],
        error: null,
      });
    return result.then(onfulfilled, onrejected);
  }
}

class FakeSupabase {
  currentSession: Session | null = null;
  liveUser: User | null = null;
  callbacks: AuthCallback[] = [];
  storageRevision = 0;
  storageBlocked = false;
  resetError: { message: string } | null = null;
  updateError: { message: string } | null = null;
  updateUserHandler: (() => Promise<Result<{ user: User | null }>>) | null = null;
  getSessionHandler: (() => Promise<Result<{ session: Session | null }>>) | null = null;
  signOutHandler: (() => Promise<{ error: { message: string } | null }>) | null = null;
  nextSignInSession: Session | null = null;
  profileHandler: (id: string) => Result<unknown[]> = (id) => ({ data: [profile(id)], error: null });
  getUserHandler: () => Promise<Result<{ user: User | null }>> = () => Promise.resolve({
    data: { user: this.liveUser },
    error: null,
  });
  readonly calls: string[] = [];
  readonly resetRequests: Array<{ email: string; redirectTo: string }> = [];
  readonly passwordUpdates: string[] = [];
  recoveryQuarantined = false;
  recoverySequence = 0;
  pendingRecovery: { source: 'PASSWORD_RECOVERY'; sequence: number; session: Session } | null = null;
  recoveryExchangeSession: Session | null = null;
  recoveryExchangeError = false;
  recoveryExchangeSequence = 0;
  quarantineListeners: Array<(active: boolean) => void> = [];
  organizationFixtures: Record<string, unknown[]> = {};
  organizationHandlers: Record<string, () => Promise<Result<unknown[]>>> = {};

  getSession() {
    this.calls.push('getSession');
    if (this.getSessionHandler) return this.getSessionHandler();
    return Promise.resolve({ data: { session: this.storageBlocked ? null : this.currentSession }, error: null });
  }
  getUser() {
    this.calls.push('getUser');
    return this.getUserHandler();
  }
  onAuthStateChange(callback: AuthCallback) {
    this.callbacks.push(callback);
    return {
      data: {
        subscription: {
          unsubscribe: vi.fn(() => {
            this.callbacks = this.callbacks.filter((candidate) => candidate !== callback);
          }),
        },
      },
    };
  }
  signInWithPassword() {
    this.calls.push('signInWithPassword');
    if (this.nextSignInSession) {
      this.currentSession = this.nextSignInSession;
      this.liveUser = this.nextSignInSession.user;
      this.nextSignInSession = null;
      this.storageRevision += 1;
    }
    return Promise.resolve({ data: { session: this.currentSession }, error: null });
  }
  exchangeRecoveryCode(code: string) {
    this.calls.push('exchangeCodeForSession');
    if (this.recoveryExchangeError || code !== 'valid-recovery-code') {
      return Promise.resolve(null);
    }
    const session = this.recoveryExchangeSession
      ?? authSession('user-a', 'recovery-token', 'recovery_pending_v1');
    this.currentSession = session;
    this.liveUser = session.user;
    this.storageBlocked = false;
    this.storageRevision += 1;
    this.recoveryExchangeSequence += 1;
    return Promise.resolve({
      source: 'PKCE_CODE_EXCHANGE' as const,
      sequence: this.recoveryExchangeSequence,
      session,
    });
  }
  signOut(options?: { scope?: string }) {
    this.calls.push(`signOut:${options?.scope ?? 'global'}`);
    if (this.signOutHandler) return this.signOutHandler();
    return Promise.resolve({ error: null });
  }
  resetPasswordForEmail(email: string, options: { redirectTo: string }) {
    this.resetRequests.push({ email, redirectTo: options.redirectTo });
    return Promise.resolve({ data: {}, error: this.resetError });
  }
  updateUser(attributes: { password: string }) {
    this.passwordUpdates.push(attributes.password);
    if (this.updateUserHandler) return this.updateUserHandler();
    if (this.updateError) {
      return Promise.resolve({ data: { user: null }, error: this.updateError });
    }
    if (this.currentSession) {
      for (const callback of [...this.callbacks]) callback('USER_UPDATED', this.currentSession);
    }
    return Promise.resolve({ data: { user: this.liveUser }, error: null });
  }
  from(table: string) {
    if (table === 'profiles') return new ProfileQuery(this);
    if (table in this.organizationFixtures) return new OrganizationQuery(this, table);
    throw new Error(`Unexpected authority table: ${table}`);
  }
  emit(event: AuthChangeEvent, session: Session | null) {
    this.currentSession = session;
    this.liveUser = session?.user ?? null;
    this.storageRevision += 1;
    if (event === 'PASSWORD_RECOVERY' && session) {
      this.setRecoveryQuarantine(true);
      this.recoverySequence += 1;
      this.pendingRecovery = { source: 'PASSWORD_RECOVERY', sequence: this.recoverySequence, session };
    } else if (event === 'SIGNED_OUT') {
      this.pendingRecovery = null;
    }
    for (const callback of [...this.callbacks]) callback(event, session);
  }
  claimRecovery(event: AuthChangeEvent, session: Session | null) {
    if (event !== 'PASSWORD_RECOVERY' || !session || !this.pendingRecovery) return null;
    if (this.pendingRecovery.session.user.id !== session.user.id
      || this.pendingRecovery.session.access_token !== session.access_token) return null;
    const capability = this.pendingRecovery;
    this.pendingRecovery = null;
    return capability;
  }
  consumeRecovery() {
    const capability = this.pendingRecovery;
    this.pendingRecovery = null;
    return capability;
  }
  clearRecoveryProvenance() { this.pendingRecovery = null; }
  setRecoveryQuarantine(active: boolean) {
    const changed = this.recoveryQuarantined !== active;
    this.recoveryQuarantined = active;
    if (changed) for (const listener of [...this.quarantineListeners]) listener(active);
    return true;
  }
  subscribeRecoveryQuarantine(listener: (active: boolean) => void) {
    this.quarantineListeners.push(listener);
    return () => {
      this.quarantineListeners = this.quarantineListeners.filter((candidate) => candidate !== listener);
    };
  }
  beginAuthPersistence() {
    this.storageBlocked = false;
    this.storageRevision += 1;
  }
  purgeAuthStorage() {
    this.calls.push('purgeAuthStorage');
    this.storageBlocked = true;
    this.currentSession = null;
    this.storageRevision += 1;
    return true;
  }
}

let observed: ReturnType<typeof useAuth> | null = null;

function Gate() {
  observed = useAuth();
  if (observed.status === 'password_recovery' || observed.recoveryCallbackActive) {
    return <PasswordRecoveryScreen />;
  }
  if (observed.status === 'unauthenticated') return <AuthScreen />;
  return (
    <div>
      <span data-testid="status">{observed.status}</span>
      <span data-testid="identity">{observed.user?.id ?? 'none'}</span>
      <span data-testid="crm">{observed.status === 'authenticated' ? 'ready-for-organization-check' : 'blocked'}</span>
    </div>
  );
}

function Probe({ children }: { children?: ReactNode }) {
  observed = useAuth();
  return (
    <div>
      <span data-testid="status">{observed.status}</span>
      <span data-testid="recovery-status">{observed.recoveryStatus}</span>
      <span data-testid="identity">{observed.user?.id ?? 'none'}</span>
      {children}
    </div>
  );
}

function renderGate() {
  return render(<AuthProvider><Gate /></AuthProvider>);
}

function renderProbe(children?: ReactNode) {
  return render(<AuthProvider><Probe>{children}</Probe></AuthProvider>);
}

let observedOrganization: ReturnType<typeof useOrganization> | null = null;
let observedTenant: ReturnType<typeof useTenantData> | null = null;

function CombinedAuthorityProbe() {
  observed = useAuth();
  observedOrganization = useOrganization();
  observedTenant = useTenantData();
  return <span data-testid="combined-auth-status">{observed.status}</span>;
}

function renderCombinedAuthority() {
  return render(
    <AuthProvider>
      <OrganizationProvider>
        <TenantDataProvider>
          <CombinedAuthorityProbe />
        </TenantDataProvider>
      </OrganizationProvider>
    </AuthProvider>,
  );
}

async function waitForUnauthenticated() {
  await waitFor(() => expect(observed?.status).toBe('unauthenticated'));
}

async function startRecovery(id = 'user-a', overrides: Partial<Profile> = {}) {
  dependencies.client!.profileHandler = (userId) => ({ data: [profile(userId, overrides)], error: null });
  dependencies.client!.recoveryExchangeSession = authSession(
    id,
    `${id}-recovery-token`,
    'recovery_pending_v1',
  );
  window.history.pushState({}, '', '/auth/recovery?code=valid-recovery-code');
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await waitFor(() => expect(observed?.status).toBe('password_recovery'));
}

async function submitPassword(password = 'valid-password') {
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
  await waitFor(() => expect(dependencies.client!.passwordUpdates.length).toBeGreaterThan(0));
}

function configureOrganizationB() {
  dependencies.client!.organizationFixtures = {
    organization_members: [{
      id: 'member-b', organization_id: 'organization-b', user_id: 'user-b',
      job_title: 'Owner', status: 'active', created_at: '2026-01-01', updated_at: '2026-01-01',
    }],
    organizations: [{
      id: 'organization-b', name: 'Organization B', slug: 'organization-b', status: 'active',
      created_at: '2026-01-01', updated_at: '2026-01-01',
    }],
    organization_member_roles: [{ organization_role_id: 'role-b' }],
    organization_roles: [{
      id: 'role-b', organization_id: 'organization-b', name: 'Owner', key: 'owner',
      is_system: true, created_at: '2026-01-01', updated_at: '2026-01-01',
    }],
    organization_role_permissions: [{
      organization_role_id: 'role-b', permission_key: 'clients.read',
    }],
    permissions: PERMISSION_KEYS.map((key) => ({ key })),
  };
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  dependencies.client = new FakeSupabase();
  observed = null;
});

describe('Batch 5E-B3 reset request', () => {
  it('1. Forgot Password renders', async () => {
    renderGate();
    await waitForUnauthenticated();
    expect(screen.getByRole('button', { name: /forgot password/i })).toBeTruthy();
  });

  it('2. reset request uses the one explicit same-app callback', async () => {
    renderGate();
    await waitForUnauthenticated();
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(dependencies.client!.resetRequests).toHaveLength(1));
    expect(dependencies.client!.resetRequests[0].redirectTo).toBe(getPasswordRecoveryRedirectUrl());
    expect(new URL(dependencies.client!.resetRequests[0].redirectTo).pathname).toBe('/auth/recovery');
  });

  it('3. unknown email receives the generic non-enumerating response', async () => {
    renderGate();
    await waitForUnauthenticated();
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'unknown@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(await screen.findByText(PASSWORD_RESET_REQUEST_CONFIRMATION)).toBeTruthy();
  });

  it('4. raw reset-provider errors never render', async () => {
    dependencies.client!.resetError = { message: 'identity does not exist; rate detail 123' };
    renderGate();
    await waitForUnauthenticated();
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'unknown@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(await screen.findByText(AUTH_MESSAGES.passwordResetFailed)).toBeTruthy();
    expect(document.body.textContent).not.toContain('identity does not exist');
  });

  it('5. public signup remains absent', async () => {
    renderGate();
    await waitForUnauthenticated();
    expect(screen.queryByText(/sign up/i)).toBeNull();
    expect(screen.queryByText(/create account/i)).toBeNull();
  });
});

describe('Batch 5E-B3 recovery event lifecycle', () => {
  it('6. PASSWORD_RECOVERY opens the Set New Password UI', async () => {
    renderGate(); await waitForUnauthenticated(); await startRecovery();
    expect(screen.getByRole('heading', { name: /set a new password/i })).toBeTruthy();
  });

  it('7. normal SIGNED_IN never opens recovery UI', async () => {
    renderGate(); await waitForUnauthenticated();
    act(() => dependencies.client!.emit('SIGNED_IN', authSession('user-a')));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('heading', { name: /set a new password/i })).toBeNull();
  });

  it('8. recovery does not render a CRM-ready state before completion', async () => {
    renderGate(); await waitForUnauthenticated(); await startRecovery();
    expect(screen.queryByTestId('crm')).toBeNull();
    expect(observed?.status).toBe('password_recovery');
  });

  it('9. a recovery event replay after logout is ignored', async () => {
    renderGate(); await waitForUnauthenticated(); await startRecovery();
    await act(async () => { await observed!.signOut(); });
    act(() => dependencies.client!.emit('PASSWORD_RECOVERY', authSession('user-a', 'old-token')));
    await act(async () => { await Promise.resolve(); });
    expect(observed?.status).toBe('verification_error');
    expect(observed?.recoveryCanUpdate).toBe(false);
  });

  it('10. genuine recovery A after B login quarantines B and binds only A', async () => {
    renderGate(); await waitForUnauthenticated();
    dependencies.client!.nextSignInSession = authSession('user-b', 'b-token');
    await act(async () => { await observed!.signIn('user-b@example.test', 'password'); });
    await waitFor(() => expect(observed?.status).toBe('authenticated'));
    await startRecovery('user-a');
    expect(observed?.user?.id).toBe('user-a');
    expect(observed?.profile?.id).toBe('user-a');
    expect(screen.getByRole('heading', { name: /set a new password/i })).toBeTruthy();
  });

  it('11. a prior A recovery event is rejected after A logs in in a newer generation', async () => {
    renderGate(); await waitForUnauthenticated(); await startRecovery();
    await act(async () => { await observed!.signOut(); });
    dependencies.client!.nextSignInSession = authSession('user-a', 'new-login-token');
    await act(async () => { await observed!.signIn('user-a@example.test', 'password'); });
    act(() => dependencies.client!.emit('PASSWORD_RECOVERY', authSession('user-a', 'user-a-recovery-token')));
    await act(async () => { await Promise.resolve(); });
    expect(observed?.status).toBe('verification_error');
    expect(observed?.session).toBeNull();
    expect(observed?.recoveryCanUpdate).toBe(false);
  });
});

describe('Batch 5E-B3 password update', () => {
  it('12. matching valid passwords call updateUser exactly once', async () => {
    renderProbe(<PasswordRecoveryScreen />); await waitForUnauthenticated(); await startRecovery();
    await submitPassword();
    expect(dependencies.client!.passwordUpdates).toEqual(['valid-password']);
  });

  it('13. mismatched confirmation is blocked before updateUser', async () => {
    renderProbe(<PasswordRecoveryScreen />); await waitForUnauthenticated(); await startRecovery();
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'valid-password' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'different-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText('Passwords do not match.')).toBeTruthy();
    expect(dependencies.client!.passwordUpdates).toHaveLength(0);
  });

  it('14. short password is blocked before updateUser', async () => {
    renderProbe(<PasswordRecoveryScreen />); await waitForUnauthenticated(); await startRecovery();
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText(`Use at least ${MINIMUM_PASSWORD_LENGTH} characters.`)).toBeTruthy();
    expect(dependencies.client!.passwordUpdates).toHaveLength(0);
  });

  it('15. update failure is generic and does not expose provider detail', async () => {
    dependencies.client!.updateError = { message: 'Auth backend SQL and user secret detail' };
    renderProbe(<PasswordRecoveryScreen />); await waitForUnauthenticated(); await startRecovery();
    await submitPassword();
    expect(await screen.findByText(AUTH_MESSAGES.passwordUpdateFailed)).toBeTruthy();
    expect(document.body.textContent).not.toContain('Auth backend SQL');
  });

  it('16. success clears both sensitive form fields', async () => {
    renderProbe(<PasswordRecoveryScreen />); await waitForUnauthenticated(); await startRecovery();
    await submitPassword();
    await waitFor(() => {
      expect(screen.queryByLabelText('New Password')).toBeNull();
      expect(screen.queryByLabelText('Confirm New Password')).toBeNull();
    });
  });

  it('17. success consumes the recovery lifecycle', async () => {
    renderProbe(<PasswordRecoveryScreen />); await waitForUnauthenticated(); await startRecovery();
    const recoverySession = dependencies.client!.currentSession;
    await submitPassword();
    await waitFor(() => expect(observed?.recoveryStatus).toBe('password_updated'));
    const serverSignOut = dependencies.client!.calls.indexOf('signOut:local');
    const storagePurge = dependencies.client!.calls.indexOf('purgeAuthStorage');
    expect(serverSignOut).toBeGreaterThan(-1);
    expect(storagePurge).toBeGreaterThan(serverSignOut);
    expect(observed?.status).toBe('unauthenticated');
    expect(observed?.recoveryCanUpdate).toBe(false);
    act(() => dependencies.client!.emit('TOKEN_REFRESHED', recoverySession));
    expect(observed?.status).toBe('unauthenticated');
  });

  it('18. consumed recovery cannot replay updateUser', async () => {
    renderProbe(<PasswordRecoveryScreen />); await waitForUnauthenticated(); await startRecovery();
    await submitPassword();
    await waitFor(() => expect(observed?.recoveryStatus).toBe('password_updated'));
    expect(await observed!.updateRecoveryPassword('another-valid-password')).toEqual({
      error: AUTH_MESSAGES.passwordUpdateFailed,
    });
    expect(dependencies.client!.passwordUpdates).toHaveLength(1);
  });

  it('a failed Supabase Auth sign-out cannot be treated as successful browser cleanup', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery();
    dependencies.client!.signOutHandler = () => Promise.resolve({
      error: { message: 'server sign-out failed' },
    });
    expect(await observed!.updateRecoveryPassword('valid-password')).toEqual({
      error: AUTH_MESSAGES.passwordUpdateFailed,
    });
    expect(dependencies.client!.calls).toContain('signOut:local');
    expect(dependencies.client!.calls).not.toContain('purgeAuthStorage');
    expect(dependencies.client!.recoveryQuarantined).toBe(true);
    expect(observed?.status).toBe('verification_error');
  });
});

describe('Batch 5E-B3 post-reset authorization boundary', () => {
  it('19. active Owner returns only to normal auth verification, not embedded Owner authority', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery('owner', { role: 'super_admin' });
    expect(await observed!.updateRecoveryPassword('valid-password')).toEqual({ error: null });
    expect(observed?.status).toBe('unauthenticated');
    expect(Object.keys(observed ?? {})).not.toContain('permissions');
    dependencies.client!.nextSignInSession = authSession('owner', 'fresh-normal-token', 'normal_v1');
    expect(await observed!.signIn('owner@example.test', 'new-password')).toEqual({ error: null });
    expect(observed?.status).toBe('authenticated');
  });

  it('20. Demo Admin recovery does not encode or change organization authority', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery('demo-admin');
    await observed!.updateRecoveryPassword('valid-password');
    expect(dependencies.client!.calls.some((call) => call.includes('organization'))).toBe(false);
  });

  it('21. no-membership identity gains no membership during recovery', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery('no-membership');
    await observed!.updateRecoveryPassword('valid-password');
    expect(dependencies.client!.calls.filter((call) => call.startsWith('profile:'))).not.toHaveLength(0);
    expect(dependencies.client!.calls.some((call) => call.includes('organization_members'))).toBe(false);
  });

  it('22. suspended membership cannot be reactivated by password recovery', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery('suspended');
    await observed!.updateRecoveryPassword('valid-password');
    expect(dependencies.client!.calls.some((call) => /membership|status/.test(call))).toBe(false);
  });

  it('23. inactive profile can change password but must sign in again', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery('inactive', { active: false });
    expect(observed?.status).toBe('password_recovery');
    expect(await observed!.updateRecoveryPassword('valid-password')).toEqual({ error: null });
    expect(observed?.status).toBe('unauthenticated');
  });

  it('24. roleless membership receives no Staff fallback from recovery', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery('roleless');
    await observed!.updateRecoveryPassword('valid-password');
    expect(dependencies.client!.calls.some((call) => call.startsWith('organization_'))).toBe(false);
  });

  it('25. Client access remains unavailable and unassigned', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery('client');
    await observed!.updateRecoveryPassword('valid-password');
    expect(dependencies.client!.calls.some((call) => call.startsWith('organization_'))).toBe(false);
  });
});

describe('Batch 5E-B3 callback and URL safety', () => {
  it('26. a valid fixed-path callback is processed', async () => {
    renderGate(); await waitForUnauthenticated(); await startRecovery();
    expect(observed?.recoveryStatus).toBe('recovery_session');
  });

  it('27. an explicit PKCE code exchange, rather than pathname alone, establishes capability', async () => {
    renderGate(); await waitForUnauthenticated(); await startRecovery('user-a');
    expect(observed?.user?.id).toBe('user-a');
  });

  it('28. callback without a session shows a generic recovery failure', async () => {
    window.history.replaceState({}, '', '/auth/recovery?code=missing');
    renderGate();
    expect(await screen.findByText(AUTH_MESSAGES.recoveryFailed)).toBeTruthy();
    expect(screen.queryByTestId('crm')).toBeNull();
  });

  it('29. sensitive query and hash material is cleaned after SDK processing', async () => {
    renderGate(); await waitForUnauthenticated(); await startRecovery();
    expect(window.location.pathname).toBe('/auth/recovery');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('30. arbitrary external redirect input cannot affect the approved destination', () => {
    window.history.replaceState({}, '', '/?redirect=https%3A%2F%2Fevil.example%2Fsteal&next=//evil.example');
    const redirect = new URL(getPasswordRecoveryRedirectUrl());
    expect(redirect.origin).toBe(window.location.origin);
    expect(redirect.pathname).toBe('/auth/recovery');
    expect(redirect.search).toBe('');
  });

  it('rejects empty, short, and mismatched passwords centrally', () => {
    expect(validateRecoveryPassword('', '')).not.toBeNull();
    expect(validateRecoveryPassword('short', 'short')).not.toBeNull();
    expect(validateRecoveryPassword('valid-password', 'different')).not.toBeNull();
  });
});

describe('Batch 5E-B3-R recovery provenance hardening', () => {
  it('32. persisted B plus bare recovery path grants no recovery capability', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    window.history.replaceState({}, '', '/auth/recovery');
    renderGate();
    expect(await screen.findByText(AUTH_MESSAGES.recoveryFailed)).toBeTruthy();
    expect(screen.queryByLabelText('New Password')).toBeNull();
    expect(observed?.user).toBeNull();
    expect(dependencies.client!.passwordUpdates).toHaveLength(0);
  });

  it('33. malformed recovery URL quarantines an ordinary persisted B session', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    window.history.replaceState({}, '', '/auth/recovery?error=access_denied#provider_detail');
    renderGate();
    expect(await screen.findByText(AUTH_MESSAGES.recoveryFailed)).toBeTruthy();
    expect(observed?.status).toBe('verification_error');
    expect(observed?.profile).toBeNull();
    expect(screen.queryByTestId('crm')).toBeNull();
  });

  it('34. INITIAL_SESSION B on recovery pathname cannot manufacture recovery', async () => {
    window.history.replaceState({}, '', '/auth/recovery');
    renderGate();
    act(() => dependencies.client!.emit('INITIAL_SESSION', authSession('user-b', 'b-token')));
    expect(await screen.findByText(AUTH_MESSAGES.recoveryFailed)).toBeTruthy();
    expect(observed?.status).not.toBe('password_recovery');
    expect(observed?.recoveryCanUpdate).toBe(false);
  });

  it('35. SIGNED_IN B on recovery pathname cannot manufacture recovery', async () => {
    window.history.replaceState({}, '', '/auth/recovery');
    renderGate();
    act(() => dependencies.client!.emit('SIGNED_IN', authSession('user-b', 'b-token')));
    expect(await screen.findByText(AUTH_MESSAGES.recoveryFailed)).toBeTruthy();
    expect(observed?.status).toBe('verification_error');
    expect(observed?.recoveryCanUpdate).toBe(false);
  });

  it('36. null PASSWORD_RECOVERY while B is authenticated clears B authority', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    renderGate();
    await waitFor(() => expect(observed?.status).toBe('authenticated'));
    window.history.replaceState({}, '', '/auth/recovery?code=invalid');
    act(() => dependencies.client!.emit('PASSWORD_RECOVERY', null));
    expect(await screen.findByText(AUTH_MESSAGES.recoveryFailed)).toBeTruthy();
    expect(observed?.user).toBeNull();
    expect(observed?.profile).toBeNull();
    expect(screen.queryByTestId('crm')).toBeNull();
  });

  it('37. expired callback while B is authenticated exposes neither CRM nor password update', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    renderGate();
    await waitFor(() => expect(observed?.status).toBe('authenticated'));
    window.history.replaceState({}, '', '/auth/recovery?error_code=otp_expired');
    act(() => dependencies.client!.emit('SIGNED_IN', authSession('user-b', 'b-token')));
    expect(await screen.findByText(AUTH_MESSAGES.recoveryFailed)).toBeTruthy();
    expect(screen.queryByTestId('crm')).toBeNull();
    expect(await observed!.updateRecoveryPassword('valid-password')).toEqual({
      error: AUTH_MESSAGES.passwordUpdateFailed,
    });
    expect(dependencies.client!.passwordUpdates).toHaveLength(0);
  });

  it('38. cold persisted B plus genuine recovery A binds only A', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    dependencies.client!.recoveryExchangeSession = authSession(
      'user-a',
      'a-recovery-token',
      'recovery_pending_v1',
    );
    window.history.replaceState({}, '', '/auth/recovery?code=valid-recovery-code');
    renderGate();
    await waitFor(() => expect(observed?.status).toBe('password_recovery'));
    expect(observed?.user?.id).toBe('user-a');
    expect(observed?.profile?.id).toBe('user-a');
    expect(screen.queryByTestId('crm')).toBeNull();
    expect(screen.getByLabelText('New Password')).toBeTruthy();
  });

  it('39. active B authority is invalidated before recovery A verification completes', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    renderProbe();
    await waitFor(() => expect(observed?.status).toBe('authenticated'));

    let releaseUser!: (value: Result<{ user: User | null }>) => void;
    dependencies.client!.getUserHandler = () => new Promise((resolve) => { releaseUser = resolve; });
    dependencies.client!.recoveryExchangeSession = authSession(
      'user-a',
      'a-token',
      'recovery_pending_v1',
    );
    window.history.replaceState({}, '', '/auth/recovery?code=valid-recovery-code');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await waitFor(() => expect(typeof releaseUser).toBe('function'));
    expect(observed?.status).toBe('loading');
    expect(observed?.user).toBeNull();
    expect(observed?.profile).toBeNull();

    await act(async () => {
      releaseUser({ data: { user: authUser('user-a') }, error: null });
    });
    await waitFor(() => expect(observed?.status).toBe('password_recovery'));
    expect(observed?.user?.id).toBe('user-a');
  });

  it('40. leaving a rejected bare recovery path leaves no latent capability', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    window.history.replaceState({}, '', '/auth/recovery');
    renderGate();
    expect(await screen.findByText(AUTH_MESSAGES.recoveryFailed)).toBeTruthy();
    window.history.replaceState({}, '', '/');
    expect(observed?.recoveryCanUpdate).toBe(false);
    expect(await observed!.updateRecoveryPassword('valid-password')).toEqual({
      error: AUTH_MESSAGES.passwordUpdateFailed,
    });
    expect(dependencies.client!.passwordUpdates).toHaveLength(0);
  });

  it('41. bootstrap cannot construct capability from an ordinary Session object', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    window.history.replaceState({}, '', '/auth/recovery');
    renderProbe(<PasswordRecoveryScreen />);
    await waitFor(() => expect(observed?.recoveryStatus).toBe('recovery_error'));
    expect(observed?.recoveryCanUpdate).toBe(false);
    expect(await observed!.updateRecoveryPassword('valid-password')).toEqual({
      error: AUTH_MESSAGES.passwordUpdateFailed,
    });
  });

  it('42. updateUser is unreachable for an ordinary authenticated session', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    renderProbe();
    await waitFor(() => expect(observed?.status).toBe('authenticated'));
    expect(await observed!.updateRecoveryPassword('valid-password')).toEqual({
      error: AUTH_MESSAGES.passwordUpdateFailed,
    });
    expect(dependencies.client!.passwordUpdates).toHaveLength(0);
  });

  it('43. a consumed recovery token from an older generation cannot replay', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery('user-a');
    await act(async () => { await observed!.signOut(); });
    dependencies.client!.nextSignInSession = authSession('user-a', 'new-login-token');
    await act(async () => { await observed!.signIn('user-a@example.test', 'password'); });
    act(() => dependencies.client!.emit(
      'PASSWORD_RECOVERY',
      authSession('user-a', 'user-a-recovery-token'),
    ));
    await act(async () => { await Promise.resolve(); });
    expect(observed?.status).toBe('verification_error');
    expect(observed?.session).toBeNull();
    expect(observed?.recoveryCanUpdate).toBe(false);
  });
});

describe('Batch 5E-B3-R2 durable recovery quarantine', () => {
  it('44. a genuine recovery event establishes durable denial', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery();
    expect(dependencies.client!.recoveryQuarantined).toBe(true);
  });

  it('45. quarantine alone on root publishes no CRM authority or update capability', async () => {
    dependencies.client!.currentSession = authSession('user-a', 'persisted-recovery-token');
    dependencies.client!.liveUser = authUser('user-a');
    dependencies.client!.setRecoveryQuarantine(true);
    renderGate();
    expect(await screen.findByText(AUTH_MESSAGES.recoveryFailed)).toBeTruthy();
    expect(observed?.session).toBeNull();
    expect(observed?.user).toBeNull();
    expect(observed?.profile).toBeNull();
    expect(observed?.recoveryCanUpdate).toBe(false);
    expect(await observed!.updateRecoveryPassword('valid-password')).toEqual({
      error: AUTH_MESSAGES.passwordUpdateFailed,
    });
    expect(dependencies.client!.passwordUpdates).toHaveLength(0);
  });

  it('46. AuthContext remount and root navigation retain quarantine without reconstructing capability', async () => {
    const first = renderGate(); await waitForUnauthenticated(); await startRecovery();
    expect(observed?.recoveryCanUpdate).toBe(true);
    first.unmount();
    window.history.replaceState({}, '', '/');
    renderGate();
    expect(await screen.findByText(AUTH_MESSAGES.recoveryFailed)).toBeTruthy();
    expect(observed?.status).toBe('verification_error');
    expect(observed?.recoveryCanUpdate).toBe(false);
    expect(observed?.user).toBeNull();
  });

  it('47. recovery-route reload without a fresh SDK event remains denied', async () => {
    dependencies.client!.currentSession = authSession('user-a', 'persisted-recovery-token');
    dependencies.client!.liveUser = authUser('user-a');
    dependencies.client!.setRecoveryQuarantine(true);
    window.history.replaceState({}, '', '/auth/recovery');
    renderGate();
    expect(await screen.findByText(AUTH_MESSAGES.recoveryFailed)).toBeTruthy();
    expect(observed?.recoveryCanUpdate).toBe(false);
  });

  it('48. successful password update clears quarantine only after post-update checks', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery();
    expect(dependencies.client!.recoveryQuarantined).toBe(true);
    expect(await observed!.updateRecoveryPassword('valid-password')).toEqual({ error: null });
    expect(dependencies.client!.recoveryQuarantined).toBe(false);
    expect(observed?.status).toBe('unauthenticated');
    expect(observed?.recoveryStatus).toBe('password_updated');
  });

  it('49. failed password update retains quarantine', async () => {
    dependencies.client!.updateError = { message: 'provider detail' };
    renderProbe(); await waitForUnauthenticated(); await startRecovery();
    expect(await observed!.updateRecoveryPassword('valid-password')).toEqual({
      error: AUTH_MESSAGES.passwordUpdateFailed,
    });
    expect(dependencies.client!.recoveryQuarantined).toBe(true);
    expect(observed?.session).toBeNull();
  });

  it('50. Return to sign in purges the persisted recovery session before clearing quarantine', async () => {
    renderGate(); await waitForUnauthenticated(); await startRecovery();
    await act(async () => { await observed!.signOut(); });
    expect(dependencies.client!.calls.indexOf('purgeAuthStorage')).toBeGreaterThan(-1);
    expect(dependencies.client!.recoveryQuarantined).toBe(false);
    expect(dependencies.client!.storageBlocked).toBe(true);
    expect(observed?.status).toBe('unauthenticated');
  });

  it('51. remote sign-out failure cannot resurrect a locally purged recovery session', async () => {
    renderGate(); await waitForUnauthenticated(); await startRecovery();
    dependencies.client!.signOutFailure = new Error('network unavailable');
    await act(async () => { await observed!.signOut(); });
    expect(dependencies.client!.storageBlocked).toBe(true);
    expect(dependencies.client!.currentSession).toBeNull();
    expect(dependencies.client!.recoveryQuarantined).toBe(false);
    expect(observed?.session).toBeNull();
  });

  it('52. cross-tab quarantine activation synchronously drops existing CRM authority', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    renderProbe();
    await waitFor(() => expect(observed?.status).toBe('authenticated'));
    act(() => { dependencies.client!.setRecoveryQuarantine(true); });
    expect(observed?.status).toBe('verification_error');
    expect(observed?.user).toBeNull();
    expect(observed?.profile).toBeNull();
  });

  it('53. uncorrelated cross-tab marker removal denies the persisted session', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    renderProbe();
    await waitFor(() => expect(observed?.status).toBe('authenticated'));
    const liveChecksBefore = dependencies.client!.calls.filter((call) => call === 'getUser').length;
    act(() => { dependencies.client!.setRecoveryQuarantine(true); });
    await act(async () => { dependencies.client!.setRecoveryQuarantine(false); });
    await waitFor(() => expect(observed?.status).toBe('unauthenticated'));
    expect(observed?.session).toBeNull();
    expect(observed?.user).toBeNull();
    expect(observed?.profile).toBeNull();
    expect(dependencies.client!.storageBlocked).toBe(true);
    expect(dependencies.client!.calls.filter((call) => call === 'getUser')).toHaveLength(liveChecksBefore);
  });

  it('54. simultaneous password submissions invoke updateUser exactly once', async () => {
    let release!: () => void;
    const blocked = new Promise<Result<{ user: User | null }>>((resolve) => {
      release = () => resolve({ data: { user: dependencies.client!.liveUser }, error: null });
    });
    dependencies.client!.updateUserHandler = () => blocked;
    renderProbe(); await waitForUnauthenticated(); await startRecovery();
    let first!: Promise<{ error: string | null }>;
    let second!: Promise<{ error: string | null }>;
    act(() => {
      first = observed!.updateRecoveryPassword('valid-password');
      second = observed!.updateRecoveryPassword('another-valid-password');
    });
    await waitFor(() => expect(dependencies.client!.passwordUpdates).toEqual(['valid-password']));
    expect(await second).toEqual({ error: AUTH_MESSAGES.passwordUpdateFailed });
    await act(async () => { release(); await first; });
    expect(dependencies.client!.passwordUpdates).toHaveLength(1);
  });

  it('55. Auth + Organization recovery clears organization authority and tenant scope', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    configureOrganizationB();
    renderCombinedAuthority();
    await waitFor(() => expect(observedOrganization?.currentOrganization?.id).toBe('organization-b'));
    expect(observedOrganization?.roles.map((role) => role.name)).toEqual(['Owner']);
    expect(observedOrganization?.permissions.has('clients.read')).toBe(true);
    const tenantBeforeRecovery = observedTenant;

    await startRecovery('user-a');
    expect(observedOrganization?.currentOrganization).toBeNull();
    expect(observedOrganization?.membership).toBeNull();
    expect(observedOrganization?.roles).toEqual([]);
    expect(observedOrganization?.permissions.size).toBe(0);
    expect(observedTenant).not.toBe(tenantBeforeRecovery);
  });

  it.each<AuthChangeEvent>(['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'])(
    '56-58. recovery A plus %s for B fails closed without relabelling B',
    async (event) => {
      renderProbe(); await waitForUnauthenticated(); await startRecovery('user-a');
      act(() => dependencies.client!.emit(event, authSession('user-b', 'b-token')));
      await waitFor(() => expect(observed?.status).toBe('verification_error'));
      expect(observed?.user).toBeNull();
      expect(observed?.recoveryCanUpdate).toBe(false);
      expect(dependencies.client!.passwordUpdates).toHaveLength(0);
    },
  );

  it('59. recovery A followed by genuine recovery B fails closed', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery('user-a');
    act(() => dependencies.client!.emit(
      'PASSWORD_RECOVERY',
      authSession('user-b', 'b-recovery-token'),
    ));
    await waitFor(() => expect(observed?.status).toBe('verification_error'));
    expect(observed?.user).toBeNull();
    expect(observed?.recoveryCanUpdate).toBe(false);
  });

  it('60. verified success retains quarantine until deferred post-update live verification and sign-out', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery('user-a');
    const finalUser = deferred<Result<{ user: User | null }>>();
    let checks = 0;
    dependencies.client!.getUserHandler = () => {
      checks += 1;
      if (checks === 2) return finalUser.promise;
      return Promise.resolve({ data: { user: dependencies.client!.liveUser }, error: null });
    };

    let update!: Promise<{ error: string | null }>;
    act(() => { update = observed!.updateRecoveryPassword('valid-password'); });
    await waitFor(() => expect(dependencies.client!.passwordUpdates).toEqual(['valid-password']));
    await waitFor(() => expect(checks).toBe(2));
    expect(dependencies.client!.recoveryQuarantined).toBe(true);
    expect(observed?.status).toBe('password_recovery');

    await act(async () => {
      finalUser.resolve({ data: { user: dependencies.client!.liveUser }, error: null });
      await update;
    });
    expect(dependencies.client!.recoveryQuarantined).toBe(false);
    expect(observed?.status).toBe('unauthenticated');
    expect(observed?.recoveryStatus).toBe('password_updated');
  });

  it('61. failed deferred post-update verification never clears quarantine', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery('user-a');
    let checks = 0;
    dependencies.client!.getUserHandler = () => {
      checks += 1;
      return Promise.resolve(checks === 2
        ? { data: { user: null }, error: { message: 'post-update verification failed' } }
        : { data: { user: dependencies.client!.liveUser }, error: null });
    };

    expect(await observed!.updateRecoveryPassword('valid-password')).toEqual({
      error: AUTH_MESSAGES.passwordUpdateFailed,
    });
    expect(dependencies.client!.passwordUpdates).toEqual(['valid-password']);
    expect(dependencies.client!.recoveryQuarantined).toBe(true);
    expect(observed?.status).toBe('verification_error');
    expect(observed?.session).toBeNull();
  });

  it('62. abandonment retains quarantine until local purge and deferred sign-out finish', async () => {
    renderProbe(); await waitForUnauthenticated(); await startRecovery('user-a');
    const remoteSignOut = deferred<{ error: null }>();
    dependencies.client!.signOutHandler = () => remoteSignOut.promise;

    let abandonment!: Promise<{ error: string | null }>;
    act(() => { abandonment = observed!.signOut(); });
    await waitFor(() => expect(dependencies.client!.calls).toContain('purgeAuthStorage'));
    expect(dependencies.client!.storageBlocked).toBe(true);
    expect(dependencies.client!.recoveryQuarantined).toBe(true);

    await act(async () => {
      remoteSignOut.resolve({ error: null });
      await abandonment;
    });
    expect(dependencies.client!.recoveryQuarantined).toBe(false);
    expect(observed?.status).toBe('unauthenticated');
  });

  it('63. explicit fresh login succeeds after uncorrelated removal entered signed-out denial', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    renderProbe();
    await waitFor(() => expect(observed?.status).toBe('authenticated'));
    act(() => dependencies.client!.setRecoveryQuarantine(true));
    act(() => dependencies.client!.setRecoveryQuarantine(false));
    await waitFor(() => expect(observed?.status).toBe('unauthenticated'));

    dependencies.client!.nextSignInSession = authSession('user-b', 'fresh-login-token');
    await act(async () => {
      expect(await observed!.signIn('user-b@example.test', 'valid-password')).toEqual({ error: null });
    });
    expect(observed?.status).toBe('authenticated');
    expect(observed?.user?.id).toBe('user-b');
  });

  it('64. external marker removal keeps loaded organization and tenant authority cleared', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    configureOrganizationB();
    renderCombinedAuthority();
    await waitFor(() => expect(observedOrganization?.currentOrganization?.id).toBe('organization-b'));
    const tenantBeforeRemoval = observedTenant;

    act(() => dependencies.client!.setRecoveryQuarantine(true));
    act(() => dependencies.client!.setRecoveryQuarantine(false));
    await waitFor(() => expect(observed?.status).toBe('unauthenticated'));
    expect(observedOrganization?.currentOrganization).toBeNull();
    expect(observedOrganization?.membership).toBeNull();
    expect(observedOrganization?.roles).toEqual([]);
    expect(observedOrganization?.permissions.size).toBe(0);
    expect(observedTenant).not.toBe(tenantBeforeRemoval);
    await expect(observedTenant!.table('clients').select()).rejects.toThrow();
  });

  it('65. a pending B organization request cannot publish after recovery A begins', async () => {
    dependencies.client!.currentSession = authSession('user-b', 'b-token');
    dependencies.client!.liveUser = authUser('user-b');
    configureOrganizationB();
    const memberships = deferred<Result<unknown[]>>();
    dependencies.client!.organizationHandlers.organization_members = () => memberships.promise;
    renderCombinedAuthority();
    await waitFor(() => expect(dependencies.client!.calls).toContain('organization:organization_members'));

    dependencies.client!.recoveryExchangeSession = authSession(
      'user-a',
      'a-recovery-token',
      'recovery_pending_v1',
    );
    window.history.replaceState({}, '', '/auth/recovery?code=valid-recovery-code');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await waitFor(() => expect(observed?.status).toBe('password_recovery'));
    await act(async () => {
      memberships.resolve({
        data: dependencies.client!.organizationFixtures.organization_members,
        error: null,
      });
      await Promise.resolve();
    });

    expect(observedOrganization?.currentOrganization).toBeNull();
    expect(observedOrganization?.roles).toEqual([]);
    expect(observedOrganization?.permissions.size).toBe(0);
    await expect(observedTenant!.table('clients').select()).rejects.toThrow();
  });
});

describe('Batch 5F-C2 PKCE recovery claim enforcement', () => {
  async function expectRejectedRecoveryState(sessionState: string | null) {
    dependencies.client!.recoveryExchangeSession = authSession(
      'user-a',
      'claim-test-token',
      sessionState,
    );
    window.history.replaceState({}, '', '/auth/recovery?code=valid-recovery-code');
    renderGate();
    expect(await screen.findByText(AUTH_MESSAGES.recoveryFailed)).toBeTruthy();
    expect(observed?.status).toBe('verification_error');
    expect(observed?.recoveryCanUpdate).toBe(false);
    expect(dependencies.client!.passwordUpdates).toHaveLength(0);
  }

  it('rejects a normal_v1 session returned from the recovery exchange', async () => {
    await expectRejectedRecoveryState('normal_v1');
  });

  it('rejects a recovery exchange session with a missing state claim', async () => {
    await expectRejectedRecoveryState(null);
  });

  it('rejects a recovery exchange session with an unknown state claim', async () => {
    await expectRejectedRecoveryState('future_or_forged_state');
  });

  it('does not log the authorization code, session tokens, or password', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    renderProbe();
    await waitForUnauthenticated();
    await startRecovery('user-a');
    expect(await observed!.updateRecoveryPassword('never-log-this-password')).toEqual({ error: null });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
