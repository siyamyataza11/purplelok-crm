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

export class ControlledSupabaseAuthStorage implements SupportedStorage {
  private readonly knownKeys = new Set<string>();
  private readonly deniedKeys = new Set<string>();
  private readonly purgedValues = new Map<string, string>();
  private allowPurgedReads = false;
  private tombstoned = false;
  private freshAuthenticationActive = false;
  private revision = 0;

  private backingStorage(): Storage | null {
    try {
      return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
      return null;
    }
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
