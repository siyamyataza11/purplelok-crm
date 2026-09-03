import type { Session } from '@supabase/supabase-js';
import { render, waitFor } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  exchangeCalls: [] as string[],
  exchangeSession: null as Session | null,
  exchangeError: null as { message: string } | null,
  client: {
    auth: {
      async exchangeCodeForSession(code: string) {
        sdk.exchangeCalls.push(code);
        return { data: { session: sdk.exchangeSession }, error: sdk.exchangeError };
      },
    },
  },
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return {
    ...actual,
    createClient: vi.fn((_url: string, _key: string, options: Record<string, unknown>) => {
      sdk.options = options;
      return sdk.client;
    }),
  };
});

function session(id = 'user-a'): Session {
  return { access_token: 'header.payload.signature', user: { id } } as Session;
}

describe('Batch 5F-C2 private PKCE recovery provenance', () => {
  beforeEach(() => {
    vi.resetModules();
    sdk.options = null;
    sdk.exchangeCalls = [];
    sdk.exchangeSession = session();
    sdk.exchangeError = null;
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'browser-test-key');
  });

  it('configures the sole Supabase client for explicit PKCE recovery exchange', async () => {
    await import('@/lib/supabase');
    expect(sdk.options?.auth).toMatchObject({
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    });
  });

  it('returns recovery capability only from a successful explicit code exchange', async () => {
    const module = await import('@/lib/supabase');
    const capability = await module.exchangePasswordRecoveryCodeOnce('one-time-code');
    expect(sdk.exchangeCalls).toEqual(['one-time-code']);
    expect(capability?.source).toBe('PKCE_CODE_EXCHANGE');
    expect(capability?.session).toBe(sdk.exchangeSession);
  });

  it('attempts one authorization-code exchange when React Strict Mode mounts twice', async () => {
    const module = await import('@/lib/supabase');
    function RecoveryExchangeProbe() {
      useEffect(() => {
        void module.exchangePasswordRecoveryCodeOnce('strict-mode-code');
      }, []);
      return null;
    }
    render(<StrictMode><RecoveryExchangeProbe /></StrictMode>);
    await waitFor(() => expect(sdk.exchangeCalls).toEqual(['strict-mode-code']));
  });

  it('does not retry or convert a failed exchange into recovery capability', async () => {
    sdk.exchangeSession = null;
    sdk.exchangeError = { message: 'expired code provider detail' };
    const module = await import('@/lib/supabase');
    expect(await module.exchangePasswordRecoveryCodeOnce('expired-code')).toBeNull();
    expect(await module.exchangePasswordRecoveryCodeOnce('another-code')).toBeNull();
    expect(sdk.exchangeCalls).toEqual(['expired-code']);
  });

  it('exports no implicit-event recovery relabelling API', async () => {
    const module = await import('@/lib/supabase');
    expect(Object.keys(module)).not.toContain('claimPasswordRecoveryEvent');
    expect(Object.keys(module)).not.toContain('mintPasswordRecoveryCapability');
    expect(Object.keys(module)).not.toContain('consumeBufferedPasswordRecoveryEvent');
  });

  it('durable quarantine survives complete storage-module re-evaluation', async () => {
    const first = await import('@/lib/supabase-auth-storage');
    expect(first.establishRecoveryQuarantine()).toBe(true);
    vi.resetModules();
    const reloaded = await import('@/lib/supabase-auth-storage');
    expect(reloaded.isRecoveryQuarantined()).toBe(true);
    expect(reloaded.clearRecoveryQuarantineAfterVerifiedRecovery()).toBe(true);
    expect(Object.keys(reloaded)).not.toContain('clearRecoveryQuarantine');
  });

  it('a native storage event propagates quarantine activation and clearing across tabs', async () => {
    const storage = await import('@/lib/supabase-auth-storage');
    const states: boolean[] = [];
    const unsubscribe = storage.subscribeRecoveryQuarantine((active) => states.push(active));
    window.localStorage.setItem('purplelok.auth.recovery-quarantine', '{"version":"recovery-quarantine-v1"}');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'purplelok.auth.recovery-quarantine',
      newValue: '{"version":"recovery-quarantine-v1"}',
    }));
    window.localStorage.removeItem('purplelok.auth.recovery-quarantine');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'purplelok.auth.recovery-quarantine',
      newValue: null,
    }));
    unsubscribe();
    expect(states).toEqual([true, false]);
  });
});
