import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginSupabaseAuthPersistence,
  ControlledSupabaseAuthStorage,
  getSupabaseAuthStorageRevision,
  purgeSupabaseAuthStorage,
  supabaseAuthStorage,
  withPurgedSupabaseAuthSession,
} from '../../src/lib/supabase-auth-storage.ts';

function installStorage(
  values: Map<string, string>,
  removeItem: (key: string) => void = (key) => { values.delete(key); },
): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem,
      },
    },
  });
}

test('controlled auth storage purges the exact key observed from Supabase', () => {
  const values = new Map([['sdk-selected-key-a', 'persisted-session']]);
  installStorage(values);
  beginSupabaseAuthPersistence();
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-a'), 'persisted-session');
  assert.equal(purgeSupabaseAuthStorage(), true);
  assert.equal(values.has('sdk-selected-key-a'), false);
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-a'), null);
});

test('a failed backing-storage removal remains logically purged and fail closed', () => {
  const values = new Map([['sdk-selected-key-b', 'persisted-session']]);
  installStorage(values, () => { throw new Error('storage removal unavailable'); });
  beginSupabaseAuthPersistence();
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-b'), 'persisted-session');
  assert.equal(purgeSupabaseAuthStorage(), false);
  assert.equal(values.get('sdk-selected-key-b'), 'persisted-session');
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-b'), null);
});

test('a successful fresh Supabase session write re-enables only its exact key', () => {
  const values = new Map<string, string>();
  installStorage(values);
  beginSupabaseAuthPersistence();
  supabaseAuthStorage.setItem('sdk-selected-key-b', 'fresh-session');
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-b'), 'fresh-session');
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-a'), null);
});

test('only the in-flight remote logout can read the purged session value', async () => {
  const values = new Map([['sdk-selected-key-c', 'session-for-remote-revocation']]);
  installStorage(values);
  beginSupabaseAuthPersistence();
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-c'), 'session-for-remote-revocation');
  purgeSupabaseAuthStorage();
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-c'), null);
  await withPurgedSupabaseAuthSession(async () => {
    assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-c'), 'session-for-remote-revocation');
  });
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-c'), null);
});

test('a session write racing remote logout is re-purged before logout completes', async () => {
  const values = new Map([['sdk-selected-key-d', 'old-session']]);
  installStorage(values);
  beginSupabaseAuthPersistence();
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-d'), 'old-session');
  purgeSupabaseAuthStorage();
  await withPurgedSupabaseAuthSession(async () => {
    supabaseAuthStorage.setItem('sdk-selected-key-d', 'racing-refreshed-session');
    assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-d'), 'old-session');
  });
  assert.equal(values.has('sdk-selected-key-d'), false);
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-d'), null);
});

test('stale writes stay blocked until an explicit fresh authentication begins', () => {
  const values = new Map([['sdk-selected-key-e', 'old-session']]);
  installStorage(values);
  beginSupabaseAuthPersistence();
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-e'), 'old-session');
  purgeSupabaseAuthStorage();
  supabaseAuthStorage.setItem('sdk-selected-key-e', 'stale-refreshed-session');
  assert.equal(values.has('sdk-selected-key-e'), false);
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-e'), null);
  beginSupabaseAuthPersistence();
  supabaseAuthStorage.setItem('sdk-selected-key-e', 'intentional-fresh-session');
  assert.equal(supabaseAuthStorage.getItem('sdk-selected-key-e'), 'intentional-fresh-session');
});

test('durable tombstone rejects old session after complete adapter recreation', () => {
  const oldSession = 'old-session-secret-bytes';
  const values = new Map([['sdk-selected-key-reload', oldSession]]);
  installStorage(values, () => { throw new Error('physical removal failed'); });

  const firstAdapter = new ControlledSupabaseAuthStorage();
  assert.equal(firstAdapter.getItem('sdk-selected-key-reload'), oldSession);
  assert.equal(firstAdapter.purge(), false);
  assert.equal(values.get('sdk-selected-key-reload'), oldSession);

  const durableEntries = [...values.entries()].filter(([key]) => key !== 'sdk-selected-key-reload');
  assert.equal(durableEntries.length, 1);
  assert.equal(durableEntries[0][1].includes(oldSession), false);

  const reloadedAdapter = new ControlledSupabaseAuthStorage();
  assert.equal(reloadedAdapter.getItem('sdk-selected-key-reload'), null);
  reloadedAdapter.setItem('sdk-selected-key-reload', 'stale-sdk-write');
  assert.equal(reloadedAdapter.getItem('sdk-selected-key-reload'), null);
  assert.equal(values.get('sdk-selected-key-reload'), oldSession);
});

test('explicit fresh login replaces a durably tombstoned credential safely', () => {
  const values = new Map([['sdk-selected-key-fresh', 'old-session']]);
  installStorage(values, (key) => {
    if (key === 'sdk-selected-key-fresh') throw new Error('credential removal failed');
    values.delete(key);
  });

  const firstAdapter = new ControlledSupabaseAuthStorage();
  assert.equal(firstAdapter.getItem('sdk-selected-key-fresh'), 'old-session');
  assert.equal(firstAdapter.purge(), false);

  const reloadedAdapter = new ControlledSupabaseAuthStorage();
  assert.equal(reloadedAdapter.getItem('sdk-selected-key-fresh'), null);
  reloadedAdapter.beginFreshAuthentication();
  reloadedAdapter.setItem('sdk-selected-key-fresh', 'fresh-session');
  assert.equal(reloadedAdapter.getItem('sdk-selected-key-fresh'), 'fresh-session');
});

test('successful physical purge leaves no durable tombstone behind', () => {
  const values = new Map([['sdk-selected-key-clean', 'old-session']]);
  installStorage(values);
  const adapter = new ControlledSupabaseAuthStorage();
  assert.equal(adapter.getItem('sdk-selected-key-clean'), 'old-session');
  assert.equal(adapter.purge(), true);
  assert.deepEqual([...values.entries()], []);
  assert.equal(adapter.getItem('sdk-selected-key-clean'), null);
});

test('auth storage revision changes for every authority-relevant mutation', () => {
  const values = new Map<string, string>();
  installStorage(values);
  beginSupabaseAuthPersistence();
  const beforeWrite = getSupabaseAuthStorageRevision();
  supabaseAuthStorage.setItem('sdk-selected-key-revision', 'session');
  const afterWrite = getSupabaseAuthStorageRevision();
  assert.ok(afterWrite > beforeWrite);
  purgeSupabaseAuthStorage();
  assert.ok(getSupabaseAuthStorageRevision() > afterWrite);
});
