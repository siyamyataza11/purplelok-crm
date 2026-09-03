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
import {
  exchangePasswordRecoveryCodeOnce,
  supabase,
  type PasswordRecoveryExchangeCapability,
} from '@/lib/supabase';
import {
  beginSupabaseAuthPersistence,
  canSafelyClearRecoveryQuarantineAfterPurge,
  clearRecoveryQuarantineAfterSafePurge,
  clearRecoveryQuarantineAfterVerifiedRecovery,
  establishRecoveryQuarantine,
  getSupabaseAuthStorageRevision,
  isRecoveryQuarantined,
  purgeSupabaseAuthStorage,
  subscribeRecoveryQuarantine,
  withPurgedSupabaseAuthSession,
} from '@/lib/supabase-auth-storage';
import {
  cleanPasswordRecoveryUrl,
  getPasswordRecoveryCode,
  getPasswordRecoveryRedirectUrl,
  getPurplelokSessionClaims,
  isPasswordRecoveryCallbackLocation,
  MINIMUM_PASSWORD_LENGTH,
} from '@/lib/password-recovery';
import type { Profile, UserRole } from '@/types';

export type AuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'authenticated'
  | 'account_disabled'
  | 'verification_error'
  | 'password_recovery';

export type PasswordRecoveryStatus =
  | 'idle'
  | 'requesting_reset'
  | 'reset_email_sent'
  | 'recovery_session'
  | 'updating_password'
  | 'password_updated'
  | 'recovery_error';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  status: AuthStatus;
  error: string | null;
  generation: number;
  recoveryStatus: PasswordRecoveryStatus;
  recoveryCallbackActive: boolean;
  recoveryCanUpdate: boolean;
  recoveryError: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  updateRecoveryPassword: (password: string) => Promise<{ error: string | null }>;
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

interface RecoveryBinding {
  source: 'PKCE_CODE_EXCHANGE';
  eventSequence: number;
  generation: number;
  userId: string;
  accessToken: string;
  storageRevision: number;
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
  const [recoveryStatus, setRecoveryStatus] = useState<PasswordRecoveryStatus>('idle');
  const [recoveryCallbackActive, setRecoveryCallbackActive] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const recoveryBindingRef = useRef<RecoveryBinding | null>(null);
  const retiredRecoveryAccessTokenRef = useRef<string | null>(null);
  const recoveryUpdateInFlightRef = useRef(false);
  const recoveryExchangeInFlightRef = useRef(false);
  const recoveryRejectedRef = useRef(false);
  const ignoreQuarantineClearRef = useRef(false);

  const clearRecovery = useCallback((cleanUrl = false) => {
    retiredRecoveryAccessTokenRef.current = recoveryBindingRef.current?.accessToken
      ?? retiredRecoveryAccessTokenRef.current;
    recoveryBindingRef.current = null;
    recoveryUpdateInFlightRef.current = false;
    recoveryRejectedRef.current = false;
    setRecoveryStatus('idle');
    setRecoveryCallbackActive(false);
    setRecoveryError(null);
    if (cleanUrl) cleanPasswordRecoveryUrl(true);
  }, []);

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

  const failRecovery = useCallback((
    message: string = AUTH_MESSAGES.recoveryFailed,
    requestGeneration?: number,
  ) => {
    establishRecoveryQuarantine();
    const generation = requestGeneration ?? nextGeneration();
    const previousUserId = authRef.current.user?.id;
    retiredRecoveryAccessTokenRef.current = recoveryBindingRef.current?.accessToken
      ?? retiredRecoveryAccessTokenRef.current;
    recoveryBindingRef.current = null;
    recoveryUpdateInFlightRef.current = false;
    recoveryRejectedRef.current = true;
    intentionalSignInRef.current = false;
    loginTransitionRef.current = null;
    retiredUserIdRef.current = previousUserId ?? retiredUserIdRef.current;
    setRecoveryStatus('recovery_error');
    setRecoveryCallbackActive(true);
    setRecoveryError(message);
    cleanPasswordRecoveryUrl();
    publish({
      session: null,
      user: null,
      profile: null,
      loading: false,
      status: 'verification_error',
      error: null,
      generation,
    });
  }, [nextGeneration, publish]);

  const enterRecoveryQuarantine = useCallback((
    message = AUTH_MESSAGES.recoveryFailed,
  ) => {
    const generation = nextGeneration();
    intentionalSignInRef.current = false;
    loginTransitionRef.current = null;
    retiredUserIdRef.current = authRef.current.user?.id ?? retiredUserIdRef.current;
    setRecoveryStatus('recovery_error');
    setRecoveryCallbackActive(true);
    setRecoveryError(message);
    publish({
      session: null,
      user: null,
      profile: null,
      loading: false,
      status: 'verification_error',
      error: null,
      generation,
    });
  }, [nextGeneration, publish]);

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
    event: AuthChangeEvent | 'REVALIDATION' | 'PKCE_RECOVERY',
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
    const sessionClaims = getPurplelokSessionClaims(candidateSession);
    if (event !== 'PKCE_RECOVERY'
      && sessionClaims?.sessionState === 'recovery_pending_v1') {
      establishRecoveryQuarantine();
      enterRecoveryQuarantine();
      return false;
    }
    if (event !== 'PKCE_RECOVERY' && isRecoveryQuarantined()) {
      enterRecoveryQuarantine();
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
      if (!sessionClaims?.sessionIdExists
        || sessionClaims.sessionState !== (event === 'PKCE_RECOVERY'
          ? 'recovery_pending_v1'
          : 'normal_v1')) {
        throw new Error('SESSION_AUTHORITY_CLAIM_INVALID');
      }
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
      if (event === 'PKCE_RECOVERY') {
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
  }, [attemptFailedSessionCleanup, enterRecoveryQuarantine, isCurrent, loadRequiredProfile, nextGeneration, publish]);

  const acceptRecoverySession = useCallback(async (
    capability: PasswordRecoveryExchangeCapability,
    requestGeneration?: number,
    continuation = false,
  ) => {
    if (capability.source !== 'PKCE_CODE_EXCHANGE') return false;
    establishRecoveryQuarantine();
    const session = capability.session;
    const existing = recoveryBindingRef.current;
    const sessionClaims = getPurplelokSessionClaims(session);

    if (!session.user?.id
      || !sessionClaims?.sessionIdExists
      || sessionClaims.sessionState !== 'recovery_pending_v1') {
      failRecovery();
      return false;
    }

    if (recoveryRejectedRef.current) return false;
    if (retiredRecoveryAccessTokenRef.current === session.access_token) return false;
    if (continuation !== Boolean(existing)) {
      failRecovery();
      return false;
    }
    if (existing && (existing.userId !== session.user.id
      || existing.eventSequence !== capability.sequence)) {
      failRecovery();
      return false;
    }

    const generation = requestGeneration ?? nextGeneration();
    const previousUserId = authRef.current.user?.id;
    intentionalSignInRef.current = false;
    loginTransitionRef.current = null;
    retiredUserIdRef.current = previousUserId ?? retiredUserIdRef.current;
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
    const verifiedAsRecovery = await verifySession(
      session,
      'PKCE_RECOVERY',
      generation,
      existing?.userId,
      true,
    );
    void verifiedAsRecovery;

    if (!isCurrent(generation)
      || signOutTombstoneRef.current
      || authRef.current.status !== 'password_recovery'
      || authRef.current.user?.id !== session.user.id
      || authRef.current.session?.access_token !== session.access_token) {
      if (isCurrent(generation)) failRecovery();
      return false;
    }

    recoveryBindingRef.current = {
      source: capability.source,
      eventSequence: capability.sequence,
      generation,
      userId: session.user.id,
      accessToken: session.access_token,
      storageRevision: getSupabaseAuthStorageRevision(),
    };
    recoveryRejectedRef.current = false;
    setRecoveryStatus('recovery_session');
    setRecoveryCallbackActive(true);
    setRecoveryError(null);
    cleanPasswordRecoveryUrl();
    return true;
  }, [failRecovery, isCurrent, nextGeneration, publish, verifySession]);

  const revalidateAuth = useCallback(async (): Promise<boolean> => {
    if (signOutTombstoneRef.current || recoveryRejectedRef.current) return false;
    if (isRecoveryQuarantined()) {
      enterRecoveryQuarantine();
      return false;
    }
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
      if (previous.status === 'password_recovery') {
        const binding = recoveryBindingRef.current;
        if (!binding || binding.userId !== sessionResult.data.session.user.id) {
          failRecovery(AUTH_MESSAGES.recoveryFailed, generation);
          return false;
        }
        return await acceptRecoverySession({
          source: binding.source,
          sequence: binding.eventSequence,
          session: sessionResult.data.session,
        }, generation, true);
      }
      return await verifySession(
        sessionResult.data.session,
        'REVALIDATION',
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
  }, [acceptRecoverySession, attemptFailedSessionCleanup, enterRecoveryQuarantine, failRecovery, isCurrent, nextGeneration, publish, verifySession]);

  const acceptSdkSignedOut = useCallback(() => {
    const generation = nextGeneration();
    signOutTombstoneRef.current = true;
    intentionalSignInRef.current = false;
    loginTransitionRef.current = null;
    retiredUserIdRef.current = authRef.current.user?.id ?? retiredUserIdRef.current;
    verificationFailureRef.current = false;
    purgeSupabaseAuthStorage();
    const safeLocalDenial = canSafelyClearRecoveryQuarantineAfterPurge();
    if (safeLocalDenial) {
      ignoreQuarantineClearRef.current = true;
      clearRecoveryQuarantineAfterSafePurge();
      ignoreQuarantineClearRef.current = false;
      clearRecovery(true);
    } else if (!isRecoveryQuarantined()) {
      clearRecovery(true);
    }
    publish({
      session: null,
      user: null,
      profile: null,
      loading: false,
      status: 'unauthenticated',
      error: null,
      generation,
    });
    if (!safeLocalDenial && isRecoveryQuarantined()) {
      setRecoveryStatus('recovery_error');
      setRecoveryCallbackActive(true);
      setRecoveryError(AUTH_MESSAGES.signOutWarning);
    }
  }, [clearRecovery, nextGeneration, publish]);

  useEffect(() => {
    mountedRef.current = true;
    let initialSessionHandled = false;

    const beginRecoveryCallback = async (generation: number) => {
      setRecoveryCallbackActive(true);
      setRecoveryStatus('idle');
      recoveryExchangeInFlightRef.current = true;
      establishRecoveryQuarantine();
      const code = getPasswordRecoveryCode();
      if (!code) {
        recoveryExchangeInFlightRef.current = false;
        failRecovery(AUTH_MESSAGES.recoveryFailed, generation);
        return;
      }
      try {
        const capability = await exchangePasswordRecoveryCodeOnce(code);
        if (!isCurrent(generation) || signOutTombstoneRef.current) return;
        if (!capability) {
          failRecovery(AUTH_MESSAGES.recoveryFailed, generation);
          return;
        }
        cleanPasswordRecoveryUrl();
        await acceptRecoverySession(capability, generation);
      } catch {
        if (isCurrent(generation)) failRecovery(AUTH_MESSAGES.recoveryFailed, generation);
      } finally {
        recoveryExchangeInFlightRef.current = false;
      }
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        // Bootstrap below owns INITIAL_SESSION so persisted state is always followed by getUser().
        return;
      }
      if (recoveryExchangeInFlightRef.current) {
        // exchangeCodeForSession owns its synchronous SDK notifications. They
        // cannot establish application authority independently of its result.
        return;
      }
      if (event === 'SIGNED_OUT') {
        if (signOutTombstoneRef.current
          || explicitSignOutRef.current
          || verificationFailureRef.current) return;
        acceptSdkSignedOut();
        return;
      }
      if (event === 'PASSWORD_RECOVERY') {
        // Implicit recovery events are not authoritative. Production recovery
        // capability comes only from the explicit PKCE code exchange below.
        failRecovery();
        return;
      }
      if (event === 'SIGNED_IN'
        || event === 'TOKEN_REFRESHED'
        || event === 'USER_UPDATED') {
        if (signOutTombstoneRef.current) return;
        if (recoveryUpdateInFlightRef.current) return;
        if (recoveryRejectedRef.current) return;
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
        if (isPasswordRecoveryCallbackLocation()
          && authRef.current.status !== 'password_recovery') {
          failRecovery();
          return;
        }
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
        if (authRef.current.status === 'password_recovery') {
          const binding = recoveryBindingRef.current;
          if (!binding || authRef.current.user?.id !== session.user.id) {
            failRecovery();
            return;
          }
          void acceptRecoverySession({
            source: binding.source,
            sequence: binding.eventSequence,
            session,
          }, undefined, true);
          return;
        }
        const verificationEvent = event;
        const trustedUserId = authRef.current.user?.id;
        if (!trustedUserId && event === 'SIGNED_IN') {
          // Initial persisted sessions are restored only by the bootstrap below.
          // Fresh SIGNED_IN authority is owned exclusively by signIn().
          return;
        }
        if (!trustedUserId && event !== 'SIGNED_IN') {
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

    const unsubscribeQuarantine = subscribeRecoveryQuarantine((active) => {
      if (!mountedRef.current) return;
      if (active) {
        if (recoveryExchangeInFlightRef.current) return;
        enterRecoveryQuarantine();
        return;
      }
      if (ignoreQuarantineClearRef.current) return;
      // A storage event is only an observation. Marker removal is not proof of
      // recovery success or safe abandonment, so deny the persisted session and
      // require a new explicit password login instead of revalidating it.
      const generation = nextGeneration();
      signOutTombstoneRef.current = true;
      verificationFailureRef.current = true;
      intentionalSignInRef.current = false;
      loginTransitionRef.current = null;
      retiredUserIdRef.current = authRef.current.user?.id ?? retiredUserIdRef.current;
      purgeSupabaseAuthStorage();
      clearRecovery(true);
      publish({
        session: null,
        user: null,
        profile: null,
        loading: false,
        status: 'unauthenticated',
        error: AUTH_MESSAGES.sessionError,
        generation,
      });
    });

    void (async () => {
      const generation = nextGeneration();
      try {
        if (isPasswordRecoveryCallbackLocation()) {
          initialSessionHandled = true;
          await beginRecoveryCallback(generation);
          return;
        }

        if (isRecoveryQuarantined()) {
          initialSessionHandled = true;
          enterRecoveryQuarantine();
          return;
        }
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
        recoveryExchangeInFlightRef.current = false;
        if (!isCurrent(generation)) return;
        if (isPasswordRecoveryCallbackLocation()) {
          failRecovery(AUTH_MESSAGES.recoveryFailed, generation);
          return;
        }
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
      if (!recoveryRejectedRef.current && (status === 'authenticated'
        || status === 'account_disabled'
        || status === 'verification_error')) {
        void revalidateAuth();
      }
    };
    const handlePopState = () => {
      if (!isPasswordRecoveryCallbackLocation() || recoveryExchangeInFlightRef.current) return;
      void beginRecoveryCallback(nextGeneration());
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('popstate', handlePopState);

    return () => {
      mountedRef.current = false;
      nextGeneration();
      recoveryExchangeInFlightRef.current = false;
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('popstate', handlePopState);
      unsubscribeQuarantine();
      subscription.subscription.unsubscribe();
    };
  }, [acceptRecoverySession, acceptSdkSignedOut, attemptFailedSessionCleanup, clearRecovery, enterRecoveryQuarantine, failRecovery, isCurrent, nextGeneration, publish, revalidateAuth, verifySession]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (isRecoveryQuarantined()
      || recoveryCallbackActive
      || authRef.current.status === 'password_recovery') {
      return { error: AUTH_MESSAGES.signInFailed };
    }
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
    recoveryRejectedRef.current = false;
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
  }, [isCurrent, nextGeneration, publish, recoveryCallbackActive, verifySession]);

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

    const safeLocalDenial = canSafelyClearRecoveryQuarantineAfterPurge();
    if (safeLocalDenial) {
      ignoreQuarantineClearRef.current = true;
      clearRecoveryQuarantineAfterSafePurge();
      ignoreQuarantineClearRef.current = false;
      clearRecovery(true);
    } else if (isRecoveryQuarantined()) {
      setRecoveryStatus('recovery_error');
      setRecoveryCallbackActive(true);
      setRecoveryError(AUTH_MESSAGES.signOutWarning);
    }

    const signOutWarning = remoteFailed || !localPurgeSucceeded || !safeLocalDenial
      ? AUTH_MESSAGES.signOutWarning
      : null;
    if (signOutWarning) {
      if (isCurrent(generation)) {
        publish({ ...authRef.current, error: signOutWarning });
      }
    }
    explicitSignOutRef.current = false;
    return { error: signOutWarning };
  }, [clearRecovery, isCurrent, nextGeneration, publish]);

  const resetPassword = useCallback(async (email: string) => {
    setRecoveryStatus('requesting_reset');
    setRecoveryError(null);
    try {
      const redirectTo = getPasswordRecoveryRedirectUrl();
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        setRecoveryStatus('recovery_error');
        setRecoveryError(AUTH_MESSAGES.passwordResetFailed);
        return { error: AUTH_MESSAGES.passwordResetFailed };
      }
      setRecoveryStatus('reset_email_sent');
      return { error: null };
    } catch {
      setRecoveryStatus('recovery_error');
      setRecoveryError(AUTH_MESSAGES.passwordResetFailed);
      return { error: AUTH_MESSAGES.passwordResetFailed };
    }
  }, []);

  const updateRecoveryPassword = useCallback(async (password: string) => {
    const binding = recoveryBindingRef.current;
    if (password.length < MINIMUM_PASSWORD_LENGTH
      || recoveryUpdateInFlightRef.current
      || !binding
      || binding.source !== 'PKCE_CODE_EXCHANGE'
      || authRef.current.status !== 'password_recovery'
      || generationRef.current !== binding.generation
      || authRef.current.user?.id !== binding.userId
      || authRef.current.session?.access_token !== binding.accessToken
      || getSupabaseAuthStorageRevision() !== binding.storageRevision) {
      return { error: AUTH_MESSAGES.passwordUpdateFailed };
    }

    recoveryUpdateInFlightRef.current = true;
    setRecoveryStatus('updating_password');
    setRecoveryError(null);
    try {
      const beforeSession = await supabase.auth.getSession();
      const beforeUser = await supabase.auth.getUser();
      const beforeClaims = beforeSession.data.session
        ? getPurplelokSessionClaims(beforeSession.data.session)
        : null;
      if (!beforeSession.data.session
        || beforeSession.error
        || beforeUser.error
        || !beforeUser.data.user
        || beforeSession.data.session.user.id !== binding.userId
        || beforeUser.data.user.id !== binding.userId
        || beforeSession.data.session.access_token !== binding.accessToken
        || !beforeClaims?.sessionIdExists
        || beforeClaims.sessionState !== 'recovery_pending_v1'
        || generationRef.current !== binding.generation
        || getSupabaseAuthStorageRevision() !== binding.storageRevision) {
        throw new Error('RECOVERY_CONTINUITY_FAILED');
      }

      const updated = await supabase.auth.updateUser({ password });
      if (updated.error || !updated.data.user || updated.data.user.id !== binding.userId) {
        throw new Error('PASSWORD_UPDATE_FAILED');
      }

      const finalSessionResult = await supabase.auth.getSession();
      const finalUserResult = await supabase.auth.getUser();
      const finalSession = finalSessionResult.data.session;
      const finalClaims = finalSession ? getPurplelokSessionClaims(finalSession) : null;
      if (finalSessionResult.error
        || !finalSession
        || finalUserResult.error
        || !finalUserResult.data.user
        || finalSession.user.id !== binding.userId
        || finalUserResult.data.user.id !== binding.userId
        || finalSession.access_token !== binding.accessToken
        || !finalClaims?.sessionIdExists
        || finalClaims.sessionState !== 'recovery_pending_v1'
        || generationRef.current !== binding.generation) {
        throw new Error('RECOVERY_CONTINUITY_FAILED');
      }

      retiredRecoveryAccessTokenRef.current = binding.accessToken;
      recoveryBindingRef.current = null;
      explicitSignOutRef.current = true;
      signOutTombstoneRef.current = true;
      const signedOut = await supabase.auth.signOut({ scope: 'local' });
      if (signedOut.error || !purgeSupabaseAuthStorage()) {
        throw new Error('RECOVERY_SIGN_OUT_FAILED');
      }
      ignoreQuarantineClearRef.current = true;
      const quarantineCleared = clearRecoveryQuarantineAfterVerifiedRecovery();
      ignoreQuarantineClearRef.current = false;
      if (!quarantineCleared) throw new Error('RECOVERY_QUARANTINE_CLEAR_FAILED');
      const signedOutGeneration = nextGeneration();
      publish({
        session: null,
        user: null,
        profile: null,
        loading: false,
        status: 'unauthenticated',
        error: null,
        generation: signedOutGeneration,
      });
      cleanPasswordRecoveryUrl(true);
      setRecoveryCallbackActive(false);
      setRecoveryError(null);
      setRecoveryStatus('password_updated');
      return { error: null };
    } catch {
      failRecovery(AUTH_MESSAGES.passwordUpdateFailed);
      return { error: AUTH_MESSAGES.passwordUpdateFailed };
    } finally {
      explicitSignOutRef.current = false;
      recoveryUpdateInFlightRef.current = false;
    }
  }, [failRecovery, nextGeneration, publish]);

  const refreshProfile = useCallback(async () => {
    await revalidateAuth();
  }, [revalidateAuth]);

  return (
    <AuthContext.Provider value={{
      ...auth,
      recoveryStatus,
      recoveryCallbackActive,
      recoveryCanUpdate: recoveryBindingRef.current !== null,
      recoveryError,
      signIn,
      signOut,
      resetPassword,
      updateRecoveryPassword,
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
