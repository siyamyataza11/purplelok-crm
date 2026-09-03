import type { SupportedStorage } from '@supabase/supabase-js';

/**
 * Storage boundary owned by the application and supplied to Supabase Auth.
 *
 * The adapter records the exact keys Supabase asks it to use. This lets logout
 * deny and remove those keys without duplicating or guessing the SDK's storage
 * key convention. A credential-free marker keeps denied keys unreadable across
 * module reloads even when the backing Storage implementation rejects
 * removeItem(). Only an explicit fresh-authentication transition may replace
 * and re-enable that exact key.
 */
const TOMBSTONE_SUFFIX = '.purplelok-signed-out';
const TOMBSTONE_VALUE = 'signed-out-v1';
const INVALID_SESSION_SENTINEL = '{"purplelok_signed_out":true}';
const RECOVERY_QUARANTINE_KEY = 'purplelok.auth.recovery-quarantine';
const RECOVERY_QUARANTINE_VALUE = '{"version":"recovery-quarantine-v1"}';
const RECOVERY_QUARANTINE_EVENT = 'purplelok:recovery-quarantine';

let memoryRecoveryQuarantine = false;

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function notifyRecoveryQuarantine(active: boolean): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(RECOVERY_QUARANTINE_EVENT, { detail: { active } }));
}

/**
 * Establishes a credential-free durable denial marker. This marker never
 * confers password-reset capability; it only prevents a persisted Auth session
 * from becoming ordinary application authority.
 */
export function establishRecoveryQuarantine(): boolean {
  const wasActive = isRecoveryQuarantined();
  memoryRecoveryQuarantine = true;
  const storage = browserStorage();
  if (!storage) {
    if (!wasActive) notifyRecoveryQuarantine(true);
    return false;
  }
  try {
    storage.setItem(RECOVERY_QUARANTINE_KEY, RECOVERY_QUARANTINE_VALUE);
    const written = storage.getItem(RECOVERY_QUARANTINE_KEY) === RECOVERY_QUARANTINE_VALUE;
    if (!wasActive) notifyRecoveryQuarantine(true);
    return written;
  } catch {
    if (!wasActive) notifyRecoveryQuarantine(true);
    return false;
  }
}

export function isRecoveryQuarantined(): boolean {
  const storage = browserStorage();
  if (!storage) {
    // In a browser, inability to obtain localStorage makes the durable state
    // unknowable. Only non-browser execution may safely rely on memory alone.
    return typeof window === 'undefined' ? memoryRecoveryQuarantine : true;
  }
  try {
    // Any value at the reserved marker key denies authority. Unknown/corrupt
    // marker versions therefore fail closed rather than reopening the CRM.
    return storage.getItem(RECOVERY_QUARANTINE_KEY) !== null
      || memoryRecoveryQuarantine;
  } catch {
    // Storage read failure is ambiguous and must never reopen ordinary auth.
    return true;
  }
}

function clearRecoveryQuarantineMarker(): boolean {
  const storage = browserStorage();
  if (storage) {
    try {
      storage.removeItem(RECOVERY_QUARANTINE_KEY);
      if (storage.getItem(RECOVERY_QUARANTINE_KEY) !== null) return false;
    } catch {
      return false;
    }
  }
  memoryRecoveryQuarantine = false;
  notifyRecoveryQuarantine(false);
  return true;
}

/**
 * Completes the local success transition after AuthContext has independently
 * verified password mutation, live identity, token continuity, and generation.
 * Observers of the resulting storage removal must still fail closed; the
 * removal notification is not success authority for another tab.
 */
export function clearRecoveryQuarantineAfterVerifiedRecovery(): boolean {
  return clearRecoveryQuarantineMarker();
}

export function subscribeRecoveryQuarantine(
  listener: (active: boolean) => void,
): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => undefined;
  }
  const handleLocal = (event: Event) => {
    const detail = (event as CustomEvent<{ active?: boolean }>).detail;
    listener(detail?.active === true);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== RECOVERY_QUARANTINE_KEY) return;
    memoryRecoveryQuarantine = event.newValue !== null;
    listener(memoryRecoveryQuarantine);
  };
  window.addEventListener(RECOVERY_QUARANTINE_EVENT, handleLocal);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(RECOVERY_QUARANTINE_EVENT, handleLocal);
    window.removeEventListener('storage', handleStorage);
  };
}

export class ControlledSupabaseAuthStorage implements SupportedStorage {
  private readonly knownKeys = new Set<string>();
  private readonly deniedKeys = new Set<string>();
  private readonly purgedValues = new Map<string, string>();
  private allowPurgedReads = false;
  private tombstoned = false;
  private freshAuthenticationActive = false;
  private revision = 0;

  private backingStorage(): Storage | null {
    return browserStorage();
  }

  private tombstoneKey(key: string): string {
    return `${key}${TOMBSTONE_SUFFIX}`;
  }

  private hasDurableTombstone(key: string): boolean {
    try {
      return this.backingStorage()?.getItem(this.tombstoneKey(key)) === TOMBSTONE_VALUE;
    } catch {
      return false;
    }
  }

  private writeDurableTombstone(storage: Storage, key: string): boolean {
    try {
      storage.setItem(this.tombstoneKey(key), TOMBSTONE_VALUE);
      return storage.getItem(this.tombstoneKey(key)) === TOMBSTONE_VALUE;
    } catch {
      return false;
    }
  }

  private clearDurableTombstone(storage: Storage, key: string): boolean {
    try {
      storage.removeItem(this.tombstoneKey(key));
      return storage.getItem(this.tombstoneKey(key)) === null;
    } catch {
      return false;
    }
  }

  getItem(key: string): string | null {
    this.knownKeys.add(key);
    if (this.hasDurableTombstone(key)) {
      this.tombstoned = true;
      this.deniedKeys.add(key);
    }
    if (this.tombstoned && !this.allowPurgedReads) return null;
    if (this.deniedKeys.has(key)) {
      return this.allowPurgedReads ? this.purgedValues.get(key) ?? null : null;
    }
    try {
      return this.backingStorage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    this.knownKeys.add(key);
    const durablyTombstoned = this.hasDurableTombstone(key);
    if ((this.tombstoned || durablyTombstoned) && !this.freshAuthenticationActive) {
      this.deniedKeys.add(key);
      return;
    }
    const storage = this.backingStorage();
    if (!storage) throw new Error('AUTH_STORAGE_UNAVAILABLE');
    storage.setItem(key, value);
    if (this.freshAuthenticationActive && !this.clearDurableTombstone(storage, key)) {
      this.tombstoned = true;
      this.deniedKeys.add(key);
      this.revision += 1;
      return;
    }
    this.deniedKeys.delete(key);
    this.tombstoned = false;
    this.freshAuthenticationActive = false;
    this.revision += 1;
  }

  removeItem(key: string): void {
    this.knownKeys.add(key);
    this.deniedKeys.add(key);
    this.revision += 1;
    const storage = this.backingStorage();
    if (!storage) return;
    this.writeDurableTombstone(storage, key);
    try {
      storage.removeItem(key);
    } finally {
      try {
        if (storage.getItem(key) === null) {
          this.clearDurableTombstone(storage, key);
        }
      } catch {
        // Retain the durable tombstone whenever physical removal is uncertain.
      }
    }
  }

  purge(): boolean {
    let persistedRemovalSucceeded = true;
    this.tombstoned = true;
    this.freshAuthenticationActive = false;
    this.revision += 1;
    this.purgedValues.clear();
    for (const key of this.knownKeys) {
      const storage = this.backingStorage();
      if (!storage) {
        this.deniedKeys.add(key);
        persistedRemovalSucceeded = false;
        continue;
      }
      try {
        const current = storage.getItem(key);
        if (current !== null && current !== undefined) {
          this.purgedValues.set(key, current);
        }
      } catch {
        // A value that cannot be read also cannot be supplied to remote logout.
      }
      this.deniedKeys.add(key);
      const markerWritten = this.writeDurableTombstone(storage, key);
      try {
        storage.removeItem(key);
      } catch {
        persistedRemovalSucceeded = false;
      }
      let credentialRemoved = false;
      try {
        credentialRemoved = storage.getItem(key) === null;
      } catch {
        persistedRemovalSucceeded = false;
      }
      if (credentialRemoved) {
        if (!this.clearDurableTombstone(storage, key)) {
          // A leftover credential-free marker is safe but indicates storage drift.
          persistedRemovalSucceeded = false;
        }
        continue;
      }

      persistedRemovalSucceeded = false;
      if (!markerWritten) {
        try {
          storage.setItem(key, INVALID_SESSION_SENTINEL);
          if (storage.getItem(key) !== INVALID_SESSION_SENTINEL) {
            persistedRemovalSucceeded = false;
          }
        } catch {
          // In-memory denial remains active, but durable fail-closed state could
          // not be established and purge() must report failure.
        }
      }
    }
    return persistedRemovalSucceeded;
  }

  async withPurgedSession<T>(operation: () => Promise<T>): Promise<T> {
    this.allowPurgedReads = true;
    try {
      return await operation();
    } finally {
      this.allowPurgedReads = false;
      // A refresh callback racing the remote request may have written a new
      // session. Re-purge after the request so failure cannot repersist it.
      this.purge();
      this.purgedValues.clear();
    }
  }

  beginFreshAuthentication(): void {
    this.tombstoned = false;
    this.freshAuthenticationActive = true;
    this.revision += 1;
    const storage = this.backingStorage();
    if (!storage) return;
    for (const key of this.knownKeys) {
      this.clearDurableTombstone(storage, key);
    }
  }

  getRevision(): number {
    return this.revision;
  }

  canSafelyClearRecoveryQuarantine(): boolean {
    if (!this.tombstoned) return false;
    const storage = this.backingStorage();
    if (!storage) return this.knownKeys.size === 0;
    for (const key of this.knownKeys) {
      try {
        const value = storage.getItem(key);
        if (value === null
          || value === INVALID_SESSION_SENTINEL
          || storage.getItem(this.tombstoneKey(key)) === TOMBSTONE_VALUE) {
          continue;
        }
      } catch {
        return false;
      }
      return false;
    }
    return true;
  }
}

export const supabaseAuthStorage = new ControlledSupabaseAuthStorage();

export function purgeSupabaseAuthStorage(): boolean {
  return supabaseAuthStorage.purge();
}

export function withPurgedSupabaseAuthSession<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return supabaseAuthStorage.withPurgedSession(operation);
}

export function beginSupabaseAuthPersistence(): void {
  supabaseAuthStorage.beginFreshAuthentication();
}

export function getSupabaseAuthStorageRevision(): number {
  return supabaseAuthStorage.getRevision();
}

export function canSafelyClearRecoveryQuarantineAfterPurge(): boolean {
  return supabaseAuthStorage.canSafelyClearRecoveryQuarantine();
}

/**
 * Clears recovery flow-control state only after the adapter proves that local
 * recovery credentials are absent or durably denied. This operation cannot
 * turn a session into application authority.
 */
export function clearRecoveryQuarantineAfterSafePurge(): boolean {
  if (!supabaseAuthStorage.canSafelyClearRecoveryQuarantine()) return false;
  return clearRecoveryQuarantineMarker();
}
