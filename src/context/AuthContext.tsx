import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { AUTH_MESSAGES } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import {
  beginSupabaseAuthPersistence,
  getSupabaseAuthStorageRevision,
  purgeSupabaseAuthStorage,
  withPurgedSupabaseAuthSession,
} from '@/lib/supabase-auth-storage';
import type { Profile, UserRole } from '@/types';

export type AuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'authenticated'
  | 'account_disabled'
  | 'verification_error'
  | 'password_recovery';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  status: AuthStatus;
  error: string | null;
  generation: number;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  revalidateAuth: () => Promise<boolean>;
}

interface AuthSnapshot {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  status: AuthStatus;
  error: string | null;
  generation: number;
}

interface LoginTransition {
  nonce: number;
  generation: number;
  email: string;
  observedEventUserId?: string;
  observedEventAccessToken?: string;
  invalidated?: boolean;
}

const PROFILE_COLUMNS = [
  'id',
  'email',
  'full_name',
  'avatar_url',
  'phone',
  'position',
  'role',
  'active',
  'created_at',
  'updated_at',
].join(', ');

const INITIAL_AUTH: AuthSnapshot = {
  session: null,
  user: null,
  profile: null,
  loading: true,
  status: 'loading',
  error: null,
  generation: 0,
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isProfile(value: unknown, expectedUserId: string): value is Profile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Record<string, unknown>;
  return profile.id === expectedUserId
    && typeof profile.email === 'string'
    && typeof profile.full_name === 'string'
    && isNullableString(profile.avatar_url)
    && isNullableString(profile.phone)
    && isNullableString(profile.position)
    && typeof profile.role === 'string'
    && typeof profile.active === 'boolean'
    && typeof profile.created_at === 'string'
    && typeof profile.updated_at === 'string';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthSnapshot>(INITIAL_AUTH);
  const authRef = useRef(auth);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const explicitSignOutRef = useRef(false);
  const verificationFailureRef = useRef(false);
  const signOutTombstoneRef = useRef(false);
  const intentionalSignInRef = useRef(false);
  const loginTransitionNonceRef = useRef(0);
  const loginTransitionRef = useRef<LoginTransition | null>(null);
  const retiredUserIdRef = useRef<string | null>(null);
  const signOutInFlightRef = useRef<Promise<void> | null>(null);

  const publish = useCallback((snapshot: AuthSnapshot) => {
    if (!mountedRef.current) return;
    authRef.current = snapshot;
    setAuth(snapshot);
  }, []);

  const nextGeneration = useCallback(() => {
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  const isCurrent = useCallback((generation: number) => (
    mountedRef.current && generationRef.current === generation
  ), []);

  const loadRequiredProfile = useCallback(async (userId: string): Promise<Profile> => {
    const result = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .limit(2);

    if (result.error) {
      throw new Error('PROFILE_LOAD_FAILED');
    }
    if (!Array.isArray(result.data) || result.data.length !== 1) {
      throw new Error('A single profile is required for internal access.');
    }
    if (!isProfile(result.data[0], userId)) {
      throw new Error('The internal user profile is malformed.');
    }
    return result.data[0];
  }, []);

  const attemptFailedSessionCleanup = useCallback(() => {
    verificationFailureRef.current = true;
    signOutTombstoneRef.current = true;
    purgeSupabaseAuthStorage();
    void supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }, []);

  const verifySession = useCallback(async (
    candidateSession: Session,
    event: AuthChangeEvent | 'REVALIDATION',
    requestGeneration?: number,
    trustedUserId?: string,
    requireStoredSessionMatch = false,
  ): Promise<boolean> => {
    const generation = requestGeneration ?? nextGeneration();
    const expectedUserId = candidateSession.user?.id;
    const expectedAccessToken = candidateSession.access_token;
    const verificationStorageRevision = requireStoredSessionMatch
      ? getSupabaseAuthStorageRevision()
      : null;
    const sameIdentity = expectedUserId
      && authRef.current.user?.id === expectedUserId
      && authRef.current.status === 'authenticated';

    if (signOutTombstoneRef.current || !expectedUserId) {
      return false;
    }

    if (trustedUserId && expectedUserId !== trustedUserId) {
      if (isCurrent(generation)) {
        verificationFailureRef.current = true;
        publish({
          session: null,
          user: null,
          profile: null,
          loading: false,
          status: 'verification_error',
          error: AUTH_MESSAGES.verificationFailed,
          generation,
        });
        attemptFailedSessionCleanup();
      }
      return false;
    }

    publish({
      session: sameIdentity ? authRef.current.session : null,
      user: sameIdentity ? authRef.current.user : null,
      profile: sameIdentity ? authRef.current.profile : null,
      loading: true,
      status: 'loading',
      error: null,
      generation,
    });

    try {
      if (requireStoredSessionMatch) {
        const storedResult = await supabase.auth.getSession();
        if (!isCurrent(generation) || signOutTombstoneRef.current) return false;
        const storedSession = storedResult.data.session;
        if (storedResult.error
          || !storedSession
          || storedSession.user.id !== expectedUserId
          || storedSession.access_token !== expectedAccessToken) {
          throw new Error('SESSION_CONTINUITY_FAILED');
        }
      }

      const liveResult = await supabase.auth.getUser();
      if (!isCurrent(generation) || signOutTombstoneRef.current) return false;
      if (liveResult.error || !liveResult.data.user) {
        throw new Error('LIVE_IDENTITY_UNAVAILABLE');
      }

      const liveUser = liveResult.data.user;
      if (liveUser.id !== expectedUserId) {
        throw new Error('Session identity does not match the live authenticated user.');
      }

      const profile = await loadRequiredProfile(liveUser.id);
      if (!isCurrent(generation) || signOutTombstoneRef.current) return false;

      if (requireStoredSessionMatch) {
        const finalStoredResult = await supabase.auth.getSession();
        if (!isCurrent(generation) || signOutTombstoneRef.current) return false;
        const finalStoredSession = finalStoredResult.data.session;
        if (finalStoredResult.error
          || !finalStoredSession
          || finalStoredSession.user.id !== expectedUserId
          || finalStoredSession.user.id !== liveUser.id
          || finalStoredSession.access_token !== expectedAccessToken
          || getSupabaseAuthStorageRevision() !== verificationStorageRevision) {
          throw new Error('SESSION_CONTINUITY_FAILED');
        }
      }

      verificationFailureRef.current = false;
      if (!profile.active) {
        publish({
          session: candidateSession,
          user: liveUser,
          profile,
          loading: false,
          status: 'account_disabled',
          error: null,
          generation,
        });
        return false;
      }

      if (event === 'PASSWORD_RECOVERY') {
        publish({
          session: candidateSession,
          user: liveUser,
          profile,
          loading: false,
          status: 'password_recovery',
          error: null,
          generation,
        });
        return false;
      }

      publish({
        session: candidateSession,
        user: liveUser,
        profile,
        loading: false,
        status: 'authenticated',
        error: null,
        generation,
      });
      return true;
    } catch {
      if (!isCurrent(generation)) return false;
      verificationFailureRef.current = true;
      publish({
        session: null,
        user: null,
        profile: null,
        loading: false,
        status: 'verification_error',
        error: AUTH_MESSAGES.verificationFailed,
        generation,
      });
      attemptFailedSessionCleanup();
      return false;
    }
  }, [attemptFailedSessionCleanup, isCurrent, loadRequiredProfile, nextGeneration, publish]);

  const revalidateAuth = useCallback(async (): Promise<boolean> => {
    if (signOutTombstoneRef.current) return false;
    const generation = nextGeneration();
    const previous = authRef.current;
    const trustedUserId = previous.user?.id;
    publish({
      session: previous.status === 'authenticated' ? previous.session : null,
      user: previous.status === 'authenticated' ? previous.user : null,
      profile: previous.status === 'authenticated' ? previous.profile : null,
      loading: true,
      status: 'loading',
      error: null,
      generation,
    });

    try {
      const sessionResult = await supabase.auth.getSession();
      if (!isCurrent(generation) || signOutTombstoneRef.current) return false;
      if (sessionResult.error) throw sessionResult.error;
      if (!sessionResult.data.session) {
        verificationFailureRef.current = false;
        publish({
          session: null,
          user: null,
          profile: null,
          loading: false,
          status: 'unauthenticated',
          error: null,
          generation,
        });
        return false;
      }
      const event = previous.status === 'password_recovery'
        ? 'PASSWORD_RECOVERY'
        : 'REVALIDATION';
      return await verifySession(
        sessionResult.data.session,
        event,
        generation,
        trustedUserId,
        true,
      );
    } catch {
      if (!isCurrent(generation)) return false;
      verificationFailureRef.current = true;
      publish({
        session: null,
        user: null,
        profile: null,
        loading: false,
        status: 'verification_error',
        error: AUTH_MESSAGES.sessionError,
        generation,
      });
      attemptFailedSessionCleanup();
      return false;
    }
  }, [attemptFailedSessionCleanup, isCurrent, nextGeneration, publish, verifySession]);

  const acceptSdkSignedOut = useCallback(() => {
    const generation = nextGeneration();
    signOutTombstoneRef.current = true;
    intentionalSignInRef.current = false;
    loginTransitionRef.current = null;
    retiredUserIdRef.current = authRef.current.user?.id ?? retiredUserIdRef.current;
    verificationFailureRef.current = false;
    purgeSupabaseAuthStorage();
    publish({
      session: null,
      user: null,
      profile: null,
      loading: false,
      status: 'unauthenticated',
      error: null,
      generation,
    });
  }, [nextGeneration, publish]);

  useEffect(() => {
    mountedRef.current = true;
    let initialSessionHandled = false;

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        // Bootstrap below owns INITIAL_SESSION so persisted state is always followed by getUser().
        return;
      }
      if (event === 'SIGNED_OUT') {
        if (signOutTombstoneRef.current
          || explicitSignOutRef.current
          || verificationFailureRef.current) return;
        acceptSdkSignedOut();
        return;
      }
      if (event === 'SIGNED_IN'
        || event === 'TOKEN_REFRESHED'
        || event === 'USER_UPDATED'
        || event === 'PASSWORD_RECOVERY') {
        if (signOutTombstoneRef.current) return;
        if (event === 'SIGNED_IN' && intentionalSignInRef.current) {
          const transition = loginTransitionRef.current;
          if (!transition || transition.generation !== generationRef.current || !session) {
            if (transition) transition.invalidated = true;
            return;
          }
          const eventEmail = session.user.email?.trim().toLowerCase();
          if (!eventEmail || eventEmail !== transition.email) {
            transition.invalidated = true;
            return;
          }
          transition.observedEventUserId = session.user.id;
          transition.observedEventAccessToken = session.access_token;
          return;
        }
        if (intentionalSignInRef.current) return;
        verificationFailureRef.current = false;
        if (!session) {
          const generation = nextGeneration();
          publish({
            session: null,
            user: null,
            profile: null,
            loading: false,
            status: 'verification_error',
            error: AUTH_MESSAGES.sessionError,
            generation,
          });
          return;
        }
        const verificationEvent = authRef.current.status === 'password_recovery'
          && authRef.current.user?.id === session.user.id
          ? 'PASSWORD_RECOVERY'
          : event;
        const trustedUserId = authRef.current.user?.id;
        if (!trustedUserId && event === 'SIGNED_IN') {
          // Initial persisted sessions are restored only by the bootstrap below.
          // Fresh SIGNED_IN authority is owned exclusively by signIn().
          return;
        }
        if (!trustedUserId && event !== 'SIGNED_IN' && event !== 'PASSWORD_RECOVERY') {
          attemptFailedSessionCleanup();
          return;
        }
        if (trustedUserId
          && session.user.id !== trustedUserId
          && retiredUserIdRef.current === session.user.id) {
          return;
        }
        void verifySession(
          session,
          verificationEvent,
          undefined,
          trustedUserId,
          true,
        );
      }
    });

    void (async () => {
      const generation = nextGeneration();
      try {
        const result = await supabase.auth.getSession();
        if (!isCurrent(generation) || signOutTombstoneRef.current) return;
        initialSessionHandled = true;
        if (result.error) throw result.error;
        if (!result.data.session) {
          verificationFailureRef.current = false;
          publish({
            session: null,
            user: null,
            profile: null,
            loading: false,
            status: 'unauthenticated',
            error: null,
            generation,
          });
          return;
        }
        await verifySession(result.data.session, 'INITIAL_SESSION', generation, undefined, true);
      } catch {
        if (!isCurrent(generation)) return;
        verificationFailureRef.current = true;
        publish({
          session: null,
          user: null,
          profile: null,
          loading: false,
          status: 'verification_error',
          error: AUTH_MESSAGES.sessionError,
          generation,
        });
        attemptFailedSessionCleanup();
      } finally {
        initialSessionHandled = true;
      }
    })();

    const handleFocus = () => {
      if (!initialSessionHandled) return;
      const status = authRef.current.status;
      if (status === 'authenticated'
        || status === 'account_disabled'
        || status === 'verification_error') {
        void revalidateAuth();
      }
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      mountedRef.current = false;
      nextGeneration();
      window.removeEventListener('focus', handleFocus);
      subscription.subscription.unsubscribe();
    };
  }, [acceptSdkSignedOut, attemptFailedSessionCleanup, isCurrent, nextGeneration, publish, revalidateAuth, verifySession]);

  const signIn = useCallback(async (email: string, password: string) => {
    await signOutInFlightRef.current?.catch(() => undefined);
    const generation = nextGeneration();
    const transitionNonce = loginTransitionNonceRef.current + 1;
    loginTransitionNonceRef.current = transitionNonce;
    const normalizedEmail = email.trim().toLowerCase();
    loginTransitionRef.current = {
      nonce: transitionNonce,
      generation,
      email: normalizedEmail,
    };
    beginSupabaseAuthPersistence();
    signOutTombstoneRef.current = false;
    intentionalSignInRef.current = true;
    verificationFailureRef.current = false;
    publish({
      session: null,
      user: null,
      profile: null,
      loading: true,
      status: 'loading',
      error: null,
      generation,
    });
    try {
      const result = await supabase.auth.signInWithPassword({ email, password });
      const transition = loginTransitionRef.current;
      if (!isCurrent(generation)
        || !transition
        || transition.nonce !== transitionNonce
        || transition.generation !== generation
        || transition.invalidated) {
        signOutTombstoneRef.current = true;
        purgeSupabaseAuthStorage();
        publish({
          session: null,
          user: null,
          profile: null,
          loading: false,
          status: 'verification_error',
          error: AUTH_MESSAGES.verificationFailed,
          generation,
        });
        return { error: AUTH_MESSAGES.verificationFailed };
      }
      if (result.error || !result.data.session) {
        loginTransitionRef.current = null;
        signOutTombstoneRef.current = true;
        purgeSupabaseAuthStorage();
        publish({
          session: null,
          user: null,
          profile: null,
          loading: false,
          status: 'unauthenticated',
          error: AUTH_MESSAGES.signInFailed,
          generation,
        });
        return { error: AUTH_MESSAGES.signInFailed };
      }
      const returnedEmail = result.data.session.user.email?.trim().toLowerCase();
      if (!returnedEmail || returnedEmail !== transition.email) {
        loginTransitionRef.current = null;
        signOutTombstoneRef.current = true;
        purgeSupabaseAuthStorage();
        publish({
          session: null,
          user: null,
          profile: null,
          loading: false,
          status: 'verification_error',
          error: AUTH_MESSAGES.verificationFailed,
          generation,
        });
        return { error: AUTH_MESSAGES.verificationFailed };
      }
      if ((transition.observedEventUserId
          && transition.observedEventUserId !== result.data.session.user.id)
        || (transition.observedEventAccessToken
          && transition.observedEventAccessToken !== result.data.session.access_token)) {
        loginTransitionRef.current = null;
        signOutTombstoneRef.current = true;
        purgeSupabaseAuthStorage();
        publish({
          session: null,
          user: null,
          profile: null,
          loading: false,
          status: 'verification_error',
          error: AUTH_MESSAGES.verificationFailed,
          generation,
        });
        return { error: AUTH_MESSAGES.verificationFailed };
      }
      const verified = await verifySession(
        result.data.session,
        'SIGNED_IN',
        generation,
        undefined,
        true,
      );
      if (verified
        && loginTransitionRef.current?.nonce === transitionNonce
        && isCurrent(generation)) {
        loginTransitionRef.current = null;
      }
      return { error: verified ? null : AUTH_MESSAGES.verificationFailed };
    } catch {
      if (isCurrent(generation)) {
        if (loginTransitionRef.current?.nonce === transitionNonce) {
          loginTransitionRef.current = null;
        }
        signOutTombstoneRef.current = true;
        purgeSupabaseAuthStorage();
        publish({
          session: null,
          user: null,
          profile: null,
          loading: false,
          status: 'unauthenticated',
          error: AUTH_MESSAGES.signInFailed,
          generation,
        });
      }
      return { error: AUTH_MESSAGES.signInFailed };
    } finally {
      intentionalSignInRef.current = false;
      if (loginTransitionRef.current?.nonce === transitionNonce) {
        loginTransitionRef.current = null;
      }
    }
  }, [isCurrent, nextGeneration, publish, verifySession]);

  const signOut = useCallback(async () => {
    const generation = nextGeneration();
    explicitSignOutRef.current = true;
    signOutTombstoneRef.current = true;
    intentionalSignInRef.current = false;
    loginTransitionRef.current = null;
    retiredUserIdRef.current = authRef.current.user?.id ?? retiredUserIdRef.current;
    verificationFailureRef.current = false;
    publish({
      session: null,
      user: null,
      profile: null,
      loading: false,
      status: 'unauthenticated',
      error: null,
      generation,
    });

    const localPurgeSucceeded = purgeSupabaseAuthStorage();
    let remoteFailed = false;
    const remoteAttempt = withPurgedSupabaseAuthSession(async () => {
      try {
        const { error } = await supabase.auth.signOut();
        remoteFailed = Boolean(error);
      } catch {
        remoteFailed = true;
      }
    });
    signOutInFlightRef.current = remoteAttempt;
    await remoteAttempt;
    if (signOutInFlightRef.current === remoteAttempt) {
      signOutInFlightRef.current = null;
    }

    const signOutWarning = remoteFailed || !localPurgeSucceeded
      ? AUTH_MESSAGES.signOutWarning
      : null;
    if (signOutWarning) {
      if (isCurrent(generation)) {
        publish({ ...authRef.current, error: signOutWarning });
      }
    }
    explicitSignOutRef.current = false;
    return { error: signOutWarning };
  }, [isCurrent, nextGeneration, publish]);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error: error ? AUTH_MESSAGES.passwordResetFailed : null };
  }, []);

  const refreshProfile = useCallback(async () => {
    await revalidateAuth();
  }, [revalidateAuth]);

  return (
    <AuthContext.Provider value={{
      ...auth,
      signIn,
      signOut,
      resetPassword,
      refreshProfile,
      revalidateAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// Context and its consumer hook intentionally share one module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

// Legacy display labels remain exported for compatibility during the role migration.
// eslint-disable-next-line react-refresh/only-export-components
export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  ceo: 'CEO',
  director: 'Director',
  designer: 'Designer',
  developer: 'Developer',
  sales: 'Sales',
  finance: 'Finance',
  client: 'Client',
  staff: 'Staff',
};
