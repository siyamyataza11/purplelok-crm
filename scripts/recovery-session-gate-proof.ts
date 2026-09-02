/**
 * Batch 5F-B1 disposable Supabase Auth proof.
 *
 * This script refuses non-local URLs and never prints credentials, tokens,
 * passwords, OTPs, recovery links, or email bodies.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

const { Client } = pg;
const PRODUCTION_PROJECT_REF = 'vkgvfllqgfleosufzwhc';
const PROBE_SQL = 'supabase/tests/setup/batch_5f_b1_recovery_gate_probe.sql';
const RECOVERY_REDIRECT = 'http://127.0.0.1:3000/auth/recovery';

interface JwtClaims {
  sub: string;
  session_id: string;
  purplelok_session_state: 'normal_v1' | 'recovery_pending_v1';
  [claim: string]: unknown;
}

interface HookEvent {
  authentication_method: string;
  session_id: string;
  session_state: string;
  execution_current_user: string;
  execution_session_user: string;
}

interface PhaseResult {
  phase: string;
  authentication_method: string;
  session_id: string;
  purplelok_session_state: string;
  gate_present: boolean;
}

interface MailReference {
  id: string;
  provider: 'inbucket' | 'mailpit';
  mailbox?: string;
}

interface UserAuthStateCounts {
  sessions: number;
  gates: number;
}

function requiredEnvironment(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing disposable test environment variable: ${names.join(' or ')}`);
}

function assertDisposableUrl(raw: string, purpose: string): URL {
  const parsed = new URL(raw);
  assert(!raw.includes(PRODUCTION_PROJECT_REF), `${purpose} points at production`);
  assert(
    parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost',
    `${purpose} must be loopback-only`,
  );
  return parsed;
}

function decodeClaims(accessToken: string): JwtClaims {
  const parts = accessToken.split('.');
  assert.equal(parts.length, 3, 'Access token is not a JWT');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JwtClaims;
  for (const required of [
    'iss', 'aud', 'exp', 'iat', 'sub', 'role', 'aal', 'session_id',
    'email', 'phone', 'is_anonymous', 'purplelok_session_state',
  ]) {
    assert(Object.prototype.hasOwnProperty.call(claims, required), `JWT is missing ${required}`);
  }
  assert.match(claims.session_id, /^[0-9a-f-]{36}$/i);
  return claims;
}

function makeClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

async function hookEvents(
  database: pg.Client,
  userId: string,
  sessionId?: string,
): Promise<HookEvent[]> {
  const result = await database.query<HookEvent>(
    `select authentication_method, session_id::text, session_state,
            execution_current_user::text, execution_session_user::text
       from private.auth_hook_event_probe
      where user_id = $1
        and ($2::uuid is null or session_id = $2::uuid)
      order by observed_at, ctid`,
    [userId, sessionId ?? null],
  );
  return result.rows;
}

async function gatePresent(database: pg.Client, sessionId: string): Promise<boolean> {
  const result = await database.query<{ present: boolean }>(
    `select exists (
       select 1 from private.auth_session_gate_probe where session_id = $1
     ) as present`,
    [sessionId],
  );
  return result.rows[0]?.present ?? false;
}

async function sessionPresent(database: pg.Client, sessionId: string): Promise<boolean> {
  const result = await database.query<{ present: boolean }>(
    'select exists (select 1 from auth.sessions where id = $1) as present',
    [sessionId],
  );
  return result.rows[0]?.present ?? false;
}

async function userAuthStateCounts(database: pg.Client, userId: string): Promise<UserAuthStateCounts> {
  const result = await database.query<UserAuthStateCounts>(
    `select
       (select count(*)::integer from auth.sessions where user_id = $1) as sessions,
       (select count(*)::integer from private.auth_session_gate_probe where user_id = $1) as gates`,
    [userId],
  );
  const counts = result.rows[0];
  assert(counts, 'Auth state count query returned no row');
  return counts;
}

async function waitForSessionCleanup(
  database: pg.Client,
  sessionId: string,
): Promise<{ sessionPresent: boolean; gatePresent: boolean }> {
  const deadline = Date.now() + 5_000;
  let state = {
    sessionPresent: await sessionPresent(database, sessionId),
    gatePresent: await gatePresent(database, sessionId),
  };
  while (state.sessionPresent && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    state = {
      sessionPresent: await sessionPresent(database, sessionId),
      gatePresent: await gatePresent(database, sessionId),
    };
  }
  return state;
}

async function expectMalformedHookRejected(
  database: pg.Client,
  event: Record<string, unknown>,
  description: string,
): Promise<void> {
  await database.query('begin');
  const operation = `direct postgres hook invocation: ${description}`;
  try {
    await database.query(
      'select private.batch_5f_b1_custom_access_token_hook($1::jsonb)',
      [JSON.stringify(event)],
    );
    assert.fail(`${description} was accepted`);
  } catch (error) {
    const code = objectValue(error)?.code;
    assert.equal(code, 'P0001', `${operation} returned SQLSTATE ${String(code)}`);
  } finally {
    await database.query('rollback');
  }
}

async function assertHookAclPreconditions(
  database: pg.Client,
): Promise<Record<string, boolean>> {
  const result = await database.query<Record<string, boolean>>(`select
    has_schema_privilege(
      'supabase_auth_admin', 'private', 'USAGE'
    ) as schema_usage,
    has_function_privilege(
      'supabase_auth_admin',
      'private.batch_5f_b1_custom_access_token_hook(jsonb)',
      'EXECUTE'
    ) as function_execute,
    has_table_privilege(
      'supabase_auth_admin', 'private.auth_hook_probe_control', 'SELECT'
    ) as control_select,
    has_table_privilege(
      'supabase_auth_admin', 'private.auth_hook_event_probe', 'INSERT'
    ) as event_insert,
    has_table_privilege(
      'supabase_auth_admin', 'private.auth_session_gate_probe', 'SELECT'
    ) as gate_select,
    has_table_privilege(
      'supabase_auth_admin', 'private.auth_session_gate_probe', 'INSERT'
    ) as gate_insert,
    has_table_privilege(
      'supabase_auth_admin', 'private.auth_session_gate_probe', 'UPDATE'
    ) as gate_update`);
  const privileges = result.rows[0];
  assert(privileges, 'Hook ACL precheck returned no row');
  const missing = Object.entries(privileges)
    .filter(([, granted]) => !granted)
    .map(([privilege]) => privilege);
  assert.deepEqual(missing, [], `Missing hook privileges: ${missing.join(', ')}`);
  return privileges;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Disposable mail API returned HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mailIds(value: unknown, provider: 'inbucket' | 'mailpit', mailbox?: string): MailReference[] {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(objectValue(value)?.messages)
      ? objectValue(value)?.messages as unknown[]
      : [];
  return rows.flatMap((row) => {
    const record = objectValue(row);
    const id = record?.id ?? record?.ID;
    return typeof id === 'string' ? [{ id, provider, mailbox }] : [];
  });
}

async function listMail(mailBase: string, email: string): Promise<MailReference[]> {
  const mailboxCandidates = [email.split('@')[0], email];
  for (const mailbox of mailboxCandidates) {
    try {
      const value = await fetchJson(`${mailBase}/api/v1/mailbox/${encodeURIComponent(mailbox)}`);
      return mailIds(value, 'inbucket', mailbox);
    } catch {
      // Try the next supported local mail API without exposing response bodies.
    }
  }
  try {
    return mailIds(await fetchJson(`${mailBase}/api/v1/messages?limit=100`), 'mailpit');
  } catch {
    throw new Error('No supported disposable mail API was available');
  }
}

async function readMail(mailBase: string, reference: MailReference): Promise<unknown> {
  return reference.provider === 'inbucket'
    ? fetchJson(`${mailBase}/api/v1/mailbox/${encodeURIComponent(reference.mailbox ?? '')}/${encodeURIComponent(reference.id)}`)
    : fetchJson(`${mailBase}/api/v1/message/${encodeURIComponent(reference.id)}`);
}

function recoveryLink(message: unknown): string {
  const serialized = JSON.stringify(message)
    .replaceAll('&amp;', '&')
    .replaceAll('\\u0026', '&');
  const links = serialized.match(/https?:\/\/[^"'\\s<>]+/g) ?? [];
  const candidate = links
    .map((link) => link.replace(/[),.;]+$/, ''))
    .find((link) => link.includes('/auth/v1/verify') && link.includes('type=recovery'));
  if (!candidate) throw new Error('Disposable recovery email did not contain a recovery verification URL');
  return candidate;
}

async function waitForNewMail(
  mailBase: string,
  email: string,
  existingIds: ReadonlySet<string>,
): Promise<MailReference> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const mail = await listMail(mailBase, email);
    const unseen = mail.find((item) => !existingIds.has(item.id));
    if (unseen) return unseen;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for a disposable recovery email');
}

async function requestRecovery(
  client: SupabaseClient,
  mailBase: string,
  email: string,
): Promise<string> {
  const seen = new Set((await listMail(mailBase, email)).map(({ id }) => id));
  let requestError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await client.auth.resetPasswordForEmail(email, { redirectTo: RECOVERY_REDIRECT });
    if (!result.error) {
      const message = await readMail(mailBase, await waitForNewMail(mailBase, email, seen));
      return recoveryLink(message);
    }
    requestError = result.error;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
  }
  throw new Error(`Disposable recovery request failed: ${requestError?.name ?? 'unknown'}`);
}

async function consumeRecoveryLink(link: string): Promise<{
  status: number;
  accessToken: string | null;
  refreshToken: string | null;
}> {
  const response = await fetch(link, { redirect: 'manual' });
  const location = response.headers.get('location');
  if (!location) return { status: response.status, accessToken: null, refreshToken: null };
  const callback = new URL(location, RECOVERY_REDIRECT);
  const parameters = new URLSearchParams(callback.hash.replace(/^#/, ''));
  return {
    status: response.status,
    accessToken: parameters.get('access_token'),
    refreshToken: parameters.get('refresh_token'),
  };
}

async function expectRoleDenied(
  database: pg.Client,
  role: 'anon' | 'authenticated' | 'service_role',
  statement: string,
): Promise<boolean> {
  await database.query('begin');
  try {
    await database.query(`set local role ${role}`);
    await database.query(statement);
    await database.query('rollback');
    return false;
  } catch (error) {
    await database.query('rollback');
    const code = objectValue(error)?.code;
    return code === '42501' || code === '3F000';
  }
}

async function requireSession(
  session: Session | null,
  expectedState: JwtClaims['purplelok_session_state'],
): Promise<{ session: Session; claims: JwtClaims }> {
  assert(session, 'Expected an Auth session');
  const claims = decodeClaims(session.access_token);
  assert.equal(claims.sub, session.user.id);
  assert.equal(claims.purplelok_session_state, expectedState);
  return { session, claims };
}

async function main(): Promise<void> {
  const apiUrl = requiredEnvironment('API_URL', 'SUPABASE_URL');
  const anonKey = requiredEnvironment('ANON_KEY', 'SUPABASE_ANON_KEY');
  const serviceRoleKey = requiredEnvironment('SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
  const databaseUrl = requiredEnvironment('DB_URL', 'SUPABASE_DB_URL');
  const mailUrl = requiredEnvironment('INBUCKET_URL');
  const expectedAuthVersion = requiredEnvironment('EXPECTED_AUTH_VERSION');
  const expectedPostgresVersionPrefix = requiredEnvironment('EXPECTED_POSTGRES_VERSION_PREFIX');
  const expectedSupabaseJsVersion = requiredEnvironment('EXPECTED_SUPABASE_JS_VERSION');
  const expectedAuthJsVersion = requiredEnvironment('EXPECTED_AUTH_JS_VERSION');

  assertDisposableUrl(apiUrl, 'Auth API');
  assertDisposableUrl(databaseUrl, 'Database');
  const mailBase = assertDisposableUrl(mailUrl, 'Mail API').toString().replace(/\/$/, '');

  const database = new Client({ connectionString: databaseUrl, application_name: 'batch-5f-b1-proof' });
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const normalClient = makeClient(apiUrl, anonKey);
  const recoveryClient = makeClient(apiUrl, anonKey);
  const email = `batch5f-${Date.now()}-${randomBytes(4).toString('hex')}@example.test`;
  const oldPassword = `Old-${randomBytes(18).toString('base64url')}!7a`;
  const newPassword = `New-${randomBytes(18).toString('base64url')}!9B`;
  let disposableUserId: string | null = null;
  const phases: PhaseResult[] = [];

  await database.connect();
  try {
    const sql = await readFile(PROBE_SQL, 'utf8');
    await database.query(sql);
    const hookAclPreconditions = await assertHookAclPreconditions(database);
    await expectMalformedHookRejected(database, {}, 'Missing claims object');
    await expectMalformedHookRejected(database, {
      user_id: '00000000-0000-0000-0000-000000000001',
      claims: {},
      authentication_method: 'password',
    }, 'Missing session_id');
    await expectMalformedHookRejected(database, {
      user_id: '00000000-0000-0000-0000-000000000001',
      claims: { session_id: 'not-a-uuid' },
      authentication_method: 'password',
    }, 'Malformed session_id');
    await expectMalformedHookRejected(database, {
      user_id: '00000000-0000-0000-0000-000000000001',
      claims: { session_id: '00000000-0000-0000-0000-000000000002' },
    }, 'Missing authentication_method');

    const supabaseJsPackage = JSON.parse(
      await readFile('node_modules/@supabase/supabase-js/package.json', 'utf8'),
    ) as { version?: string };
    const authJsPackage = JSON.parse(
      await readFile('node_modules/@supabase/auth-js/package.json', 'utf8'),
    ) as { version?: string };
    assert.equal(supabaseJsPackage.version, expectedSupabaseJsVersion);
    assert.equal(authJsPackage.version, expectedAuthJsVersion);

    const health = await fetch(`${apiUrl}/auth/v1/health`, { headers: { apikey: anonKey } });
    assert(health.ok, 'Local Auth health check failed');
    const healthBody = objectValue(await health.json());
    const authVersion = typeof healthBody?.version === 'string' ? healthBody.version : 'not-reported';
    assert.equal(
      authVersion,
      expectedAuthVersion,
      'Disposable Auth version does not match the production-equivalent proof target',
    );
    const postgresVersion = (
      await database.query<{ version: string }>(
        "select current_setting('server_version') as version",
      )
    ).rows[0]?.version;
    assert(
      postgresVersion?.startsWith(expectedPostgresVersionPrefix),
      'Disposable PostgreSQL version does not match the proof target',
    );

    const created = await admin.auth.admin.createUser({
      email,
      password: oldPassword,
      email_confirm: true,
    });
    assert.ifError(created.error);
    assert(created.data.user, 'Disposable Auth user was not created');
    disposableUserId = created.data.user.id;

    const normalLogin = await normalClient.auth.signInWithPassword({ email, password: oldPassword });
    assert.ifError(normalLogin.error);
    const normal = await requireSession(normalLogin.data.session, 'normal_v1');
    const normalSessionId = normal.claims.session_id;
    const normalEvents = await hookEvents(database, disposableUserId, normalSessionId);
    assert.equal(normalEvents.at(-1)?.authentication_method, 'password');
    assert.equal(await gatePresent(database, normalSessionId), false);
    phases.push({
      phase: 'Normal password login',
      authentication_method: 'password',
      session_id: normalSessionId,
      purplelok_session_state: normal.claims.purplelok_session_state,
      gate_present: false,
    });

    const normalRefreshResult = await normalClient.auth.refreshSession();
    assert.ifError(normalRefreshResult.error);
    const normalRefresh = await requireSession(normalRefreshResult.data.session, 'normal_v1');
    assert.equal(normalRefresh.claims.session_id, normalSessionId);
    const normalRefreshEvents = await hookEvents(database, disposableUserId, normalSessionId);
    assert.equal(normalRefreshEvents.at(-1)?.authentication_method, 'token_refresh');
    phases.push({
      phase: 'Normal refresh',
      authentication_method: 'token_refresh',
      session_id: normalRefresh.claims.session_id,
      purplelok_session_state: normalRefresh.claims.purplelok_session_state,
      gate_present: false,
    });
    assert.ifError((await normalClient.auth.signOut()).error);

    const successfulRecoveryLink = await requestRecovery(normalClient, mailBase, email);
    const recoveryTokens = await consumeRecoveryLink(successfulRecoveryLink);
    assert(recoveryTokens.accessToken && recoveryTokens.refreshToken, 'Recovery token issuance failed');
    const recoverySet = await recoveryClient.auth.setSession({
      access_token: recoveryTokens.accessToken,
      refresh_token: recoveryTokens.refreshToken,
    });
    assert.ifError(recoverySet.error);
    const recovery = await requireSession(recoverySet.data.session, 'recovery_pending_v1');
    const recoverySessionId = recovery.claims.session_id;
    assert.notEqual(recoverySessionId, normalSessionId);
    assert.equal(await gatePresent(database, recoverySessionId), true);
    assert.equal(await sessionPresent(database, recoverySessionId), true);
    const recoveryEvents = await hookEvents(database, disposableUserId, recoverySessionId);
    assert.equal(recoveryEvents[0]?.authentication_method, 'recovery');
    assert.equal(recoveryEvents[0]?.session_state, 'recovery_pending_v1');
    const liveRecoveryUser = await recoveryClient.auth.getUser();
    assert.ifError(liveRecoveryUser.error);
    assert.equal(liveRecoveryUser.data.user?.id, disposableUserId);
    phases.push({
      phase: 'Recovery issuance',
      authentication_method: 'recovery',
      session_id: recoverySessionId,
      purplelok_session_state: recovery.claims.purplelok_session_state,
      gate_present: true,
    });

    await database.query(
      'update private.auth_hook_probe_control set force_recovery_failure = true where singleton',
    );
    const stateBeforeForcedFailure = await userAuthStateCounts(database, disposableUserId);
    const failingRecoveryLink = await requestRecovery(normalClient, mailBase, email);
    const failedTokens = await consumeRecoveryLink(failingRecoveryLink);
    assert.equal(failedTokens.accessToken, null, 'Auth issued an access token after hook failure');
    assert.equal(failedTokens.refreshToken, null, 'Auth issued a refresh token after hook failure');
    assert(failedTokens.status >= 400 || failedTokens.status === 302 || failedTokens.status === 303);
    assert.deepEqual(
      await userAuthStateCounts(database, disposableUserId),
      stateBeforeForcedFailure,
      'Failed gate insertion left partial Auth or gate state',
    );
    await database.query(
      'update private.auth_hook_probe_control set force_recovery_failure = false where singleton',
    );

    const eventsBeforePasswordUpdate = (await hookEvents(database, disposableUserId, recoverySessionId)).length;
    const passwordUpdate = await recoveryClient.auth.updateUser({ password: newPassword });
    assert.ifError(passwordUpdate.error);
    const afterPasswordUpdateResult = await recoveryClient.auth.getSession();
    assert.ifError(afterPasswordUpdateResult.error);
    const afterPasswordUpdate = await requireSession(
      afterPasswordUpdateResult.data.session,
      'recovery_pending_v1',
    );
    assert.equal(afterPasswordUpdate.claims.session_id, recoverySessionId);
    assert.equal(await gatePresent(database, recoverySessionId), true);
    const eventsAfterPasswordUpdate = await hookEvents(database, disposableUserId, recoverySessionId);
    const passwordUpdateMethod = eventsAfterPasswordUpdate.length === eventsBeforePasswordUpdate
      ? 'no_new_token'
      : eventsAfterPasswordUpdate.at(-1)?.authentication_method ?? 'unknown';
    phases.push({
      phase: 'Recovery password update',
      authentication_method: passwordUpdateMethod,
      session_id: afterPasswordUpdate.claims.session_id,
      purplelok_session_state: afterPasswordUpdate.claims.purplelok_session_state,
      gate_present: true,
    });

    const recoveryRefreshResult = await recoveryClient.auth.refreshSession();
    assert.ifError(recoveryRefreshResult.error);
    const recoveryRefresh = await requireSession(
      recoveryRefreshResult.data.session,
      'recovery_pending_v1',
    );
    assert.equal(recoveryRefresh.claims.session_id, recoverySessionId);
    const refreshedEvents = await hookEvents(database, disposableUserId, recoverySessionId);
    assert.equal(refreshedEvents.at(-1)?.authentication_method, 'token_refresh');
    assert.equal(refreshedEvents.at(-1)?.session_state, 'recovery_pending_v1');
    const refreshedGate = await database.query<{ observed_refresh: boolean }>(
      'select observed_refresh from private.auth_session_gate_probe where session_id = $1',
      [recoverySessionId],
    );
    assert.equal(refreshedGate.rows[0]?.observed_refresh, true);
    phases.push({
      phase: 'Recovery refresh',
      authentication_method: 'token_refresh',
      session_id: recoveryRefresh.claims.session_id,
      purplelok_session_state: recoveryRefresh.claims.purplelok_session_state,
      gate_present: true,
    });

    const aclResults: Record<string, Record<string, boolean>> = {};
    const statements = {
      SELECT: 'select * from private.auth_session_gate_probe',
      INSERT: `insert into private.auth_session_gate_probe
        (session_id,user_id,gate_type,first_authentication_method)
        values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','RECOVERY_PENDING','recovery')`,
      UPDATE: "update private.auth_session_gate_probe set gate_type = 'RECOVERY_PENDING'",
      DELETE: 'delete from private.auth_session_gate_probe',
    } as const;
    for (const role of ['anon', 'authenticated', 'service_role'] as const) {
      aclResults[role] = {};
      for (const [operation, statement] of Object.entries(statements)) {
        aclResults[role][operation] = await expectRoleDenied(database, role, statement);
        assert.equal(aclResults[role][operation], true, `${role} unexpectedly performed ${operation}`);
      }
    }

    assert.ifError((await recoveryClient.auth.signOut({ scope: 'global' })).error);
    const recoverySignoutState = await waitForSessionCleanup(database, recoverySessionId);
    assert(
      !recoverySignoutState.gatePresent || recoverySignoutState.sessionPresent,
      'Recovery gate was orphaned from auth.sessions after sign-out',
    );

    const newLoginClient = makeClient(apiUrl, anonKey);
    const newLoginResult = await newLoginClient.auth.signInWithPassword({
      email,
      password: newPassword,
    });
    assert.ifError(newLoginResult.error);
    const newNormal = await requireSession(newLoginResult.data.session, 'normal_v1');
    assert.notEqual(newNormal.claims.session_id, recoverySessionId);
    assert.equal(await gatePresent(database, newNormal.claims.session_id), false);
    const newEvents = await hookEvents(database, disposableUserId, newNormal.claims.session_id);
    assert.equal(newEvents.at(-1)?.authentication_method, 'password');
    phases.push({
      phase: 'New password login',
      authentication_method: 'password',
      session_id: newNormal.claims.session_id,
      purplelok_session_state: newNormal.claims.purplelok_session_state,
      gate_present: false,
    });

    const oldPasswordClient = makeClient(apiUrl, anonKey);
    const oldPasswordResult = await oldPasswordClient.auth.signInWithPassword({
      email,
      password: oldPassword,
    });
    assert(oldPasswordResult.error, 'Old password unexpectedly authenticated');
    assert.equal(oldPasswordResult.data.session, null);
    assert.ifError((await newLoginClient.auth.signOut()).error);

    const functionAcl = await database.query<{
      auth_admin: boolean;
      public_execute: boolean;
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(`select
      has_function_privilege('supabase_auth_admin', 'private.batch_5f_b1_custom_access_token_hook(jsonb)', 'EXECUTE') auth_admin,
      exists (
        select 1
        from pg_catalog.pg_proc as procedure
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) as privilege
        where procedure.oid = 'private.batch_5f_b1_custom_access_token_hook(jsonb)'::regprocedure
          and privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      ) public_execute,
      has_function_privilege('anon', 'private.batch_5f_b1_custom_access_token_hook(jsonb)', 'EXECUTE') anon,
      has_function_privilege('authenticated', 'private.batch_5f_b1_custom_access_token_hook(jsonb)', 'EXECUTE') authenticated,
      has_function_privilege('service_role', 'private.batch_5f_b1_custom_access_token_hook(jsonb)', 'EXECUTE') service_role`);
    assert.equal(functionAcl.rows[0]?.auth_admin, true);
    assert.equal(functionAcl.rows[0]?.public_execute, false);
    assert.equal(functionAcl.rows[0]?.anon, false);
    assert.equal(functionAcl.rows[0]?.authenticated, false);
    assert.equal(functionAcl.rows[0]?.service_role, false);

    console.log(JSON.stringify({
      environment: 'disposable local Supabase CI only',
      auth_version: authVersion,
      postgres_version: postgresVersion,
      supabase_js_version: supabaseJsPackage.version,
      auth_js_version: authJsPackage.version,
      hook_security: {
        security_mode: 'INVOKER',
        search_path: '',
        execute: functionAcl.rows[0],
        catalogue_preconditions: hookAclPreconditions,
        genuine_execution_roles: [...new Set(
          (await hookEvents(database, disposableUserId)).map((event) =>
            `${event.execution_current_user}/${event.execution_session_user}`,
          ),
        )],
      },
      hook_failure_blocked_token_issuance: true,
      password_update_preserved_session_id: true,
      recovery_refresh_preserved_session_id: true,
      recovery_gate_survived_password_update_and_refresh: true,
      recovery_signout: {
        auth_session_present: recoverySignoutState.sessionPresent,
        gate_present: recoverySignoutState.gatePresent,
        no_orphan_gate: !recoverySignoutState.gatePresent || recoverySignoutState.sessionPresent,
        fk_cascade_observed: !recoverySignoutState.sessionPresent && !recoverySignoutState.gatePresent,
      },
      new_password_session_differs_from_recovery: true,
      old_password_rejected: true,
      acl_denials: aclResults,
      phases,
    }, null, 2));
  } finally {
    if (disposableUserId) {
      await admin.auth.admin.deleteUser(disposableUserId).catch(() => undefined);
    }
    await database.end();
  }
}

await main();
