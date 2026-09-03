import { createClient, type Session } from '@supabase/supabase-js';
import {
  beginSupabaseAuthPersistence,
  establishRecoveryQuarantine,
  supabaseAuthStorage,
} from '@/lib/supabase-auth-storage';
import { isPasswordRecoveryCallbackLocation } from '@/lib/password-recovery';

export interface PasswordRecoveryExchangeCapability {
  readonly source: 'PKCE_CODE_EXCHANGE';
  readonly sequence: number;
  readonly session: Session;
}

let recoverySequence = 0;
let recoveryExchangeAttempted = false;
let recoveryExchangePromise: Promise<PasswordRecoveryExchangeCapability | null> | null = null;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// An approved recovery callback is a deliberate fresh-authentication entry
// point. Enable SDK persistence before createClient processes URL credentials.
if (isPasswordRecoveryCallbackLocation()) {
  // Establish denial before createClient can persist callback credentials.
  // The path can deny normal authority, but cannot mint recovery capability.
  establishRecoveryQuarantine();
  beginSupabaseAuthPersistence();
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    // The dedicated recovery route performs the one allowed code exchange.
    // Automatic URL detection would race it and could consume the code twice.
    detectSessionInUrl: false,
    storage: supabaseAuthStorage,
  },
});

/**
 * The sole PKCE recovery exchange boundary. The code is neither logged nor
 * retained; a module instance permits exactly one attempt.
 */
export async function exchangePasswordRecoveryCodeOnce(
  code: string,
): Promise<PasswordRecoveryExchangeCapability | null> {
  if (!code) return null;
  if (recoveryExchangeAttempted) return recoveryExchangePromise;
  recoveryExchangeAttempted = true;
  recoveryExchangePromise = (async () => {
    const result = await supabase.auth.exchangeCodeForSession(code);
    if (result.error || !result.data.session) return null;
    recoverySequence += 1;
    return Object.freeze({
      source: 'PKCE_CODE_EXCHANGE' as const,
      sequence: recoverySequence,
      session: result.data.session,
    });
  })();
  return recoveryExchangePromise;
}
