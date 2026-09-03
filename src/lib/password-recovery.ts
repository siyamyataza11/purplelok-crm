import type { Session } from '@supabase/supabase-js';

export const PASSWORD_RECOVERY_CALLBACK_PATH = '/auth/recovery';
export const MINIMUM_PASSWORD_LENGTH = 8;

export type PurplelokSessionState = 'normal_v1' | 'recovery_pending_v1';

export interface PurplelokSessionClaims {
  sessionIdExists: boolean;
  sessionState: string | null;
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]';
}

function configuredApplicationBaseUrl(): URL {
  const configured = import.meta.env.VITE_APP_BASE_URL?.trim();
  const browserOrigin = typeof window === 'undefined' ? undefined : window.location.origin;
  const rawBase = configured || browserOrigin;

  if (!rawBase) throw new Error('Missing application base URL');

  const base = new URL(rawBase);
  if (base.username || base.password || base.search || base.hash) {
    throw new Error('Invalid application base URL');
  }
  if (base.protocol !== 'https:'
    && !(base.protocol === 'http:' && isLocalDevelopmentHost(base.hostname))) {
    throw new Error('Application base URL must use HTTPS');
  }
  if (browserOrigin && base.origin !== browserOrigin) {
    throw new Error('Application base URL must match the running application');
  }
  return base;
}

function applicationBasePath(base: URL): string {
  const path = base.pathname.replace(/\/+$/, '');
  return path === '/' ? '' : path;
}

/**
 * Builds the sole approved password-recovery destination. No caller-controlled
 * URL or `next` parameter is accepted.
 */
export function getPasswordRecoveryRedirectUrl(): string {
  const base = configuredApplicationBaseUrl();
  base.pathname = `${applicationBasePath(base)}${PASSWORD_RECOVERY_CALLBACK_PATH}`;
  base.search = '';
  base.hash = '';
  return base.toString();
}

export function isPasswordRecoveryCallbackLocation(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.location.pathname === new URL(getPasswordRecoveryRedirectUrl()).pathname;
  } catch {
    return false;
  }
}

/**
 * Returns the sole PKCE authorization code accepted by the dedicated recovery
 * route. Missing, blank, or duplicated values are deliberately indistinguishable.
 */
export function getPasswordRecoveryCode(): string | null {
  if (typeof window === 'undefined' || !isPasswordRecoveryCallbackLocation()) return null;
  const codes = new URLSearchParams(window.location.search).getAll('code');
  if (codes.length !== 1 || !codes[0]?.trim()) return null;
  return codes[0];
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = normalized.length % 4;
  if (remainder === 1) throw new Error('Invalid JWT payload');
  const padded = normalized + (remainder === 0 ? '' : '='.repeat(4 - remainder));
  const binary = globalThis.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

/** Read only the two server-signed claims required by the frontend auth gate. */
export function getPurplelokSessionClaims(session: Session): PurplelokSessionClaims | null {
  try {
    const parts = session.access_token.split('.');
    if (parts.length !== 3) return null;
    const decoded: unknown = JSON.parse(decodeBase64Url(parts[1]));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
    const claims = decoded as Record<string, unknown>;
    const sessionId = claims.session_id;
    const sessionState = claims.purplelok_session_state;
    return {
      sessionIdExists: typeof sessionId === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId),
      sessionState: typeof sessionState === 'string' ? sessionState : null,
    };
  } catch {
    return null;
  }
}

/** Remove provider tokens/codes from the address bar only after SDK processing. */
export function cleanPasswordRecoveryUrl(completed = false): void {
  if (typeof window === 'undefined') return;
  try {
    const approved = new URL(getPasswordRecoveryRedirectUrl());
    if (completed) {
      const base = configuredApplicationBaseUrl();
      approved.pathname = base.pathname || '/';
    }
    approved.search = '';
    approved.hash = '';
    window.history.replaceState(window.history.state, document.title, approved.toString());
  } catch {
    // A configuration error is handled by the recovery lifecycle. Never copy
    // untrusted URL material while attempting cleanup.
  }
}

export function validateRecoveryPassword(password: string, confirmation: string): string | null {
  if (!password || password.length < MINIMUM_PASSWORD_LENGTH) {
    return `Use at least ${MINIMUM_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmation) return 'Passwords do not match.';
  return null;
}
