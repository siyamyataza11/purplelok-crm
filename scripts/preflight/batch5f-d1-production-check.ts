import { resolve6 } from 'node:dns/promises';
import { Client, type QueryResultRow } from 'pg';

const PROJECT_REF = 'vkgvfllqgfleosufzwhc';
const OWNER_ID = 'dc62be87-fe6a-4b3f-8a6c-a875ffe36a9c';
const PURPLELOK_ID = '2f02d28b-a8f1-48cd-acbc-f47a5bcd1757';
const DEMO_ID = '9e35e50a-8a9f-4fec-b64e-13388a415e10';
const POLICY_HASH = 'eb744436bf76a7cc18e32b06734b5478';

const PRE_D1_MIGRATIONS = [
  ['20260728110005', 'create_crm_schema'],
  ['20260728111045', 'seed_demo_data'],
  ['20260828120000', 'batch_1_identity_rbac_foundation'],
  ['20260828150000', 'batch_3b_tenant_ownership_foundation'],
  ['20260828170000', 'batch_4_active_organization_context'],
  ['20260829100000', 'batch_5a_tenant_data_foundation'],
  ['20260831120000', 'batch_5e_b2r_profile_authority'],
  ['20260902120000', 'batch_5f_c1_auth_session_gate'],
] as const;

const D1_MIGRATION = ['20260903120000', 'batch_5f_d1_authorization_foundation'] as const;

const DOMAIN_TABLES = [
  'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
  'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
  'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
  'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
  'messages',
] as const;

const PERMISSION_KEYS = [
  'clients.read', 'clients.write', 'documents.read', 'documents.write',
  'invoices.approve', 'invoices.read', 'invoices.write', 'leads.read',
  'leads.write', 'members.manage', 'members.read', 'payments.read',
  'payments.record', 'projects.manage', 'projects.read', 'projects.write',
  'quotes.approve', 'quotes.read', 'quotes.write', 'reports.read',
  'roles.manage', 'roles.read', 'settings.manage', 'settings.read',
  'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write',
] as const;

const ROLE_COUNTS = new Map([
  ['owner', 28], ['admin', 28], ['finance', 13],
  ['project_manager', 12], ['staff', 9], ['client', 6],
]);

const D1_FUNCTIONS = [
  {
    signature: 'private.purplelok_current_session_id()',
    name: 'purplelok_current_session_id',
    result: 'uuid',
    securityDefiner: false,
    rowSecurity: 'row_security=on',
    authenticated: false,
  },
  {
    signature: 'private.purplelok_has_normal_session()',
    name: 'purplelok_has_normal_session',
    result: 'boolean',
    securityDefiner: true,
    rowSecurity: 'row_security=off',
    authenticated: true,
  },
  {
    signature: 'private.purplelok_has_active_membership(uuid)',
    name: 'purplelok_has_active_membership',
    result: 'boolean',
    securityDefiner: true,
    rowSecurity: 'row_security=off',
    authenticated: true,
  },
  {
    signature: 'private.purplelok_has_permission(uuid,text)',
    name: 'purplelok_has_permission',
    result: 'boolean',
    securityDefiner: true,
    rowSecurity: 'row_security=off',
    authenticated: true,
  },
  {
    signature: 'private.purplelok_can_access_resource(uuid,text)',
    name: 'purplelok_can_access_resource',
    result: 'boolean',
    securityDefiner: false,
    rowSecurity: 'row_security=on',
    authenticated: true,
  },
] as const;

type Phase = 'pre' | 'after';

function fail(message: string): never {
  throw new Error(`Batch 5F-D1 production ${phase()} check failed: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function phase(): Phase {
  const value = process.argv[2];
  if (value !== 'pre' && value !== 'after') {
    throw new Error('Usage: batch5f-d1-production-check.ts <pre|after>');
  }
  return value;
}

function directDatabaseUrl(): string {
  const value = process.env.SUPABASE_PROD_DIRECT_DB_URL?.trim();
  assert(value, 'SUPABASE_PROD_DIRECT_DB_URL is required');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail('database secret is not a valid URL');
  }
  assert(['postgres:', 'postgresql:'].includes(parsed.protocol), 'database protocol is not PostgreSQL');
  assert(parsed.hostname.toLowerCase() === `db.${PROJECT_REF}.supabase.co`, 'database host is not the exact production direct host');
  assert(decodeURIComponent(parsed.username) === 'postgres', 'database username is not the direct-connection role');
  assert(Number(parsed.port || 5432) === 5432, 'database connection is not on port 5432');
  assert(!parsed.hostname.toLowerCase().includes('pooler'), 'pooler connections are prohibited');
  return value;
}

async function proveDirectHostnameHasIpv6(databaseUrl: string): Promise<void> {
  const hostname = new URL(databaseUrl).hostname;
  let addresses: string[];
  try {
    addresses = await resolve6(hostname);
  } catch {
    fail('production direct database hostname does not resolve over IPv6');
  }
  assert(addresses.length > 0, 'production direct database hostname has no IPv6 address');
}

async function one<T extends QueryResultRow>(client: Client, sql: string, values: unknown[] = []): Promise<T> {
  const result = await client.query<T>(sql, values);
  assert(result.rowCount === 1, 'singleton query returned an unexpected row count');
  return result.rows[0];
}

async function proveConnectionStability(client: Client): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query('SELECT 1');
    await client.query('SELECT pg_sleep(2)');
    await client.query('SELECT 1');
  } finally {
    await client.query('ROLLBACK');
  }
}

async function detectDatabasePhase(client: Client): Promise<'pre' | 'post'> {
  const migrations = await client.query<{ version: string; name: string }>(
    'select version,name from supabase_migrations.schema_migrations order by version',
  );
  const actual = JSON.stringify(migrations.rows.map(({ version, name }) => [version, name]));
  if (actual === JSON.stringify(PRE_D1_MIGRATIONS)) return 'pre';
  if (actual === JSON.stringify([...PRE_D1_MIGRATIONS, D1_MIGRATION])) return 'post';
  fail('post-attempt migration state is neither the exact pre-D1 nor exact post-D1 state');
}

async function verifyD1Functions(client: Client, currentPhase: 'pre' | 'post'): Promise<void> {
  const names = D1_FUNCTIONS.map(({ name }) => name);
  const count = await one<{ count: number }>(client, `
    select count(*)::integer count
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='private' and procedure.proname=any($1::text[])
  `, [names]);

  if (currentPhase === 'pre') {
    assert(count.count === 0, 'one or more D1 helpers already exist');
    return;
  }
  assert(count.count === D1_FUNCTIONS.length, 'D1 helper count or overload set differs');

  for (const expected of D1_FUNCTIONS) {
    const metadata = await one<{
      oid: string | null;
      owner: string | null;
      volatility: string | null;
      security_definer: boolean | null;
      result: string | null;
      config: string[] | null;
      public_execute: number;
      authenticated_execute: boolean;
      anon_execute: boolean;
      service_execute: boolean;
      auth_admin_execute: boolean;
      execute_grantees: string[];
    }>(client, `
      with target as (select pg_catalog.to_regprocedure($1) oid)
      select target.oid::text oid,
        pg_catalog.pg_get_userbyid(procedure.proowner) owner,
        procedure.provolatile volatility,
        procedure.prosecdef security_definer,
        pg_catalog.pg_get_function_result(procedure.oid) result,
        procedure.proconfig config,
        (select count(*)::integer from pg_catalog.aclexplode(
          coalesce(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl
          where acl.grantee=0 and acl.privilege_type='EXECUTE') public_execute,
        pg_catalog.has_function_privilege('authenticated',procedure.oid,'EXECUTE') authenticated_execute,
        pg_catalog.has_function_privilege('anon',procedure.oid,'EXECUTE') anon_execute,
        pg_catalog.has_function_privilege('service_role',procedure.oid,'EXECUTE') service_execute,
        pg_catalog.has_function_privilege('supabase_auth_admin',procedure.oid,'EXECUTE') auth_admin_execute,
        array(select coalesce(pg_catalog.pg_get_userbyid(acl.grantee),'PUBLIC')
          from pg_catalog.aclexplode(coalesce(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl
          where acl.privilege_type='EXECUTE' order by 1) execute_grantees
      from target left join pg_catalog.pg_proc procedure on procedure.oid=target.oid
    `, [expected.signature]);
    assert(metadata.oid !== null, `${expected.signature} is absent`);
    assert(metadata.owner === 'postgres' && metadata.volatility === 's', `${expected.signature} owner/volatility differs`);
    assert(metadata.security_definer === expected.securityDefiner, `${expected.signature} security mode differs`);
    assert(metadata.result === expected.result, `${expected.signature} return type differs`);
    assert(metadata.config?.some((setting) => /^search_path=(""|)$/u.test(setting)), `${expected.signature} search_path is not empty`);
    assert(metadata.config?.length === 2 && metadata.config.includes(expected.rowSecurity), `${expected.signature} function settings differ`);
    assert(metadata.public_execute === 0, `${expected.signature} is executable by PUBLIC`);
    assert(metadata.authenticated_execute === expected.authenticated, `${expected.signature} authenticated ACL differs`);
    assert(!metadata.anon_execute && !metadata.service_execute && !metadata.auth_admin_execute, `${expected.signature} has an unexpected API/Auth ACL`);
    const expectedGrantees = expected.authenticated ? ['authenticated', 'postgres'] : ['postgres'];
    assert(JSON.stringify(metadata.execute_grantees) === JSON.stringify(expectedGrantees), `${expected.signature} has an unexpected EXECUTE grantee`);
  }
}

async function verifyCommonState(client: Client, currentPhase: 'pre' | 'post'): Promise<Record<string, unknown>> {
  const expectedMigrations = currentPhase === 'pre'
    ? PRE_D1_MIGRATIONS
    : [...PRE_D1_MIGRATIONS, D1_MIGRATION];
  const migrations = await client.query<{ version: string; name: string }>(
    'select version,name from supabase_migrations.schema_migrations order by version',
  );
  assert(JSON.stringify(migrations.rows.map(({ version, name }) => [version, name])) === JSON.stringify(expectedMigrations), 'migration history differs');

  const permissions = await client.query<{ key: string }>('select key from public.permissions order by key');
  assert(JSON.stringify(permissions.rows.map(({ key }) => key)) === JSON.stringify(PERMISSION_KEYS), 'permission catalogue differs');

  const roles = await client.query<{ organization_id: string; key: string; name: string; is_system: boolean; count: number }>(`
    select role.organization_id,role.key,role.name,role.is_system,count(mapping.permission_key)::integer count
    from public.organization_roles role
    left join public.organization_role_permissions mapping
      on mapping.organization_id=role.organization_id and mapping.organization_role_id=role.id
    group by role.organization_id,role.id,role.key,role.name,role.is_system
    order by role.organization_id,role.key
  `);
  assert(roles.rowCount === 12, 'system role inventory is not exactly twelve rows');
  for (const organizationId of [PURPLELOK_ID, DEMO_ID]) {
    const organizationRoles = roles.rows.filter((role) => role.organization_id === organizationId);
    assert(organizationRoles.length === 6, 'an organization does not have exactly six roles');
    assert(
      JSON.stringify(organizationRoles.map(({ key }) => key).sort())
        === JSON.stringify([...ROLE_COUNTS.keys()].sort()),
      'organization role keys differ',
    );
    for (const role of organizationRoles) {
      const expectedName = role.key === 'project_manager'
        ? 'Project Manager'
        : role.key.charAt(0).toUpperCase() + role.key.slice(1);
      assert(role.is_system && role.name === expectedName && ROLE_COUNTS.get(role.key) === role.count, `role mapping differs for ${role.key}`);
    }
  }

  const authority = await one<{
    client_assignments: number;
    mixed_assignments: number;
    malformed_permissions: number;
    orphan_mappings: number;
    platform_admins: number;
  }>(client, `
    select
      (select count(*)::integer from public.organization_member_roles mr
        join public.organization_roles role on role.id=mr.organization_role_id and role.organization_id=mr.organization_id
        where role.key='client') client_assignments,
      (select count(*)::integer from public.organization_members member where
        exists(select 1 from public.organization_member_roles mr join public.organization_roles role
          on role.id=mr.organization_role_id and role.organization_id=mr.organization_id
          where mr.organization_member_id=member.id and mr.organization_id=member.organization_id and role.key='client')
        and exists(select 1 from public.organization_member_roles mr join public.organization_roles role
          on role.id=mr.organization_role_id and role.organization_id=mr.organization_id
          where mr.organization_member_id=member.id and mr.organization_id=member.organization_id and role.key<>'client')) mixed_assignments,
      (select count(*)::integer from public.permissions where key is null or btrim(key)='' or key<>btrim(key) or key<>lower(key)) malformed_permissions,
      (select count(*)::integer from public.organization_role_permissions mapping
        left join public.organization_roles role on role.id=mapping.organization_role_id and role.organization_id=mapping.organization_id
        left join public.permissions permission on permission.key=mapping.permission_key
        where role.id is null or permission.key is null) orphan_mappings,
      (select count(*)::integer from public.platform_admins) platform_admins
  `);
  assert(Object.values(authority).every((value) => value === 0), 'RBAC authority drift exists');

  const totals = { total: 0, demo: 0, purplelok: 0, nullOwned: 0, orphaned: 0 };
  for (const table of DOMAIN_TABLES) {
    const row = await one<{ total: number; demo: number; purplelok: number; null_owned: number; orphaned: number }>(client, `
      select count(*)::integer total,
        count(*) filter(where record.organization_id='${DEMO_ID}')::integer demo,
        count(*) filter(where record.organization_id='${PURPLELOK_ID}')::integer purplelok,
        count(*) filter(where record.organization_id is null)::integer null_owned,
        count(*) filter(where record.organization_id is not null and organization.id is null)::integer orphaned
      from public.${table} record left join public.organizations organization on organization.id=record.organization_id
    `);
    totals.total += row.total;
    totals.demo += row.demo;
    totals.purplelok += row.purplelok;
    totals.nullOwned += row.null_owned;
    totals.orphaned += row.orphaned;
  }
  assert(totals.total === 88 && totals.demo === 88 && totals.purplelok === 0 && totals.nullOwned === 0 && totals.orphaned === 0, 'domain ownership/data baseline differs');

  const policies = await one<{ count: number; hash: string }>(client, `
    select count(*)::integer count,md5(string_agg(
      format('%s|%s|%s|%s|%s|%s|%s',schemaname,tablename,policyname,permissive,roles::text,cmd,
        coalesce(qual,'')||'|'||coalesce(with_check,'')),E'\\n' order by schemaname,tablename,policyname)) hash
    from pg_catalog.pg_policies where schemaname='public' and tablename=any($1::text[])
  `, [DOMAIN_TABLES]);
  assert(policies.count === 84 && policies.hash === POLICY_HASH, 'domain policy count/hash differs');

  const rls = await client.query<{ name: string; enabled: boolean; forced: boolean; owner: string }>(`
    select relation.relname name,relation.relrowsecurity enabled,relation.relforcerowsecurity forced,
      pg_catalog.pg_get_userbyid(relation.relowner) owner
    from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='public' and relation.relkind='r' and relation.relname=any($1::text[]) order by relation.relname
  `, [DOMAIN_TABLES]);
  assert(rls.rowCount === 21 && rls.rows.every((row) => row.enabled && !row.forced && row.owner === 'postgres'), 'domain RLS/ownership baseline differs');
  const roleFlags = await client.query<{ rolname: string; bypass: boolean }>(
    "select rolname,rolbypassrls bypass from pg_catalog.pg_roles where rolname=any(array['anon','authenticated','service_role']) order by rolname",
  );
  assert(roleFlags.rowCount === 3 && roleFlags.rows.find(({ rolname }) => rolname === 'anon')?.bypass === false
    && roleFlags.rows.find(({ rolname }) => rolname === 'authenticated')?.bypass === false
    && roleFlags.rows.find(({ rolname }) => rolname === 'service_role')?.bypass === true, 'API role RLS bypass flags differ');

  const owner = await one<{
    users: number; sessions: number; correlated_sessions: number; profiles: number;
    memberships: number; owner_roles: number; assigned_roles: number; client_roles: number;
    gates: number; recovery_pending: number;
  }>(client, `
    with owner_user as(select id,last_sign_in_at from auth.users where id=$1::uuid and deleted_at is null),
    live_sessions as(select session.created_at from auth.sessions session join owner_user on owner_user.id=session.user_id
      where session.not_after is null or session.not_after>now()),
    membership as(select member.id from public.organization_members member join public.organizations organization
      on organization.id=member.organization_id where member.user_id=$1::uuid and member.organization_id=$2::uuid
      and member.status='active' and organization.status='active'),
    roles as(select role.key,role.name,role.is_system from public.organization_member_roles mr join membership on membership.id=mr.organization_member_id
      join public.organization_roles role on role.id=mr.organization_role_id and role.organization_id=$2::uuid)
    select (select count(*)::integer from owner_user) users,
      (select count(*)::integer from live_sessions) sessions,
      (select count(*)::integer from live_sessions,owner_user where owner_user.last_sign_in_at is not null
        and abs(extract(epoch from(live_sessions.created_at-owner_user.last_sign_in_at)))<120) correlated_sessions,
      (select count(*)::integer from public.profiles where id=$1::uuid and active) profiles,
      (select count(*)::integer from membership) memberships,
      (select count(*)::integer from roles where key='owner' and name='Owner' and is_system) owner_roles,
      (select count(*)::integer from roles) assigned_roles,
      (select count(*)::integer from roles where key='client' or name='Client') client_roles,
      (select count(*)::integer from private.auth_session_gates) gates,
      (select count(*)::integer from private.auth_session_gates where gate_type='RECOVERY_PENDING') recovery_pending
  `, [OWNER_ID, PURPLELOK_ID]);
  assert(owner.users === 1 && owner.sessions > 0 && owner.correlated_sessions > 0, 'live Owner login/session baseline differs');
  assert(owner.profiles === 1 && owner.memberships === 1 && owner.owner_roles === 1
    && owner.assigned_roles === 1 && owner.client_roles === 0, 'Owner profile/membership/role baseline differs');
  assert(owner.gates === 0 && owner.recovery_pending === 0, 'recovery gate baseline differs');

  await verifyD1Functions(client, currentPhase);
  await client.query('select public.batch_3b_assert_seed_manifest()');

  return { migrations: migrations.rowCount, policies, permissions: permissions.rowCount, roles: roles.rowCount, domain: totals, ownerSessions: owner.sessions, gates: owner.gates };
}

async function main(): Promise<void> {
  const currentPhase = phase();
  let databaseUrl = directDatabaseUrl();
  await proveDirectHostnameHasIpv6(databaseUrl);
  const client = new Client({ connectionString: databaseUrl, application_name: `batch-5f-d1-${currentPhase}-readonly-check` });
  try {
    await client.connect();
    const connection = await one<{ ipv6: boolean; port: number }>(client, `
      select pg_catalog.family(pg_catalog.inet_server_addr())=6 ipv6,
        pg_catalog.inet_server_port()::integer port
    `);
    assert(connection.ipv6 && connection.port === 5432, 'runtime connection is not direct IPv6 on port 5432');
    if (currentPhase === 'pre') await proveConnectionStability(client);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const readOnly = await one<{ value: string }>(client, "select current_setting('transaction_read_only') value");
    assert(readOnly.value === 'on', 'verification transaction is not read only');
    const databasePhase = currentPhase === 'after'
      ? await detectDatabasePhase(client)
      : 'pre';
    const summary = await verifyCommonState(client, databasePhase);
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ mode: 'READ ONLY', connection: 'DIRECT_IPV6', port: 5432, projectRef: PROJECT_REF, requestedPhase: currentPhase, databasePhase, ...summary, result: databasePhase === 'post' || currentPhase === 'pre' ? 'PASS' : 'D1_NOT_EXECUTED' }, null, 2));
    assert(currentPhase !== 'after' || databasePhase === 'post', 'D1 did not commit');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
    throw error;
  } finally {
    databaseUrl = '';
    await client.end().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Batch 5F-D1 production check failed');
  process.exitCode = 1;
});
