import { resolve6 } from 'node:dns/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client, type QueryResultRow } from 'pg';

export type D2Phase = 'pre' | 'after';

const PROJECT_REF = 'vkgvfllqgfleosufzwhc';
const OWNER_ID = 'dc62be87-fe6a-4b3f-8a6c-a875ffe36a9c';
const PURPLELOK_ID = '2f02d28b-a8f1-48cd-acbc-f47a5bcd1757';
const DEMO_ID = '9e35e50a-8a9f-4fec-b64e-13388a415e10';
const POLICY_HASH = 'eb744436bf76a7cc18e32b06734b5478';

export const POST_D1_MIGRATIONS = [
  ['20260728110005', 'create_crm_schema'],
  ['20260728111045', 'seed_demo_data'],
  ['20260828120000', 'batch_1_identity_rbac_foundation'],
  ['20260828150000', 'batch_3b_tenant_ownership_foundation'],
  ['20260828170000', 'batch_4_active_organization_context'],
  ['20260829100000', 'batch_5a_tenant_data_foundation'],
  ['20260831120000', 'batch_5e_b2r_profile_authority'],
  ['20260902120000', 'batch_5f_c1_auth_session_gate'],
  ['20260903120000', 'batch_5f_d1_authorization_foundation'],
] as const;

export const D2_MIGRATION = ['20260903180000', 'batch_5f_d2_permission_catalogue'] as const;

const DOMAIN_TABLES = [
  'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
  'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
  'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
  'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
  'messages',
] as const;

export const PRE_D2_PERMISSION_KEYS = [
  'clients.read', 'clients.write', 'documents.read', 'documents.write',
  'invoices.approve', 'invoices.read', 'invoices.write', 'leads.read',
  'leads.write', 'members.manage', 'members.read', 'payments.read',
  'payments.record', 'projects.manage', 'projects.read', 'projects.write',
  'quotes.approve', 'quotes.read', 'quotes.write', 'reports.read',
  'roles.manage', 'roles.read', 'settings.manage', 'settings.read',
  'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write',
] as const;

export const POST_D2_PERMISSION_KEYS = [
  'activities.read', 'clients.read', 'clients.write', 'collaboration.manage',
  'collaboration.read', 'collaboration.write', 'documents.read', 'documents.write',
  'invoices.approve', 'invoices.read', 'invoices.write', 'leads.read',
  'leads.write', 'members.manage', 'members.read', 'payments.read',
  'payments.record', 'projects.manage', 'projects.read', 'projects.write',
  'quotes.approve', 'quotes.read', 'quotes.write', 'reports.read',
  'roles.manage', 'roles.read', 'settings.manage', 'settings.read',
  'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write',
] as const;

const PRE_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner: PRE_D2_PERMISSION_KEYS,
  admin: PRE_D2_PERMISSION_KEYS,
  finance: ['clients.read', 'documents.read', 'invoices.approve', 'invoices.read', 'invoices.write', 'members.read', 'payments.read', 'payments.record', 'projects.read', 'quotes.approve', 'quotes.read', 'quotes.write', 'reports.read'],
  project_manager: ['clients.read', 'documents.read', 'documents.write', 'members.read', 'projects.manage', 'projects.read', 'projects.write', 'reports.read', 'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write'],
  staff: ['clients.read', 'documents.read', 'documents.write', 'members.read', 'projects.read', 'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write'],
  client: ['documents.read', 'invoices.read', 'projects.read', 'quotes.read', 'tickets.read', 'tickets.write'],
};

const POST_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner: POST_D2_PERMISSION_KEYS,
  admin: POST_D2_PERMISSION_KEYS,
  finance: ['clients.read', 'collaboration.read', 'collaboration.write', 'documents.read', 'invoices.approve', 'invoices.read', 'invoices.write', 'members.read', 'payments.read', 'payments.record', 'projects.read', 'quotes.approve', 'quotes.read', 'quotes.write', 'reports.read', 'settings.read'],
  project_manager: ['clients.read', 'collaboration.read', 'collaboration.write', 'documents.read', 'documents.write', 'members.read', 'projects.manage', 'projects.read', 'projects.write', 'reports.read', 'settings.read', 'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write'],
  staff: ['clients.read', 'collaboration.read', 'collaboration.write', 'documents.read', 'documents.write', 'members.read', 'projects.read', 'settings.read', 'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write'],
  client: ['documents.read', 'invoices.read', 'projects.read', 'quotes.read', 'tickets.read', 'tickets.write'],
};

const ROLE_NAMES: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', finance: 'Finance',
  project_manager: 'Project Manager', staff: 'Staff', client: 'Client',
};

const D1_HELPERS = [
  ['private.purplelok_current_session_id()', false, false, 'uuid', 'row_security=on'],
  ['private.purplelok_has_normal_session()', true, true, 'boolean', 'row_security=off'],
  ['private.purplelok_has_active_membership(uuid)', true, true, 'boolean', 'row_security=off'],
  ['private.purplelok_has_permission(uuid,text)', true, true, 'boolean', 'row_security=off'],
  ['private.purplelok_can_access_resource(uuid,text)', false, true, 'boolean', 'row_security=on'],
] as const;

const D2_FUNCTIONS = [
  'private.purplelok_protect_system_role_identity()',
  'private.purplelok_reject_client_role_assignment()',
  'private.purplelok_restrict_client_permissions()',
] as const;

const D2_TRIGGERS = [
  ['organization_roles_protect_system_identity', 'organization_roles', 'purplelok_protect_system_role_identity', 31],
  ['organization_member_roles_reject_client', 'organization_member_roles', 'purplelok_reject_client_role_assignment', 23],
  ['organization_role_permissions_restrict_client', 'organization_role_permissions', 'purplelok_restrict_client_permissions', 23],
] as const;

export interface FunctionSnapshot {
  signature: string;
  owner: string;
  volatility: string;
  securityDefiner: boolean;
  result: string;
  config: string[];
  executeGrantees: string[];
}

export interface TriggerSnapshot {
  name: string;
  table: string;
  functionSchema: string;
  functionName: string;
  enabled: string;
  type: number;
  internal: boolean;
}

export interface D2Snapshot {
  migrations: Array<[string, string]>;
  organizations: Array<{ id: string; slug: string; status: string }>;
  permissionKeys: string[];
  roles: Array<{ organizationId: string; key: string; name: string; isSystem: boolean; permissions: string[] }>;
  authority: { clientAssignments: number; mixedAssignments: number; malformedPermissions: number; orphanMappings: number; platformAdmins: number };
  domain: { total: number; demo: number; purplelok: number; nullOwned: number; orphaned: number };
  policy: { count: number; hash: string };
  rls: Array<{ name: string; enabled: boolean; forced: boolean; owner: string }>;
  owner: { users: number; emailIdentities: number; sessions: number; correlatedSessions: number; profiles: number; memberships: number; ownerRoles: number; assignedRoles: number; clientRoles: number; gates: number; recoveryPending: number };
  d1Helpers: FunctionSnapshot[];
  d2Functions: FunctionSnapshot[];
  d2Triggers: TriggerSnapshot[];
  laterObjects: number;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Batch 5F-D2 contract failed: ${message}`);
}

function validateFunction(actual: FunctionSnapshot, expected: readonly [string, boolean, boolean, string, string]): void {
  const [signature, securityDefiner, authenticated, result, rowSecurity] = expected;
  requireCondition(actual.signature === signature, `${signature} signature differs`);
  requireCondition(actual.owner === 'postgres' && actual.volatility === 's', `${signature} owner/volatility differs`);
  requireCondition(actual.securityDefiner === securityDefiner && actual.result === result, `${signature} security/result differs`);
  requireCondition(actual.config.length === 2 && actual.config.includes('search_path=""') && actual.config.includes(rowSecurity), `${signature} settings differ`);
  requireCondition(same(actual.executeGrantees, authenticated ? ['authenticated', 'postgres'] : ['postgres']), `${signature} ACL differs`);
}

export function validateD2Snapshot(snapshot: D2Snapshot, phase: D2Phase): void {
  const expectedMigrations = phase === 'pre' ? POST_D1_MIGRATIONS : [...POST_D1_MIGRATIONS, D2_MIGRATION];
  requireCondition(same(snapshot.migrations, expectedMigrations), 'migration history differs');

  const expectedPermissions = phase === 'pre' ? PRE_D2_PERMISSION_KEYS : POST_D2_PERMISSION_KEYS;
  requireCondition(same(snapshot.permissionKeys, expectedPermissions), 'permission catalogue differs');
  requireCondition(snapshot.organizations.length === 2, 'organization inventory differs');
  requireCondition(snapshot.organizations.some((row) => row.id === PURPLELOK_ID && row.slug === 'purplelok' && row.status === 'active'), 'PURPLELOK differs');
  requireCondition(snapshot.organizations.some((row) => row.id === DEMO_ID && row.slug === 'purplelok-demo' && row.status === 'active'), 'PURPLELOK Demo differs');

  const expectedRolePermissions = phase === 'pre' ? PRE_ROLE_PERMISSIONS : POST_ROLE_PERMISSIONS;
  requireCondition(snapshot.roles.length === 12, 'role inventory is not exactly six per organization');
  for (const organizationId of [PURPLELOK_ID, DEMO_ID]) {
    const organizationRoles = snapshot.roles.filter((role) => role.organizationId === organizationId);
    requireCondition(organizationRoles.length === 6, 'organization role count differs');
    for (const [roleKey, permissions] of Object.entries(expectedRolePermissions)) {
      const role = organizationRoles.find((candidate) => candidate.key === roleKey);
      requireCondition(role?.isSystem && role.name === ROLE_NAMES[roleKey], `${roleKey} identity differs`);
      requireCondition(same(role.permissions, sorted(permissions)), `${roleKey} permission mapping differs`);
    }
  }

  requireCondition(Object.values(snapshot.authority).every((value) => value === 0), 'authority drift exists');
  requireCondition(snapshot.domain.total === 88 && snapshot.domain.demo === 88 && snapshot.domain.purplelok === 0 && snapshot.domain.nullOwned === 0 && snapshot.domain.orphaned === 0, 'domain ownership baseline differs');
  requireCondition(snapshot.policy.count === 84 && snapshot.policy.hash === POLICY_HASH, 'domain policy baseline differs');
  requireCondition(snapshot.rls.length === 21 && snapshot.rls.every((row) => row.enabled && !row.forced && row.owner === 'postgres') && same(snapshot.rls.map(({ name }) => name).sort(), sorted(DOMAIN_TABLES)), 'domain RLS flags differ');
  requireCondition(snapshot.owner.users === 1 && snapshot.owner.emailIdentities === 1 && snapshot.owner.sessions > 0 && snapshot.owner.correlatedSessions > 0, 'Owner live password-session baseline differs');
  requireCondition(snapshot.owner.profiles === 1 && snapshot.owner.memberships === 1 && snapshot.owner.ownerRoles === 1 && snapshot.owner.assignedRoles === 1 && snapshot.owner.clientRoles === 0, 'Owner authority differs');
  requireCondition(snapshot.owner.gates === 0 && snapshot.owner.recoveryPending === 0, 'recovery gate exists');

  requireCondition(snapshot.d1Helpers.length === D1_HELPERS.length, 'D1 helper count/overload set differs');
  for (const expected of D1_HELPERS) {
    const helper = snapshot.d1Helpers.find(({ signature }) => signature === expected[0]);
    requireCondition(helper, `${expected[0]} is absent`);
    validateFunction(helper, expected);
  }

  if (phase === 'pre') {
    requireCondition(snapshot.d2Functions.length === 0 && snapshot.d2Triggers.length === 0, 'D2 protection objects partially exist');
  } else {
    requireCondition(snapshot.d2Functions.length === 3, 'D2 function count/overload set differs');
    for (const signature of D2_FUNCTIONS) {
      const functionState = snapshot.d2Functions.find((candidate) => candidate.signature === signature);
      requireCondition(functionState, `${signature} is absent`);
      requireCondition(functionState.owner === 'postgres' && functionState.volatility === 'v' && functionState.securityDefiner && functionState.result === 'trigger', `${signature} metadata differs`);
      requireCondition(functionState.config.length === 2 && functionState.config.includes('search_path=""') && functionState.config.includes('row_security=off'), `${signature} settings differ`);
      requireCondition(same(functionState.executeGrantees, ['postgres']), `${signature} ACL differs`);
    }
    requireCondition(snapshot.d2Triggers.length === 3, 'D2 trigger count differs');
    for (const [name, table, functionName, type] of D2_TRIGGERS) {
      const trigger = snapshot.d2Triggers.find((candidate) => candidate.name === name);
      requireCondition(trigger && trigger.table === table && trigger.functionSchema === 'private' && trigger.functionName === functionName && trigger.enabled === 'O' && trigger.type === type && !trigger.internal, `${name} differs`);
    }
  }
  requireCondition(snapshot.laterObjects === 0, 'D3/D4 object exists');
}

function phaseFromArgs(): D2Phase {
  const value = process.argv[2];
  if (value !== 'pre' && value !== 'after') throw new Error('Usage: batch5f-d2-production-check.ts <pre|after>');
  return value;
}

function directDatabaseUrl(): string {
  const value = process.env.SUPABASE_PROD_DIRECT_DB_URL?.trim();
  requireCondition(value, 'SUPABASE_PROD_DIRECT_DB_URL is required');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('Batch 5F-D2 contract failed: database secret is not a valid URL'); }
  requireCondition(['postgres:', 'postgresql:'].includes(parsed.protocol), 'database protocol is not PostgreSQL');
  requireCondition(parsed.hostname.toLowerCase() === `db.${PROJECT_REF}.supabase.co`, 'database host is not the exact production direct host');
  requireCondition(decodeURIComponent(parsed.username) === 'postgres', 'database username is not the direct role');
  requireCondition(Number(parsed.port || 5432) === 5432 && !parsed.hostname.toLowerCase().includes('pooler'), 'database connection is not direct port 5432');
  return value;
}

async function one<T extends QueryResultRow>(client: Client, sql: string, values: unknown[] = []): Promise<T> {
  const result = await client.query<T>(sql, values);
  requireCondition(result.rowCount === 1, 'singleton query returned an unexpected row count');
  return result.rows[0];
}

async function functionSnapshots(client: Client, names: readonly string[]): Promise<FunctionSnapshot[]> {
  const result = await client.query<{
    signature: string; owner: string; volatility: string; security_definer: boolean;
    result: string; config: string[] | null; execute_grantees: string[];
  }>(`
    select namespace.nspname||'.'||procedure.proname||'('||replace(pg_catalog.oidvectortypes(procedure.proargtypes),', ', ',')||')' signature,
      pg_catalog.pg_get_userbyid(procedure.proowner) owner,procedure.provolatile volatility,
      procedure.prosecdef security_definer,pg_catalog.pg_get_function_result(procedure.oid) result,
      coalesce(procedure.proconfig,'{}'::text[]) config,
      array(select coalesce(pg_catalog.pg_get_userbyid(acl.grantee),'PUBLIC')
        from pg_catalog.aclexplode(coalesce(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl
        where acl.privilege_type='EXECUTE' order by 1) execute_grantees
    from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='private' and procedure.proname=any($1::text[]) order by signature
  `, [names]);
  return result.rows.map((row) => ({ signature: row.signature, owner: row.owner, volatility: row.volatility, securityDefiner: row.security_definer, result: row.result, config: row.config ?? [], executeGrantees: row.execute_grantees }));
}

async function collectSnapshot(client: Client): Promise<D2Snapshot> {
  const migrationsResult = await client.query<{ version: string; name: string }>('select version,name from supabase_migrations.schema_migrations order by version');
  const organizations = await client.query<{ id: string; slug: string; status: string }>('select id,slug,status from public.organizations order by slug');
  const permissions = await client.query<{ key: string }>('select key from public.permissions order by key');
  const rolesResult = await client.query<{ organization_id: string; key: string; name: string; is_system: boolean; permissions: string[] }>(`
    select role.organization_id,role.key,role.name,role.is_system,
      coalesce(array_agg(mapping.permission_key order by mapping.permission_key) filter(where mapping.permission_key is not null),'{}'::text[]) permissions
    from public.organization_roles role left join public.organization_role_permissions mapping
      on mapping.organization_id=role.organization_id and mapping.organization_role_id=role.id
    group by role.organization_id,role.id,role.key,role.name,role.is_system order by role.organization_id,role.key
  `);
  const authorityRow = await one<{ client_assignments: number; mixed_assignments: number; malformed_permissions: number; orphan_mappings: number; platform_admins: number }>(client, `
    select
      (select count(*)::integer from public.organization_member_roles mr join public.organization_roles role on role.id=mr.organization_role_id and role.organization_id=mr.organization_id where role.key='client') client_assignments,
      (select count(*)::integer from public.organization_members member where
        exists(select 1 from public.organization_member_roles mr join public.organization_roles role on role.id=mr.organization_role_id and role.organization_id=mr.organization_id where mr.organization_member_id=member.id and mr.organization_id=member.organization_id and role.key='client')
        and exists(select 1 from public.organization_member_roles mr join public.organization_roles role on role.id=mr.organization_role_id and role.organization_id=mr.organization_id where mr.organization_member_id=member.id and mr.organization_id=member.organization_id and role.key<>'client')) mixed_assignments,
      (select count(*)::integer from public.permissions where key is null or btrim(key)='' or key<>btrim(key) or key<>lower(key)) malformed_permissions,
      (select count(*)::integer from public.organization_role_permissions mapping left join public.organization_roles role on role.id=mapping.organization_role_id and role.organization_id=mapping.organization_id left join public.permissions permission on permission.key=mapping.permission_key where role.id is null or permission.key is null) orphan_mappings,
      (select count(*)::integer from public.platform_admins) platform_admins
  `);
  const domain = { total: 0, demo: 0, purplelok: 0, nullOwned: 0, orphaned: 0 };
  for (const table of DOMAIN_TABLES) {
    const row = await one<{ total: number; demo: number; purplelok: number; null_owned: number; orphaned: number }>(client, `select count(*)::integer total,count(*) filter(where record.organization_id='${DEMO_ID}')::integer demo,count(*) filter(where record.organization_id='${PURPLELOK_ID}')::integer purplelok,count(*) filter(where record.organization_id is null)::integer null_owned,count(*) filter(where record.organization_id is not null and organization.id is null)::integer orphaned from public.${table} record left join public.organizations organization on organization.id=record.organization_id`);
    domain.total += row.total; domain.demo += row.demo; domain.purplelok += row.purplelok; domain.nullOwned += row.null_owned; domain.orphaned += row.orphaned;
  }
  const policy = await one<{ count: number; hash: string }>(client, `select count(*)::integer count,md5(string_agg(format('%s|%s|%s|%s|%s|%s|%s',schemaname,tablename,policyname,permissive,roles::text,cmd,coalesce(qual,'')||'|'||coalesce(with_check,'')),E'\\n' order by schemaname,tablename,policyname)) hash from pg_catalog.pg_policies where schemaname='public' and tablename=any($1::text[])`, [DOMAIN_TABLES]);
  const rlsResult = await client.query<{ name: string; enabled: boolean; forced: boolean; owner: string }>(`select relation.relname name,relation.relrowsecurity enabled,relation.relforcerowsecurity forced,pg_catalog.pg_get_userbyid(relation.relowner) owner from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace where namespace.nspname='public' and relation.relkind='r' and relation.relname=any($1::text[]) order by relation.relname`, [DOMAIN_TABLES]);
  const owner = await one<{ users: number; email_identities: number; sessions: number; correlated_sessions: number; profiles: number; memberships: number; owner_roles: number; assigned_roles: number; client_roles: number; gates: number; recovery_pending: number }>(client, `
    with owner_user as(select id,last_sign_in_at from auth.users where id=$1::uuid and deleted_at is null),
    live_sessions as(select session.created_at from auth.sessions session join owner_user on owner_user.id=session.user_id where session.not_after is null or session.not_after>now()),
    membership as(select member.id from public.organization_members member join public.organizations organization on organization.id=member.organization_id where member.user_id=$1::uuid and member.organization_id=$2::uuid and member.status='active' and organization.status='active'),
    roles as(select role.key,role.name,role.is_system from public.organization_member_roles mr join membership on membership.id=mr.organization_member_id join public.organization_roles role on role.id=mr.organization_role_id and role.organization_id=$2::uuid)
    select (select count(*)::integer from owner_user) users,
      (select count(*)::integer from auth.identities identity join owner_user on owner_user.id=identity.user_id where identity.provider='email') email_identities,
      (select count(*)::integer from live_sessions) sessions,
      (select count(*)::integer from live_sessions,owner_user where owner_user.last_sign_in_at is not null and abs(extract(epoch from(live_sessions.created_at-owner_user.last_sign_in_at)))<120) correlated_sessions,
      (select count(*)::integer from public.profiles where id=$1::uuid and active) profiles,(select count(*)::integer from membership) memberships,
      (select count(*)::integer from roles where key='owner' and name='Owner' and is_system) owner_roles,(select count(*)::integer from roles) assigned_roles,
      (select count(*)::integer from roles where key='client' or name='Client') client_roles,(select count(*)::integer from private.auth_session_gates) gates,
      (select count(*)::integer from private.auth_session_gates where gate_type='RECOVERY_PENDING') recovery_pending
  `, [OWNER_ID, PURPLELOK_ID]);
  const d1Helpers = await functionSnapshots(client, D1_HELPERS.map(([signature]) => signature.slice('private.'.length, signature.indexOf('('))));
  const d2Functions = await functionSnapshots(client, D2_FUNCTIONS.map((signature) => signature.slice('private.'.length, signature.indexOf('('))));
  const triggerResult = await client.query<{ name: string; table_name: string; function_schema: string; function_name: string; enabled: string; type: number; internal: boolean }>(`
    select trigger.tgname name,relation.relname table_name,function_namespace.nspname function_schema,procedure.proname function_name,trigger.tgenabled enabled,trigger.tgtype::integer type,trigger.tgisinternal internal
    from pg_catalog.pg_trigger trigger join pg_catalog.pg_class relation on relation.oid=trigger.tgrelid join pg_catalog.pg_namespace table_namespace on table_namespace.oid=relation.relnamespace
    join pg_catalog.pg_proc procedure on procedure.oid=trigger.tgfoid join pg_catalog.pg_namespace function_namespace on function_namespace.oid=procedure.pronamespace
    where table_namespace.nspname='public' and trigger.tgname=any($1::text[]) order by trigger.tgname
  `, [D2_TRIGGERS.map(([name]) => name)]);
  const later = await one<{ count: number }>(client, `with later_functions(signature) as(values ('private.purplelok_can_reference_members(uuid,text,uuid[])'),('private.purplelok_protect_domain_update()'),('private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)'),('private.purplelok_protect_payment_insert()'),('public.record_payment(uuid,numeric,text,text)'),('public.send_quote(uuid)'),('public.approve_quote(uuid)'),('public.convert_quote_to_invoice(uuid,text,date,date)'),('public.convert_quote_to_project(uuid)'),('public.change_lead_stage(uuid,text)')) select ((select count(*) from later_functions where to_regprocedure(signature) is not null)+(select count(*) from pg_catalog.pg_policies where schemaname='public' and policyname like 'domain\\_%' escape '\\')+(select count(*) from pg_catalog.pg_trigger where not tgisinternal and tgname like 'domain\\_%\\_protect\\_update' escape '\\')+(select count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace where namespace.nspname='public' and relation.relname=any(array['invoices_quote_id_unique','payments_invoice_reference_unique','projects_source_quote_id_unique']))+(select count(*) from information_schema.columns where table_schema='public' and table_name='projects' and column_name='source_quote_id'))::integer count`);
  return {
    migrations: migrationsResult.rows.map(({ version, name }) => [version, name]), organizations: organizations.rows,
    permissionKeys: permissions.rows.map(({ key }) => key),
    roles: rolesResult.rows.map((role) => ({ organizationId: role.organization_id, key: role.key, name: role.name, isSystem: role.is_system, permissions: role.permissions })),
    authority: { clientAssignments: authorityRow.client_assignments, mixedAssignments: authorityRow.mixed_assignments, malformedPermissions: authorityRow.malformed_permissions, orphanMappings: authorityRow.orphan_mappings, platformAdmins: authorityRow.platform_admins },
    domain, policy, rls: rlsResult.rows,
    owner: { users: owner.users, emailIdentities: owner.email_identities, sessions: owner.sessions, correlatedSessions: owner.correlated_sessions, profiles: owner.profiles, memberships: owner.memberships, ownerRoles: owner.owner_roles, assignedRoles: owner.assigned_roles, clientRoles: owner.client_roles, gates: owner.gates, recoveryPending: owner.recovery_pending },
    d1Helpers, d2Functions,
    d2Triggers: triggerResult.rows.map((trigger) => ({ name: trigger.name, table: trigger.table_name, functionSchema: trigger.function_schema, functionName: trigger.function_name, enabled: trigger.enabled, type: trigger.type, internal: trigger.internal })),
    laterObjects: later.count,
  };
}

async function main(): Promise<void> {
  const currentPhase = phaseFromArgs();
  let databaseUrl = directDatabaseUrl();
  const hostname = new URL(databaseUrl).hostname;
  let addresses: string[];
  try { addresses = await resolve6(hostname); } catch { throw new Error('Batch 5F-D2 contract failed: production direct hostname has no IPv6 resolution'); }
  requireCondition(addresses.length > 0, 'production direct hostname has no IPv6 address');
  const client = new Client({ connectionString: databaseUrl, application_name: `batch-5f-d2-${currentPhase}-readonly-check` });
  try {
    await client.connect();
    const connection = await one<{ ipv6: boolean; port: number }>(client, `select pg_catalog.family(pg_catalog.inet_server_addr())=6 ipv6,pg_catalog.inet_server_port()::integer port`);
    requireCondition(connection.ipv6 && connection.port === 5432, 'runtime connection is not direct IPv6 port 5432');
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const readOnly = await one<{ value: string }>(client, "select current_setting('transaction_read_only') value");
    requireCondition(readOnly.value === 'on', 'transaction is not read only');
    const snapshot = await collectSnapshot(client);
    validateD2Snapshot(snapshot, currentPhase);
    await client.query('select public.batch_3b_assert_seed_manifest()');
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ mode: 'READ ONLY', projectRef: PROJECT_REF, phase: currentPhase, migrations: snapshot.migrations.length, permissions: snapshot.permissionKeys.length, policies: snapshot.policy.count, domain: snapshot.domain, result: 'PASS' }, null, 2));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    databaseUrl = '';
    await client.end();
  }
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entry) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Batch 5F-D2 production check failed');
    process.exitCode = 1;
  });
}
