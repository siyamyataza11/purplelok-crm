import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Profile } from '@/types';

type Result<T> = { data: T; error: { message: string } | null };
type AuthCallback = (event: AuthChangeEvent, session: Session | null) => void;

const dependencies = vi.hoisted(() => ({ client: null as FakeSupabase | null }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => dependencies.client!.getSession(),
      getUser: () => dependencies.client!.getUser(),
      onAuthStateChange: (callback: AuthCallback) => dependencies.client!.onAuthStateChange(callback),
      signInWithPassword: (credentials: { email: string; password: string }) =>
        dependencies.client!.signInWithPassword(credentials),
      signOut: (options?: { scope?: string }) => dependencies.client!.signOut(options),
      resetPasswordForEmail: (email: string) => dependencies.client!.resetPasswordForEmail(email),
    },
    from: (table: string) => dependencies.client!.from(table),
  },
}));

vi.mock('@/lib/supabase-auth-storage', () => ({
  beginSupabaseAuthPersistence: () => dependencies.client!.beginAuthPersistence(),
  getSupabaseAuthStorageRevision: () => dependencies.client!.storageRevision,
  purgeSupabaseAuthStorage: () => dependencies.client!.purgeAuthStorage(),
  withPurgedSupabaseAuthSession: (operation: () => Promise<unknown>) => operation(),
}));

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AUTH_MESSAGES } from '@/lib/auth-errors';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function authUser(id: string): User {
  return { id, email: `${id}@example.test` } as User;
}

function authSession(id: string, token = `${id}-token`): Session {
  return { access_token: token, user: authUser(id) } as Session;
}

function userProfile(
  id: string,
  overrides: Partial<Profile> = {},
): Profile {
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
  private result?: Promise<Result<unknown[]>>;

  constructor(private readonly client: FakeSupabase) {}

  select() { return this; }
  eq(_column: string, value: string) { this.userId = value; return this; }
  limit() { return this; }

  then<TResult1 = Result<unknown[]>, TResult2 = never>(
    onfulfilled?: ((value: Result<unknown[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (!this.result) {
      this.client.calls.push(`profile:${this.userId}`);
      this.result = Promise.resolve().then(() => this.client.profileHandler(this.userId));
    }
    return this.result.then(onfulfilled, onrejected);
  }
}

class FakeSupabase {
  currentSession: Session | null = authSession('user-a');
  liveUser: User | null = authUser('user-a');
  getSessionError: { message: string } | null = null;
  getUserError: { message: string } | null = null;
  signOutError: { message: string } | null = null;
  signOutFailure: unknown = null;
  storageBlocked = false;
  purgeShouldFail = false;
  nextSignInSession: Session | null = null;
  signInEventSession: Session | null | undefined;
  storageRevision = 0;
  profileHandler: (userId: string) => Result<unknown[]> | Promise<Result<unknown[]>> =
    (userId) => ({ data: [userProfile(userId)], error: null });
  getSessionHandler: (() => Promise<Result<{ session: Session | null }>>) | null = null;
  getUserHandler: (() => Promise<Result<{ user: User | null }>>) | null = null;
  callback: AuthCallback | null = null;
  readonly calls: string[] = [];

  getSession() {
    this.calls.push('getSession');
    return this.getSessionHandler?.()
      ?? Promise.resolve({
        data: { session: this.storageBlocked ? null : this.currentSession },
        error: this.getSessionError,
      });
  }

  getUser() {
    this.calls.push('getUser');
    return this.getUserHandler?.()
      ?? Promise.resolve({ data: { user: this.liveUser }, error: this.getUserError });
  }

  onAuthStateChange(callback: AuthCallback) {
    this.callback = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  }

  signInWithPassword(_credentials: { email: string; password: string }) {
    void _credentials;
    this.calls.push('signInWithPassword');
    if (this.nextSignInSession) {
      this.currentSession = this.nextSignInSession;
      this.liveUser = this.nextSignInSession.user;
      this.nextSignInSession = null;
      this.storageRevision += 1;
    }
    this.storageBlocked = false;
    if (this.signInEventSession !== undefined) {
      const eventSession = this.signInEventSession;
      this.signInEventSession = undefined;
      this.callback?.('SIGNED_IN', eventSession);
    }
    return Promise.resolve({ data: { session: this.currentSession }, error: null });
  }

  purgeAuthStorage() {
    this.calls.push('purgeAuthStorage');
    this.storageRevision += 1;
    this.storageBlocked = true;
    if (!this.purgeShouldFail) this.currentSession = null;
    return !this.purgeShouldFail;
  }

  beginAuthPersistence() {
    this.calls.push('beginAuthPersistence');
    this.storageRevision += 1;
    this.storageBlocked = false;
  }

  async signOut(options?: { scope?: string }) {
    this.calls.push(`signOut:${options?.scope ?? 'global'}`);
    if (this.signOutFailure) throw this.signOutFailure;
    return { error: this.signOutError };
  }

  resetPasswordForEmail(_email: string) {
    void _email;
    return Promise.resolve({ data: {}, error: null });
  }

  from(table: string) {
    if (table !== 'profiles') throw new Error(`Unexpected table: ${table}`);
    return new ProfileQuery(this);
  }

  emit(event: AuthChangeEvent, session: Session | null) {
    this.currentSession = session;
    this.liveUser = session?.user ?? null;
    this.storageRevision += 1;
    this.callback?.(event, session);
  }

  replaceStoredSession(session: Session | null) {
    this.currentSession = session;
    this.liveUser = session?.user ?? null;
    this.storageRevision += 1;
  }
}

let observed: ReturnType<typeof useAuth> | null = null;

function Probe({ children }: { children?: ReactNode }) {
  observed = useAuth();
  return (
    <div>
      <span data-testid="status">{observed.status}</span>
      <span data-testid="loading">{String(observed.loading)}</span>
      <span data-testid="user">{observed.user?.id ?? 'none'}</span>
      <span data-testid="profile">{observed.profile?.id ?? 'none'}</span>
      <span data-testid="name">{observed.profile?.full_name ?? 'none'}</span>
      <span data-testid="error">{observed.error ?? 'none'}</span>
      <span data-testid="downstream">{observed.status === 'authenticated' ? 'enabled' : 'blocked'}</span>
      <button onClick={() => void observed?.signOut()}>Sign out test</button>
      <button onClick={() => void observed?.revalidateAuth()}>Revalidate test</button>
      {children}
    </div>
  );
}

function renderAuth(children?: ReactNode) {
  return render(<AuthProvider><Probe>{children}</Probe></AuthProvider>);
}

async function expectStatus(status: string) {
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe(status));
}

beforeEach(() => {
  dependencies.client = new FakeSupabase();
  observed = null;
});

describe('Batch 5E-B2 live auth bootstrap', () => {
  it('accepts persisted session only after live user and active profile verification', async () => {
    renderAuth();
    await expectStatus('authenticated');
    expect(dependencies.client!.calls.slice(0, 4)).toEqual([
      'getSession',
      'getSession',
      'getUser',
      'profile:user-a',
    ]);
    expect(screen.getByTestId('user').textContent).toBe('user-a');
  });

  it('fails closed when persisted session getUser verification fails', async () => {
    dependencies.client!.getUserError = { message: 'user deleted' };
    renderAuth();
    await expectStatus('verification_error');
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(screen.getByTestId('profile').textContent).toBe('none');
  });

  it('fails closed when session and live user IDs differ', async () => {
    dependencies.client!.liveUser = authUser('user-b');
    renderAuth();
    await expectStatus('verification_error');
    expect(screen.getByTestId('error').textContent).toBe(AUTH_MESSAGES.verificationFailed);
  });

  it('denies a live user with a missing profile', async () => {
    dependencies.client!.profileHandler = () => ({ data: [], error: null });
    renderAuth();
    await expectStatus('verification_error');
    expect(screen.getByTestId('downstream').textContent).toBe('blocked');
  });

  it('denies a live user when the profile query fails', async () => {
    dependencies.client!.profileHandler = () => ({ data: null as never, error: { message: 'profile unavailable' } });
    renderAuth();
    await expectStatus('verification_error');
    expect(screen.getByTestId('error').textContent).toBe(AUTH_MESSAGES.verificationFailed);
    expect(document.body.textContent).not.toContain('profile unavailable');
  });

  it('denies an inactive profile with a distinct account-disabled state', async () => {
    dependencies.client!.profileHandler = (id) => ({ data: [userProfile(id, { active: false })], error: null });
    renderAuth();
    await expectStatus('account_disabled');
    expect(screen.getByTestId('downstream').textContent).toBe('blocked');
  });

  it('allows downstream organization resolution only after a valid profile', async () => {
    const pending = deferred<Result<unknown[]>>();
    dependencies.client!.profileHandler = () => pending.promise;
    renderAuth();
    await waitFor(() => expect(dependencies.client!.calls).toContain('profile:user-a'));
    expect(screen.getByTestId('downstream').textContent).toBe('blocked');
    pending.resolve({ data: [userProfile('user-a')], error: null });
    await expectStatus('authenticated');
    expect(screen.getByTestId('downstream').textContent).toBe('enabled');
  });

  it('does not treat legacy profiles.role as application authority', async () => {
    dependencies.client!.profileHandler = (id) => ({
      data: [userProfile(id, { role: 'super_admin' })],
      error: null,
    });
    renderAuth();
    await expectStatus('authenticated');
    expect(Object.keys(observed ?? {})).not.toContain('role');
    expect(Object.keys(observed ?? {})).not.toContain('permissions');
  });
});

describe('Batch 5E-B2 stale async protection', () => {
  it('ignores User A profile success after logout', async () => {
    const pending = deferred<Result<unknown[]>>();
    dependencies.client!.profileHandler = () => pending.promise;
    renderAuth();
    await waitFor(() => expect(dependencies.client!.calls).toContain('profile:user-a'));
    act(() => dependencies.client!.emit('SIGNED_OUT', null));
    await expectStatus('unauthenticated');
    pending.resolve({ data: [userProfile('user-a')], error: null });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('fails closed when bootstrap storage changes from A to unsolicited B while profile A is pending', async () => {
    const pendingA = deferred<Result<unknown[]>>();
    dependencies.client!.profileHandler = (id) => id === 'user-a'
      ? pendingA.promise
      : { data: [userProfile(id)], error: null };
    renderAuth();
    await waitFor(() => expect(dependencies.client!.calls).toContain('profile:user-a'));
    act(() => dependencies.client!.emit('SIGNED_IN', authSession('user-b')));
    pendingA.resolve({ data: [userProfile('user-a')], error: null });
    await expectStatus('verification_error');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('rejects first-generation A after logout and a later A login', async () => {
    const firstA = deferred<Result<unknown[]>>();
    let profileCalls = 0;
    dependencies.client!.profileHandler = (id) => {
      profileCalls += 1;
      return profileCalls === 1 ? firstA.promise : { data: [userProfile(id, { full_name: 'New A' })], error: null };
    };
    renderAuth();
    await waitFor(() => expect(profileCalls).toBe(1));
    await act(async () => { await observed!.signOut(); });
    dependencies.client!.nextSignInSession = authSession('user-a', 'new-a-token');
    await act(async () => { await observed!.signIn('user-a@example.test', 'password'); });
    await expectStatus('authenticated');
    expect(screen.getByTestId('name').textContent).toBe('New A');
    firstA.resolve({ data: [userProfile('user-a', { full_name: 'Old A' })], error: null });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('name').textContent).toBe('New A');
  });

  it('ignores a stale profile rejection after an explicit new-user login succeeds', async () => {
    const firstA = deferred<Result<unknown[]>>();
    dependencies.client!.profileHandler = (id) => id === 'user-a'
      ? firstA.promise
      : { data: [userProfile(id)], error: null };
    renderAuth();
    await waitFor(() => expect(dependencies.client!.calls).toContain('profile:user-a'));
    await act(async () => { await observed!.signOut(); });
    dependencies.client!.nextSignInSession = authSession('user-b', 'new-b-token');
    await act(async () => { await observed!.signIn('user-b@example.test', 'password'); });
    await expectStatus('authenticated');
    firstA.reject(new Error('stale A failure'));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('error').textContent).toBe('none');
    expect(screen.getByTestId('user').textContent).toBe('user-b');
  });

  it('does not let stale completion alter the newer request loading state', async () => {
    const firstA = deferred<Result<unknown[]>>();
    const pendingB = deferred<Result<unknown[]>>();
    dependencies.client!.profileHandler = (id) => id === 'user-a' ? firstA.promise : pendingB.promise;
    renderAuth();
    await waitFor(() => expect(dependencies.client!.calls).toContain('profile:user-a'));
    await act(async () => { await observed!.signOut(); });
    dependencies.client!.nextSignInSession = authSession('user-b', 'new-b-token');
    const signInPromise = observed!.signIn('user-b@example.test', 'password');
    await waitFor(() => expect(dependencies.client!.calls).toContain('profile:user-b'));
    firstA.resolve({ data: [userProfile('user-a')], error: null });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('loading').textContent).toBe('true');
    pendingB.resolve({ data: [userProfile('user-b')], error: null });
    await act(async () => { await signInPromise; });
    await expectStatus('authenticated');
  });
});

describe('Batch 5E-B2 sign-out and auth events', () => {
  it('normal sign-out clears local sensitive state', async () => {
    renderAuth();
    await expectStatus('authenticated');
    fireEvent.click(screen.getByText('Sign out test'));
    await expectStatus('unauthenticated');
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(screen.getByTestId('profile').textContent).toBe('none');
  });

  it('remote sign-out failure still clears local sensitive state', async () => {
    dependencies.client!.signOutError = { message: 'network unavailable' };
    renderAuth();
    await expectStatus('authenticated');
    fireEvent.click(screen.getByText('Sign out test'));
    await expectStatus('unauthenticated');
    await waitFor(() => expect(screen.getByTestId('error').textContent).toMatch(/signed out locally/i));
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('ignores a late profile response after explicit sign-out', async () => {
    const pending = deferred<Result<unknown[]>>();
    dependencies.client!.profileHandler = () => pending.promise;
    renderAuth();
    await waitFor(() => expect(dependencies.client!.calls).toContain('profile:user-a'));
    fireEvent.click(screen.getByText('Sign out test'));
    await expectStatus('unauthenticated');
    pending.resolve({ data: [userProfile('user-a')], error: null });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('downstream').textContent).toBe('blocked');
  });

  it('publishes logout immediately to downstream organization and tenant consumers', async () => {
    renderAuth();
    await expectStatus('authenticated');
    expect(screen.getByTestId('downstream').textContent).toBe('enabled');
    fireEvent.click(screen.getByText('Sign out test'));
    await expectStatus('unauthenticated');
    expect(screen.getByTestId('downstream').textContent).toBe('blocked');
  });

  it('rejects unsolicited SIGNED_IN after an unauthenticated bootstrap', async () => {
    dependencies.client!.currentSession = null;
    dependencies.client!.liveUser = null;
    renderAuth();
    await expectStatus('unauthenticated');
    act(() => dependencies.client!.emit('SIGNED_IN', authSession('user-b')));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('downstream').textContent).toBe('blocked');
    expect(dependencies.client!.calls.filter((call) => call === 'getUser')).toHaveLength(0);
  });

  it('SIGNED_OUT clears all authority', async () => {
    renderAuth();
    await expectStatus('authenticated');
    act(() => dependencies.client!.emit('SIGNED_OUT', null));
    await expectStatus('unauthenticated');
    expect(screen.getByTestId('profile').textContent).toBe('none');
    expect(dependencies.client!.storageBlocked).toBe(true);
  });

  it('SDK SIGNED_OUT tombstones the session and ignores a later SIGNED_IN replay', async () => {
    renderAuth();
    await expectStatus('authenticated');
    act(() => dependencies.client!.emit('SIGNED_OUT', null));
    await expectStatus('unauthenticated');
    act(() => dependencies.client!.emit('SIGNED_IN', authSession('user-a', 'replayed-token')));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('TOKEN_REFRESHED preserves only a live-verified same identity', async () => {
    renderAuth();
    await expectStatus('authenticated');
    const priorGetUserCalls = dependencies.client!.calls.filter((call) => call === 'getUser').length;
    act(() => dependencies.client!.emit('TOKEN_REFRESHED', authSession('user-a', 'refreshed-token')));
    await expectStatus('authenticated');
    expect(dependencies.client!.calls.filter((call) => call === 'getUser').length).toBe(priorGetUserCalls + 1);
    expect(observed?.session?.access_token).toBe('refreshed-token');
  });

  it('PASSWORD_RECOVERY is distinguishable and cannot enable CRM authority', async () => {
    renderAuth();
    await expectStatus('authenticated');
    act(() => dependencies.client!.emit('PASSWORD_RECOVERY', authSession('user-a', 'recovery-token')));
    await expectStatus('password_recovery');
    expect(screen.getByTestId('downstream').textContent).toBe('blocked');
    act(() => dependencies.client!.emit('TOKEN_REFRESHED', authSession('user-a', 'recovery-refreshed-token')));
    await expectStatus('password_recovery');
    expect(screen.getByTestId('downstream').textContent).toBe('blocked');
  });

  it('USER_UPDATED re-verifies the identity and refreshes its profile', async () => {
    renderAuth();
    await expectStatus('authenticated');
    dependencies.client!.profileHandler = (id) => ({ data: [userProfile(id, { full_name: 'Updated User' })], error: null });
    act(() => dependencies.client!.emit('USER_UPDATED', authSession('user-a', 'updated-token')));
    await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('Updated User'));
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
  });

  it('profile deactivation during a session revokes access on explicit revalidation', async () => {
    renderAuth();
    await expectStatus('authenticated');
    dependencies.client!.profileHandler = (id) => ({ data: [userProfile(id, { active: false })], error: null });
    fireEvent.click(screen.getByText('Revalidate test'));
    await expectStatus('account_disabled');
    expect(screen.getByTestId('downstream').textContent).toBe('blocked');
  });
});

describe('Batch 5E-B2R identity continuity and logout epoch', () => {
  it('fails closed when trusted A receives a TOKEN_REFRESHED candidate for B', async () => {
    renderAuth();
    await expectStatus('authenticated');
    act(() => dependencies.client!.emit('TOKEN_REFRESHED', authSession('user-b')));
    await expectStatus('verification_error');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('fails closed when trusted A receives a USER_UPDATED candidate for B', async () => {
    renderAuth();
    await expectStatus('authenticated');
    act(() => dependencies.client!.emit('USER_UPDATED', authSession('user-b')));
    await expectStatus('verification_error');
    expect(screen.getByTestId('downstream').textContent).toBe('blocked');
  });

  it('fails closed when revalidation resolves B for trusted A', async () => {
    renderAuth();
    await expectStatus('authenticated');
    dependencies.client!.replaceStoredSession(authSession('user-b'));
    await act(async () => { await observed!.revalidateAuth(); });
    await expectStatus('verification_error');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('allows an explicitly initiated login to B after logout from A', async () => {
    renderAuth();
    await expectStatus('authenticated');
    await act(async () => { await observed!.signOut(); });
    dependencies.client!.nextSignInSession = authSession('user-b', 'new-b-token');
    await act(async () => {
      expect(await observed!.signIn('user-b@example.test', 'password')).toEqual({ error: null });
    });
    await expectStatus('authenticated');
    expect(screen.getByTestId('user').textContent).toBe('user-b');
  });

  it('rejects a stale B event instead of replacing current A', async () => {
    renderAuth();
    await expectStatus('authenticated');
    act(() => dependencies.client!.emit('SIGNED_IN', authSession('user-b', 'stale-b-token')));
    await expectStatus('verification_error');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('fails closed if persisted identity changes while same-user refresh verification is in flight', async () => {
    renderAuth();
    await expectStatus('authenticated');
    const pendingProfile = deferred<Result<unknown[]>>();
    dependencies.client!.profileHandler = () => pendingProfile.promise;
    act(() => dependencies.client!.emit('TOKEN_REFRESHED', authSession('user-a', 'fresh-a-token')));
    await waitFor(() => expect(dependencies.client!.calls.filter((call) => call === 'profile:user-a').length).toBeGreaterThan(1));
    dependencies.client!.replaceStoredSession(authSession('user-b', 'racing-b-token'));
    pendingProfile.resolve({ data: [userProfile('user-a')], error: null });
    await expectStatus('verification_error');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('fails closed when ordinary revalidation storage changes from trusted A to B while profile A is pending', async () => {
    renderAuth();
    await expectStatus('authenticated');
    const pendingProfile = deferred<Result<unknown[]>>();
    dependencies.client!.profileHandler = () => pendingProfile.promise;
    const revalidation = observed!.revalidateAuth();
    await waitFor(() => expect(dependencies.client!.calls.filter((call) => call === 'profile:user-a').length).toBeGreaterThan(1));
    dependencies.client!.replaceStoredSession(authSession('user-b', 'racing-b-token'));
    pendingProfile.resolve({ data: [userProfile('user-a')], error: null });
    await act(async () => { await revalidation; });
    await expectStatus('verification_error');
  });

  it('fails closed when the same user token changes during ordinary revalidation', async () => {
    renderAuth();
    await expectStatus('authenticated');
    const pendingProfile = deferred<Result<unknown[]>>();
    dependencies.client!.profileHandler = () => pendingProfile.promise;
    const revalidation = observed!.revalidateAuth();
    await waitFor(() => expect(dependencies.client!.calls.filter((call) => call === 'profile:user-a').length).toBeGreaterThan(1));
    dependencies.client!.replaceStoredSession(authSession('user-a', 'unexpected-token'));
    pendingProfile.resolve({ data: [userProfile('user-a')], error: null });
    await act(async () => { await revalidation; });
    await expectStatus('verification_error');
  });

  it('detects A to B to A storage churn during verification even when the final token matches', async () => {
    renderAuth();
    await expectStatus('authenticated');
    const pendingProfile = deferred<Result<unknown[]>>();
    dependencies.client!.profileHandler = () => pendingProfile.promise;
    const revalidation = observed!.revalidateAuth();
    await waitFor(() => expect(dependencies.client!.calls.filter((call) => call === 'profile:user-a').length).toBeGreaterThan(1));
    dependencies.client!.replaceStoredSession(authSession('user-b', 'temporary-b-token'));
    dependencies.client!.replaceStoredSession(authSession('user-a'));
    pendingProfile.resolve({ data: [userProfile('user-a')], error: null });
    await act(async () => { await revalidation; });
    await expectStatus('verification_error');
  });

  it('accepts explicit sign-in when its SIGNED_IN event and result match the transition', async () => {
    dependencies.client!.currentSession = null;
    dependencies.client!.liveUser = null;
    renderAuth();
    await expectStatus('unauthenticated');
    const session = authSession('user-a', 'explicit-a-token');
    dependencies.client!.nextSignInSession = session;
    dependencies.client!.signInEventSession = session;
    await act(async () => {
      expect(await observed!.signIn('user-a@example.test', 'password')).toEqual({ error: null });
    });
    await expectStatus('authenticated');
    expect(observed?.session?.access_token).toBe('explicit-a-token');
  });

  it('fails explicit sign-in when the observed SIGNED_IN identity differs from its result', async () => {
    dependencies.client!.currentSession = null;
    dependencies.client!.liveUser = null;
    renderAuth();
    await expectStatus('unauthenticated');
    dependencies.client!.nextSignInSession = authSession('user-a', 'explicit-a-token');
    dependencies.client!.signInEventSession = authSession('user-b', 'forged-b-token');
    await act(async () => {
      expect(await observed!.signIn('user-a@example.test', 'password')).toEqual({
        error: AUTH_MESSAGES.verificationFailed,
      });
    });
    await expectStatus('verification_error');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('consumes the explicit login transition so a replay cannot establish authority', async () => {
    dependencies.client!.currentSession = null;
    dependencies.client!.liveUser = null;
    renderAuth();
    await expectStatus('unauthenticated');
    dependencies.client!.nextSignInSession = authSession('user-a', 'explicit-a-token');
    await act(async () => { await observed!.signIn('user-a@example.test', 'password'); });
    await expectStatus('authenticated');
    act(() => dependencies.client!.emit('SIGNED_IN', authSession('user-b', 'replayed-b-token')));
    await expectStatus('verification_error');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('ignores stale SIGNED_IN after explicit logout', async () => {
    renderAuth();
    await expectStatus('authenticated');
    await act(async () => { await observed!.signOut(); });
    act(() => dependencies.client!.emit('SIGNED_IN', authSession('user-a')));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
  });

  it('ignores stale TOKEN_REFRESHED after explicit logout', async () => {
    renderAuth();
    await expectStatus('authenticated');
    await act(async () => { await observed!.signOut(); });
    act(() => dependencies.client!.emit('TOKEN_REFRESHED', authSession('user-a', 'stale-refresh')));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
  });

  it('ignores stale USER_UPDATED after explicit logout', async () => {
    renderAuth();
    await expectStatus('authenticated');
    await act(async () => { await observed!.signOut(); });
    act(() => dependencies.client!.emit('USER_UPDATED', authSession('user-a', 'stale-update')));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
  });

  it('ignores stale INITIAL_SESSION after explicit logout', async () => {
    renderAuth();
    await expectStatus('authenticated');
    await act(async () => { await observed!.signOut(); });
    act(() => dependencies.client!.emit('INITIAL_SESSION', authSession('user-a', 'stale-initial')));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
  });

  it('allows an explicitly initiated fresh login to A after logout', async () => {
    renderAuth();
    await expectStatus('authenticated');
    await act(async () => { await observed!.signOut(); });
    dependencies.client!.nextSignInSession = authSession('user-a', 'fresh-a-token');
    await act(async () => { await observed!.signIn('user-a@example.test', 'password'); });
    await expectStatus('authenticated');
    expect(observed?.session?.access_token).toBe('fresh-a-token');
  });

  it('ignores an old A event after an explicit B login', async () => {
    renderAuth();
    await expectStatus('authenticated');
    await act(async () => { await observed!.signOut(); });
    dependencies.client!.nextSignInSession = authSession('user-b', 'fresh-b-token');
    await act(async () => { await observed!.signIn('user-b@example.test', 'password'); });
    await expectStatus('authenticated');
    act(() => dependencies.client!.emit('SIGNED_IN', authSession('user-a', 'old-a-token')));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
    expect(screen.getByTestId('user').textContent).toBe('user-b');
  });
});

describe('Batch 5E-B2R local persistence and safe errors', () => {
  it('does not restore A after remote sign-out failure and provider remount', async () => {
    dependencies.client!.signOutError = { message: 'database password leaked detail' };
    const view = renderAuth();
    await expectStatus('authenticated');
    await act(async () => { await observed!.signOut(); });
    expect(screen.getByTestId('error').textContent).toBe(AUTH_MESSAGES.signOutWarning);
    expect(document.body.textContent).not.toContain('database password leaked detail');
    view.unmount();
    renderAuth();
    await expectStatus('unauthenticated');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('fails closed across provider remount when backing-storage removal fails', async () => {
    dependencies.client!.purgeShouldFail = true;
    const view = renderAuth();
    await expectStatus('authenticated');
    await act(async () => { await observed!.signOut(); });
    expect(dependencies.client!.currentSession?.user.id).toBe('user-a');
    expect(dependencies.client!.storageBlocked).toBe(true);
    view.unmount();
    renderAuth();
    await expectStatus('unauthenticated');
  });

  it('never renders raw profile, permission, or PostgREST details', async () => {
    const sensitive = 'permission denied for table profiles; relation "organization_members" does not exist; PostgREST internal detail';
    dependencies.client!.profileHandler = () => ({ data: null as never, error: { message: sensitive } });
    renderAuth();
    await expectStatus('verification_error');
    expect(screen.getByTestId('error').textContent).toBe(AUTH_MESSAGES.verificationFailed);
    expect(document.body.textContent).not.toContain('profiles');
    expect(document.body.textContent).not.toContain('organization_members');
    expect(document.body.textContent).not.toContain('PostgREST internal detail');
  });
});
