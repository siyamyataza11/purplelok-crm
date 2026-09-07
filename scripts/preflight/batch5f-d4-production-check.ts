import { resolve6 } from 'node:dns/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client, type QueryResultRow } from 'pg';

export type D4Phase = 'pre' | 'after';

const PROJECT_REF = 'vkgvfllqgfleosufzwhc';
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
const OWNER_ID = 'dc62be87-fe6a-4b3f-8a6c-a875ffe36a9c';
const DEMO_ADMIN_ID = '148803f0-322b-408e-9ffc-c9ce486172a6';
const PURPLELOK_ID = '2f02d28b-a8f1-48cd-acbc-f47a5bcd1757';
const DEMO_ID = '9e35e50a-8a9f-4fec-b64e-13388a415e10';
const D3_POLICY_HASH = 'ce50cde59a1bd0116a593f0db805e1d8';

export const POST_D3_MIGRATIONS = [
  ['20260728110005', 'create_crm_schema'],
  ['20260728111045', 'seed_demo_data'],
  ['20260828120000', 'batch_1_identity_rbac_foundation'],
  ['20260828150000', 'batch_3b_tenant_ownership_foundation'],
  ['20260828170000', 'batch_4_active_organization_context'],
  ['20260829100000', 'batch_5a_tenant_data_foundation'],
  ['20260831120000', 'batch_5e_b2r_profile_authority'],
  ['20260902120000', 'batch_5f_c1_auth_session_gate'],
  ['20260903120000', 'batch_5f_d1_authorization_foundation'],
  ['20260903180000', 'batch_5f_d2_permission_catalogue'],
  ['20260904120000', 'batch_5f_d3_domain_rls_cutover'],
] as const;

export const D4_MIGRATION = ['20260904180000', 'batch_5f_d4_protected_workflows'] as const;

export const DOMAIN_TABLES = [
  'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
  'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
  'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
  'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
  'messages',
] as const;

export const PERMISSION_KEYS = [
  'activities.read', 'clients.read', 'clients.write', 'collaboration.manage',
  'collaboration.read', 'collaboration.write', 'documents.read', 'documents.write',
  'invoices.approve', 'invoices.read', 'invoices.write', 'leads.read',
  'leads.write', 'members.manage', 'members.read', 'payments.read',
  'payments.record', 'projects.manage', 'projects.read', 'projects.write',
  'quotes.approve', 'quotes.read', 'quotes.write', 'reports.read',
  'roles.manage', 'roles.read', 'settings.manage', 'settings.read',
  'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write',
] as const;

export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner: PERMISSION_KEYS,
  admin: PERMISSION_KEYS,
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
  ['private.purplelok_current_session_id()', false, false, 'uuid', 'row_security=on', 'plpgsql'],
  ['private.purplelok_has_normal_session()', true, true, 'boolean', 'row_security=off', 'plpgsql'],
  ['private.purplelok_has_active_membership(uuid)', true, true, 'boolean', 'row_security=off', 'plpgsql'],
  ['private.purplelok_has_permission(uuid,text)', true, true, 'boolean', 'row_security=off', 'plpgsql'],
  ['private.purplelok_can_access_resource(uuid,text)', false, true, 'boolean', 'row_security=on', 'sql'],
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

const D3_FUNCTIONS = [
  ['private.purplelok_can_reference_members(uuid,text,uuid[])', true, true, 'boolean', 's', 'row_security=off', 'sql', false],
  ['private.purplelok_protect_domain_update()', false, false, 'trigger', 'v', 'row_security=on', 'plpgsql', false],
] as const;

export const D4_FUNCTIONS = [
  ['private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)', false, false, 'uuid', 'v', 'row_security=off', 'plpgsql', false, '7f2fb12b2e52dc48f7a44a1c93127eb9'],
  ['private.purplelok_protect_payment_insert()', false, false, 'trigger', 'v', 'row_security=off', 'plpgsql', false, '7f974ea113adb5727433fcc18c9fb8ee'],
  ['public.send_quote(uuid)', true, true, 'TABLE(quote_id uuid, quote_status text)', 'v', 'row_security=off', 'plpgsql', false, 'c26b72f48cdf45e4d7fd4865ce067c0c'],
  ['public.approve_quote(uuid)', true, true, 'TABLE(quote_id uuid, quote_status text)', 'v', 'row_security=off', 'plpgsql', false, 'cff8ef07560e3a36a02c620074767ea8'],
  ['public.convert_quote_to_invoice(uuid,text,date,date)', true, true, 'TABLE(invoice_id uuid, invoice_status text)', 'v', 'row_security=off', 'plpgsql', false, '961b5f4e9b5ce3896b17659dfa4bb8d3'],
  ['public.convert_quote_to_project(uuid)', true, true, 'TABLE(project_id uuid, project_status text)', 'v', 'row_security=off', 'plpgsql', false, '1ab7f6fb3d8eb91cf2409a66227282b1'],
  ['public.change_lead_stage(uuid,text)', true, true, 'TABLE(lead_id uuid, lead_stage text)', 'v', 'row_security=off', 'plpgsql', false, 'f26a38145da89f1c2bf45f131a4672ee'],
  ['public.record_payment(uuid,numeric,text,text)', true, true, 'TABLE(payment_id uuid, invoice_id uuid, invoice_status text, amount_paid numeric, balance numeric)', 'v', 'row_security=off', 'plpgsql', false, '9d6674950cd8aee9a493bd4d5fd45350'],
] as const;

const TENANT_FKS = [
  'client_contacts_client_organization_fkey', 'client_notes_client_organization_fkey',
  'leads_client_organization_fkey', 'quotes_client_organization_fkey',
  'quote_items_quote_organization_fkey', 'invoices_client_organization_fkey',
  'invoices_quote_organization_fkey', 'invoice_items_invoice_organization_fkey',
  'payments_invoice_organization_fkey', 'payments_client_organization_fkey',
  'projects_client_organization_fkey', 'project_milestones_project_organization_fkey',
  'tasks_project_organization_fkey', 'tasks_client_organization_fkey',
  'task_comments_task_organization_fkey', 'meetings_project_organization_fkey',
  'meetings_client_organization_fkey', 'documents_folder_organization_fkey',
  'documents_client_organization_fkey', 'tickets_client_organization_fkey',
  'ticket_messages_ticket_organization_fkey', 'messages_channel_organization_fkey',
] as const;

export interface FunctionSnapshot {
  signature: string;
  owner: string;
  volatility: string;
  securityDefiner: boolean;
  result: string;
  config: string[];
  executeGrantees: string[];
  language: string;
  strict: boolean;
  bodyHash: string;
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

export interface IdentitySnapshot {
  users: number;
  emailIdentities: number;
  liveSessions: number;
  tokenSessionMatches: number;
  profiles: number;
  memberships: number;
  expectedRoles: number;
  assignedRoles: number;
  clientRoles: number;
}

export interface D4Snapshot {
  migrations: Array<[string, string]>;
  organizations: Array<{ id: string; slug: string; status: string }>;
  permissionKeys: string[];
  roles: Array<{ organizationId: string; key: string; name: string; isSystem: boolean; permissions: string[] }>;
  authority: { clientAssignments: number; mixedAssignments: number; malformedPermissions: number; orphanMappings: number; platformAdmins: number };
  domain: { total: number; demo: number; purplelok: number; nullOwned: number; orphaned: number };
  tenantIntegrity: { validForeignKeys: number; invalidForeignKeys: number; childMismatches: number };
  policy: { count: number; hash: string; d3Named: number };
  rls: Array<{ name: string; enabled: boolean; forced: boolean; owner: string }>;
  owner: IdentitySnapshot;
  demoAdmin: IdentitySnapshot;
  gates: { total: number; recoveryPending: number };
  d1Helpers: FunctionSnapshot[];
  d2Functions: FunctionSnapshot[];
  d2Triggers: TriggerSnapshot[];
  d3Functions: FunctionSnapshot[];
  d3Triggers: TriggerSnapshot[];
  d4Functions: FunctionSnapshot[];
  d4Triggers: TriggerSnapshot[];
  d4Schema: { indexes: number; projectColumn: number; tenantForeignKey: number; projectSourceQuoteValues: number };
  d4Preconditions: { invoiceQuoteDuplicates: number; paymentReferenceDuplicates: number };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Batch 5F-D4 contract failed: ${message}`);
}

function validateFunction(actual: FunctionSnapshot, expected: readonly [string, boolean, boolean, string, string, string, string?, boolean?, string?]): void {
  const [signature, securityDefiner, authenticated, result, volatility, rowSecurity, language, strict, bodyHash] = expected;
  requireCondition(actual.signature === signature, `${signature} signature differs`);
  requireCondition(actual.owner === 'postgres' && actual.volatility === volatility, `${signature} owner/volatility differs`);
  requireCondition(actual.securityDefiner === securityDefiner && actual.result === result, `${signature} security/result differs`);
  requireCondition(actual.config.length === 2 && actual.config.includes('search_path=""') && actual.config.includes(rowSecurity), `${signature} settings differ`);
  requireCondition(same(actual.executeGrantees, authenticated ? ['authenticated', 'postgres'] : ['postgres']), `${signature} ACL differs`);
  if (language !== undefined) requireCondition(actual.language === language, `${signature} language differs`);
  if (strict !== undefined) requireCondition(actual.strict === strict, `${signature} STRICT behavior differs`);
  if (bodyHash !== undefined) requireCondition(actual.bodyHash === bodyHash, `${signature} body differs`);
}

function validateIdentity(actual: IdentitySnapshot, label: string): void {
  requireCondition(actual.users === 1 && actual.emailIdentities === 1, `${label} Auth identity differs`);
  requireCondition(actual.liveSessions > 0 && actual.tokenSessionMatches === 1, `${label} live token/session proof differs`);
  requireCondition(actual.profiles === 1 && actual.memberships === 1, `${label} active profile/membership differs`);
  requireCondition(actual.expectedRoles === 1 && actual.assignedRoles === 1 && actual.clientRoles === 0, `${label} role authority differs`);
}

export function validateD4Snapshot(snapshot: D4Snapshot, phase: D4Phase): void {
  const expectedMigrations = phase === 'pre' ? POST_D3_MIGRATIONS : [...POST_D3_MIGRATIONS, D4_MIGRATION];
  requireCondition(same(snapshot.migrations, expectedMigrations), 'migration history differs');
  requireCondition(same(snapshot.permissionKeys, PERMISSION_KEYS), 'permission catalogue differs');
  requireCondition(snapshot.organizations.length === 2, 'organization inventory differs');
  requireCondition(snapshot.organizations.some((row) => row.id === PURPLELOK_ID && row.slug === 'purplelok' && row.status === 'active'), 'PURPLELOK differs');
  requireCondition(snapshot.organizations.some((row) => row.id === DEMO_ID && row.slug === 'purplelok-demo' && row.status === 'active'), 'PURPLELOK Demo differs');

  requireCondition(snapshot.roles.length === 12, 'role inventory is not exactly six per organization');
  for (const organizationId of [PURPLELOK_ID, DEMO_ID]) {
    const organizationRoles = snapshot.roles.filter((role) => role.organizationId === organizationId);
    requireCondition(organizationRoles.length === 6, 'organization role count differs');
    for (const [roleKey, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      const role = organizationRoles.find((candidate) => candidate.key === roleKey);
      requireCondition(role?.isSystem && role.name === ROLE_NAMES[roleKey], `${roleKey} identity differs`);
      requireCondition(same(role.permissions, sorted(permissions)), `${roleKey} permission mapping differs`);
    }
  }

  requireCondition(Object.values(snapshot.authority).every((value) => value === 0), 'authority drift exists');
  requireCondition(snapshot.domain.total === 88 && snapshot.domain.demo === 88 && snapshot.domain.purplelok === 0 && snapshot.domain.nullOwned === 0 && snapshot.domain.orphaned === 0, 'domain ownership baseline differs');
  requireCondition(snapshot.tenantIntegrity.validForeignKeys === 22 && snapshot.tenantIntegrity.invalidForeignKeys === 0 && snapshot.tenantIntegrity.childMismatches === 0, 'tenant integrity differs');
  requireCondition(snapshot.d4Preconditions.invoiceQuoteDuplicates === 0 && snapshot.d4Preconditions.paymentReferenceDuplicates === 0, 'D4 uniqueness preconditions differ');
  const expectedPolicy = { count: 52, hash: D3_POLICY_HASH, d3Named: 52 };
  requireCondition(same(snapshot.policy, expectedPolicy), 'domain policy manifest differs');
  requireCondition(snapshot.rls.length === 21 && snapshot.rls.every((row) => row.enabled && !row.forced && row.owner === 'postgres') && same(snapshot.rls.map(({ name }) => name).sort(), sorted(DOMAIN_TABLES)), 'domain RLS flags differ');
  validateIdentity(snapshot.owner, 'Owner');
  validateIdentity(snapshot.demoAdmin, 'Demo Admin');
  requireCondition(snapshot.gates.total === 0 && snapshot.gates.recoveryPending === 0, 'recovery gate exists');

  requireCondition(snapshot.d1Helpers.length === D1_HELPERS.length, 'D1 helper count/overload set differs');
  for (const [signature, securityDefiner, authenticated, result, rowSecurity, language] of D1_HELPERS) {
    const helper = snapshot.d1Helpers.find((candidate) => candidate.signature === signature);
    requireCondition(helper, `${signature} is absent`);
    validateFunction(helper, [signature, securityDefiner, authenticated, result, 's', rowSecurity, language, false]);
  }

  requireCondition(snapshot.d2Functions.length === 3, 'D2 function count/overload set differs');
  for (const signature of D2_FUNCTIONS) {
    const functionState = snapshot.d2Functions.find((candidate) => candidate.signature === signature);
    requireCondition(functionState, `${signature} is absent`);
    validateFunction(functionState, [signature, true, false, 'trigger', 'v', 'row_security=off', 'plpgsql', false]);
  }
  requireCondition(snapshot.d2Triggers.length === 3, 'D2 trigger count differs');
  for (const [name, table, functionName, type] of D2_TRIGGERS) {
    const trigger = snapshot.d2Triggers.find((candidate) => candidate.name === name);
    requireCondition(trigger && trigger.table === table && trigger.functionSchema === 'private' && trigger.functionName === functionName && trigger.enabled === 'O' && trigger.type === type && !trigger.internal, `${name} differs`);
  }

  requireCondition(snapshot.d3Functions.length === 2, 'D3 function count/overload set differs');
  for (const expected of D3_FUNCTIONS) {
    const functionState = snapshot.d3Functions.find((candidate) => candidate.signature === expected[0]);
    requireCondition(functionState, `${expected[0]} is absent`);
    validateFunction(functionState, expected);
  }
  requireCondition(snapshot.d3Triggers.length === 21, 'D3 trigger count differs');
  for (const table of DOMAIN_TABLES) {
    const name = `domain_${table}_protect_update`;
    const trigger = snapshot.d3Triggers.find((candidate) => candidate.name === name);
    requireCondition(trigger && trigger.table === table && trigger.functionSchema === 'private' && trigger.functionName === 'purplelok_protect_domain_update' && trigger.enabled === 'O' && trigger.type === 19 && !trigger.internal, `${name} differs`);
  }

  if (phase === 'pre') {
    requireCondition(snapshot.d4Functions.length === 0 && snapshot.d4Triggers.length === 0, 'D4 functions/triggers partially exist');
    requireCondition(snapshot.d4Schema.indexes === 0 && snapshot.d4Schema.projectColumn === 0 && snapshot.d4Schema.tenantForeignKey === 0 && snapshot.d4Schema.projectSourceQuoteValues === 0, 'D4 schema objects partially exist');
  } else {
    requireCondition(snapshot.d4Functions.length === 8, 'D4 function count/overload set differs');
    for (const expected of D4_FUNCTIONS) {
      const functionState = snapshot.d4Functions.find((candidate) => candidate.signature === expected[0]);
      requireCondition(functionState, `${expected[0]} is absent`);
      validateFunction(functionState, expected);
    }
    requireCondition(snapshot.d4Triggers.length === 1, 'D4 trigger count differs');
    const paymentTrigger = snapshot.d4Triggers[0];
    requireCondition(paymentTrigger.name === 'payments_require_protected_workflow' && paymentTrigger.table === 'payments' && paymentTrigger.functionSchema === 'private' && paymentTrigger.functionName === 'purplelok_protect_payment_insert' && paymentTrigger.enabled === 'O' && paymentTrigger.type === 7 && !paymentTrigger.internal, 'payment workflow trigger differs');
    requireCondition(snapshot.d4Schema.indexes === 3 && snapshot.d4Schema.projectColumn === 1 && snapshot.d4Schema.tenantForeignKey === 1 && snapshot.d4Schema.projectSourceQuoteValues === 0, 'D4 schema objects differ');
  }
}

function phaseFromArgs(): D4Phase {
  const value = process.argv[2];
  if (value !== 'pre' && value !== 'after') throw new Error('Usage: batch5f-d4-production-check.ts <pre|after>');
  return value;
}

function directDatabaseUrl(): string {
  const value = process.env.SUPABASE_PROD_DIRECT_DB_URL?.trim();
  requireCondition(value, 'SUPABASE_PROD_DIRECT_DB_URL is required');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('Batch 5F-D4 contract failed: database secret is not a valid URL'); }
  requireCondition(['postgres:', 'postgresql:'].includes(parsed.protocol), 'database protocol is not PostgreSQL');
  requireCondition(parsed.hostname.toLowerCase() === `db.${PROJECT_REF}.supabase.co`, 'database host is not the exact production direct host');
  requireCondition(decodeURIComponent(parsed.username) === 'postgres', 'database username is not the direct role');
  requireCondition(Number(parsed.port || 5432) === 5432 && !parsed.hostname.toLowerCase().includes('pooler'), 'database connection is not direct port 5432');
  return value;
}

interface VerifiedToken { sub: string; sessionId: string }

async function verifiedToken(variable: string, expectedUserId: string): Promise<VerifiedToken> {
  const token = process.env[variable]?.trim();
  const anonKey = process.env.SUPABASE_PROD_ANON_KEY?.trim();
  requireCondition(token && anonKey, `${variable} and SUPABASE_PROD_ANON_KEY are required`);
  const response = await fetch(`${PROJECT_URL}/auth/v1/user`, { headers: { apikey: anonKey, authorization: `Bearer ${token}` } });
  requireCondition(response.ok, `${variable} is not a live Auth token`);
  const user = await response.json() as { id?: string };
  const payloadText = Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8');
  let claims: Record<string, unknown>;
  try { claims = JSON.parse(payloadText) as Record<string, unknown>; } catch { throw new Error(`Batch 5F-D4 contract failed: ${variable} JWT payload is malformed`); }
  requireCondition(user.id === expectedUserId && claims.sub === expectedUserId, `${variable} identity differs`);
  requireCondition(claims.role === 'authenticated' && claims.purplelok_session_state === 'normal_v1', `${variable} is not a normal authenticated session`);
  const authenticationMethods = Array.isArray(claims.amr) ? claims.amr : [];
  requireCondition(authenticationMethods.some((entry) => typeof entry === 'object' && entry !== null && 'method' in entry && entry.method === 'password'), `${variable} is not password-authenticated`);
  const sessionId = claims.session_id;
  requireCondition(typeof sessionId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId), `${variable} session_id is invalid`);
  return { sub: expectedUserId, sessionId };
}

async function one<T extends QueryResultRow>(client: Client, sql: string, values: unknown[] = []): Promise<T> {
  const result = await client.query<T>(sql, values);
  requireCondition(result.rowCount === 1, 'singleton query returned an unexpected row count');
  return result.rows[0];
}

async function functionSnapshots(client: Client, names: readonly string[]): Promise<FunctionSnapshot[]> {
  const result = await client.query<{ signature: string; owner: string; volatility: string; security_definer: boolean; result: string; config: string[] | null; execute_grantees: string[]; language: string; strict: boolean; body_hash: string }>(`
    select namespace.nspname||'.'||procedure.proname||'('||replace(pg_catalog.oidvectortypes(procedure.proargtypes),', ', ',')||')' signature,
      pg_catalog.pg_get_userbyid(procedure.proowner) owner,procedure.provolatile volatility,procedure.prosecdef security_definer,
      pg_catalog.pg_get_function_result(procedure.oid) result,coalesce(procedure.proconfig,'{}'::text[]) config,language.lanname language,procedure.proisstrict strict,
      pg_catalog.md5(pg_catalog.btrim(pg_catalog.regexp_replace(procedure.prosrc,'[[:space:]]+',' ','g'))) body_hash,
      array(select coalesce(pg_catalog.pg_get_userbyid(acl.grantee),'PUBLIC') from pg_catalog.aclexplode(coalesce(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl where acl.privilege_type='EXECUTE' order by 1) execute_grantees
    from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace join pg_catalog.pg_language language on language.oid=procedure.prolang
    where namespace.nspname=any(array['private','public']) and procedure.proname=any($1::text[]) order by signature
  `, [names]);
  return result.rows.map((row) => ({ signature: row.signature, owner: row.owner, volatility: row.volatility, securityDefiner: row.security_definer, result: row.result, config: row.config ?? [], executeGrantees: row.execute_grantees, language: row.language, strict: row.strict, bodyHash: row.body_hash }));
}

async function identitySnapshot(client: Client, userId: string, email: string, organizationId: string, expectedRole: string, tokenSessionId: string): Promise<IdentitySnapshot> {
  const row = await one<{ users: number; email_identities: number; live_sessions: number; token_session_matches: number; profiles: number; memberships: number; expected_roles: number; assigned_roles: number; client_roles: number }>(client, `
    with live_user as(select id from auth.users where id=$1::uuid and lower(email)=lower($5) and deleted_at is null and email_confirmed_at is not null and (select count(*) from auth.users where lower(email)=lower($5))=1),
    membership as(select member.id from public.organization_members member join public.organizations organization on organization.id=member.organization_id where member.user_id=$1::uuid and member.organization_id=$2::uuid and member.status='active' and organization.status='active'),
    roles as(select role.key,role.name,role.is_system from public.organization_member_roles mr join membership on membership.id=mr.organization_member_id join public.organization_roles role on role.id=mr.organization_role_id and role.organization_id=$2::uuid)
    select (select count(*)::integer from live_user) users,
      (select count(*)::integer from auth.identities identity join live_user on live_user.id=identity.user_id where identity.provider='email') email_identities,
      (select count(*)::integer from auth.sessions session join live_user on live_user.id=session.user_id where session.not_after is null or session.not_after>now()) live_sessions,
      (select count(*)::integer from auth.sessions session join live_user on live_user.id=session.user_id where session.id=$4::uuid and (session.not_after is null or session.not_after>now())) token_session_matches,
      (select count(*)::integer from public.profiles where id=$1::uuid and active) profiles,
      (select count(*)::integer from membership) memberships,
      (select count(*)::integer from roles where key=$3 and name=case $3 when 'owner' then 'Owner' when 'admin' then 'Admin' end and is_system) expected_roles,
      (select count(*)::integer from roles) assigned_roles,
      (select count(*)::integer from roles where key='client' or name='Client') client_roles
  `, [userId, organizationId, expectedRole, tokenSessionId, email]);
  return { users: row.users, emailIdentities: row.email_identities, liveSessions: row.live_sessions, tokenSessionMatches: row.token_session_matches, profiles: row.profiles, memberships: row.memberships, expectedRoles: row.expected_roles, assignedRoles: row.assigned_roles, clientRoles: row.client_roles };
}

async function collectSnapshot(client: Client, tokens: { owner: VerifiedToken; demo: VerifiedToken }): Promise<D4Snapshot> {
  const migrations = await client.query<{ version: string; name: string }>('select version,name from supabase_migrations.schema_migrations order by version');
  const organizations = await client.query<{ id: string; slug: string; status: string }>('select id,slug,status from public.organizations order by slug');
  const permissions = await client.query<{ key: string }>('select key from public.permissions order by key');
  const roles = await client.query<{ organization_id: string; key: string; name: string; is_system: boolean; permissions: string[] }>(`
    select role.organization_id,role.key,role.name,role.is_system,coalesce(array_agg(mapping.permission_key order by mapping.permission_key) filter(where mapping.permission_key is not null),'{}'::text[]) permissions
    from public.organization_roles role left join public.organization_role_permissions mapping on mapping.organization_id=role.organization_id and mapping.organization_role_id=role.id
    group by role.organization_id,role.id,role.key,role.name,role.is_system order by role.organization_id,role.key
  `);
  const authority = await one<{ client_assignments: number; mixed_assignments: number; malformed_permissions: number; orphan_mappings: number; platform_admins: number }>(client, `
    select
      (select count(*)::integer from public.organization_member_roles mr join public.organization_roles role on role.id=mr.organization_role_id and role.organization_id=mr.organization_id where role.key='client') client_assignments,
      (select count(*)::integer from public.organization_members member where exists(select 1 from public.organization_member_roles mr join public.organization_roles role on role.id=mr.organization_role_id and role.organization_id=mr.organization_id where mr.organization_member_id=member.id and mr.organization_id=member.organization_id and role.key='client') and exists(select 1 from public.organization_member_roles mr join public.organization_roles role on role.id=mr.organization_role_id and role.organization_id=mr.organization_id where mr.organization_member_id=member.id and mr.organization_id=member.organization_id and role.key<>'client')) mixed_assignments,
      (select count(*)::integer from public.permissions where key is null or btrim(key)='' or key<>btrim(key) or key<>lower(key)) malformed_permissions,
      (select count(*)::integer from public.organization_role_permissions mapping left join public.organization_roles role on role.id=mapping.organization_role_id and role.organization_id=mapping.organization_id left join public.permissions permission on permission.key=mapping.permission_key where role.id is null or permission.key is null) orphan_mappings,
      (select count(*)::integer from public.platform_admins) platform_admins
  `);
  const domain = { total: 0, demo: 0, purplelok: 0, nullOwned: 0, orphaned: 0 };
  for (const table of DOMAIN_TABLES) {
    const row = await one<{ total: number; demo: number; purplelok: number; null_owned: number; orphaned: number }>(client, `select count(*)::integer total,count(*) filter(where record.organization_id='${DEMO_ID}')::integer demo,count(*) filter(where record.organization_id='${PURPLELOK_ID}')::integer purplelok,count(*) filter(where record.organization_id is null)::integer null_owned,count(*) filter(where record.organization_id is not null and organization.id is null)::integer orphaned from public.${table} record left join public.organizations organization on organization.id=record.organization_id`);
    domain.total += row.total; domain.demo += row.demo; domain.purplelok += row.purplelok; domain.nullOwned += row.null_owned; domain.orphaned += row.orphaned;
  }
  const fk = await one<{ valid: number; invalid: number }>(client, `select count(*) filter(where constraint_row.convalidated)::integer valid,count(*) filter(where not constraint_row.convalidated)::integer invalid from pg_catalog.pg_constraint constraint_row where constraint_row.contype='f' and constraint_row.conname=any($1::text[])`, [TENANT_FKS]);
  const mismatches = await one<{ count: number }>(client, `select (
    (select count(*) from public.client_contacts c join public.clients p on p.id=c.client_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.client_notes c join public.clients p on p.id=c.client_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.leads c join public.clients p on p.id=c.client_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.quotes c join public.clients p on p.id=c.client_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.quote_items c join public.quotes p on p.id=c.quote_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.invoices c join public.clients p on p.id=c.client_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.invoices c join public.quotes p on p.id=c.quote_id where c.quote_id is not null and c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.invoice_items c join public.invoices p on p.id=c.invoice_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.payments c join public.invoices p on p.id=c.invoice_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.payments c join public.clients p on p.id=c.client_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.projects c join public.clients p on p.id=c.client_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.project_milestones c join public.projects p on p.id=c.project_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.tasks c join public.projects p on p.id=c.project_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.tasks c join public.clients p on p.id=c.client_id where c.client_id is not null and c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.task_comments c join public.tasks p on p.id=c.task_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.meetings c join public.projects p on p.id=c.project_id where c.project_id is not null and c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.meetings c join public.clients p on p.id=c.client_id where c.client_id is not null and c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.documents c join public.documents p on p.id=c.folder_id where c.folder_id is not null and c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.documents c join public.clients p on p.id=c.client_id where c.client_id is not null and c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.tickets c join public.clients p on p.id=c.client_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.ticket_messages c join public.tickets p on p.id=c.ticket_id where c.organization_id is distinct from p.organization_id)+
    (select count(*) from public.messages c join public.channels p on p.id=c.channel_id where c.organization_id is distinct from p.organization_id)
  )::integer count`);
  const policy = await one<{ count: number; hash: string; d3_named: number }>(client, `select count(*)::integer count,md5(string_agg(format('%s|%s|%s|%s|%s|%s|%s',schemaname,tablename,policyname,permissive,roles::text,cmd,coalesce(qual,'')||'|'||coalesce(with_check,'')),E'\\n' order by schemaname,tablename,policyname)) hash,count(*) filter(where policyname like 'domain\\_%' escape '\\')::integer d3_named from pg_catalog.pg_policies where schemaname='public' and tablename=any($1::text[])`, [DOMAIN_TABLES]);
  const rls = await client.query<{ name: string; enabled: boolean; forced: boolean; owner: string }>(`select relation.relname name,relation.relrowsecurity enabled,relation.relforcerowsecurity forced,pg_catalog.pg_get_userbyid(relation.relowner) owner from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace where namespace.nspname='public' and relation.relkind='r' and relation.relname=any($1::text[]) order by relation.relname`, [DOMAIN_TABLES]);
  const gates = await one<{ total: number; recovery_pending: number }>(client, `select count(*)::integer total,count(*) filter(where gate_type='RECOVERY_PENDING')::integer recovery_pending from private.auth_session_gates`);
  const d1Helpers = await functionSnapshots(client, D1_HELPERS.map(([signature]) => signature.slice('private.'.length, signature.indexOf('('))));
  const d2Functions = await functionSnapshots(client, D2_FUNCTIONS.map((signature) => signature.slice('private.'.length, signature.indexOf('('))));
  const d3Functions = await functionSnapshots(client, D3_FUNCTIONS.map(([signature]) => signature.slice('private.'.length, signature.indexOf('('))));
  const d4Functions = await functionSnapshots(client, D4_FUNCTIONS.map(([signature]) => signature.slice(signature.indexOf('.') + 1, signature.indexOf('('))));
  const triggerNames = [...D2_TRIGGERS.map(([name]) => name), ...DOMAIN_TABLES.map((table) => `domain_${table}_protect_update`), 'payments_require_protected_workflow'];
  const triggers = await client.query<{ name: string; table_name: string; function_schema: string; function_name: string; enabled: string; type: number; internal: boolean }>(`select trigger.tgname name,relation.relname table_name,function_namespace.nspname function_schema,procedure.proname function_name,trigger.tgenabled enabled,trigger.tgtype::integer type,trigger.tgisinternal internal from pg_catalog.pg_trigger trigger join pg_catalog.pg_class relation on relation.oid=trigger.tgrelid join pg_catalog.pg_namespace table_namespace on table_namespace.oid=relation.relnamespace join pg_catalog.pg_proc procedure on procedure.oid=trigger.tgfoid join pg_catalog.pg_namespace function_namespace on function_namespace.oid=procedure.pronamespace where table_namespace.nspname='public' and trigger.tgname=any($1::text[]) order by trigger.tgname`, [triggerNames]);
  const triggerRows = triggers.rows.map((trigger) => ({ name: trigger.name, table: trigger.table_name, functionSchema: trigger.function_schema, functionName: trigger.function_name, enabled: trigger.enabled, type: trigger.type, internal: trigger.internal }));
  const d4Schema = await one<{ indexes: number; project_column: number; tenant_foreign_key: number; project_source_quote_values: number }>(client, `with expected_index(index_name,table_name,columns,predicate) as(values
      ('invoices_quote_id_unique','invoices',array['quote_id']::text[],'(quote_idISNOTNULL)'),
      ('payments_invoice_reference_unique','payments',array['invoice_id','reference']::text[],'((referenceISNOTNULL)AND(btrim(reference)<>''''::text))'),
      ('projects_source_quote_id_unique','projects',array['source_quote_id']::text[],'(source_quote_idISNOTNULL)'))
    select (select count(*)::integer from expected_index expected join pg_catalog.pg_class index_relation on index_relation.relname=expected.index_name join pg_catalog.pg_namespace index_namespace on index_namespace.oid=index_relation.relnamespace and index_namespace.nspname='public' join pg_catalog.pg_index index_definition on index_definition.indexrelid=index_relation.oid join pg_catalog.pg_class table_relation on table_relation.oid=index_definition.indrelid and table_relation.relname=expected.table_name join pg_catalog.pg_namespace table_namespace on table_namespace.oid=table_relation.relnamespace and table_namespace.nspname='public' where index_definition.indisunique and index_definition.indisvalid and index_definition.indisready
      and array(select attribute.attname from pg_catalog.pg_attribute attribute where attribute.attrelid=index_definition.indrelid and attribute.attnum=any(index_definition.indkey) order by pg_catalog.array_position(index_definition.indkey,attribute.attnum))=expected.columns
      and pg_catalog.regexp_replace(pg_catalog.pg_get_expr(index_definition.indpred,index_definition.indrelid),'[[:space:]]','','g')=expected.predicate) indexes,
    (select count(*)::integer from information_schema.columns where table_schema='public' and table_name='projects' and column_name='source_quote_id' and data_type='uuid' and is_nullable='YES' and column_default is null) project_column,
    (select count(*)::integer from pg_catalog.pg_constraint constraint_row where constraint_row.conname='projects_source_quote_organization_fkey' and constraint_row.conrelid='public.projects'::regclass and constraint_row.confrelid='public.quotes'::regclass and constraint_row.contype='f' and constraint_row.convalidated and constraint_row.confdeltype='r' and constraint_row.confupdtype='a'
      and array(select attribute.attname from pg_catalog.pg_attribute attribute where attribute.attrelid=constraint_row.conrelid and attribute.attnum=any(constraint_row.conkey) order by pg_catalog.array_position(constraint_row.conkey,attribute.attnum))=array['source_quote_id','organization_id']
      and array(select attribute.attname from pg_catalog.pg_attribute attribute where attribute.attrelid=constraint_row.confrelid and attribute.attnum=any(constraint_row.confkey) order by pg_catalog.array_position(constraint_row.confkey,attribute.attnum))=array['id','organization_id']) tenant_foreign_key,
    (select count(*)::integer from public.projects project where pg_catalog.to_jsonb(project)->>'source_quote_id' is not null) project_source_quote_values`);
  const d4Preconditions = await one<{ invoice_quote_duplicates: number; payment_reference_duplicates: number }>(client, `select
    (select count(*)::integer from (select quote_id from public.invoices where quote_id is not null group by quote_id having count(*)>1) duplicate) invoice_quote_duplicates,
    (select count(*)::integer from (select invoice_id,reference from public.payments where reference is not null and pg_catalog.btrim(reference)<>'' group by invoice_id,reference having count(*)>1) duplicate) payment_reference_duplicates`);
  return {
    migrations: migrations.rows.map(({ version, name }) => [version, name]), organizations: organizations.rows,
    permissionKeys: permissions.rows.map(({ key }) => key), roles: roles.rows.map((role) => ({ organizationId: role.organization_id, key: role.key, name: role.name, isSystem: role.is_system, permissions: role.permissions })),
    authority: { clientAssignments: authority.client_assignments, mixedAssignments: authority.mixed_assignments, malformedPermissions: authority.malformed_permissions, orphanMappings: authority.orphan_mappings, platformAdmins: authority.platform_admins },
    domain, tenantIntegrity: { validForeignKeys: fk.valid, invalidForeignKeys: fk.invalid, childMismatches: mismatches.count }, policy: { count: policy.count, hash: policy.hash, d3Named: policy.d3_named }, rls: rls.rows,
    owner: await identitySnapshot(client, OWNER_ID, 'siyamyataza11@gmail.com', PURPLELOK_ID, 'owner', tokens.owner.sessionId), demoAdmin: await identitySnapshot(client, DEMO_ADMIN_ID, 'admin@purplelok.com', DEMO_ID, 'admin', tokens.demo.sessionId),
    gates: { total: gates.total, recoveryPending: gates.recovery_pending }, d1Helpers, d2Functions,
    d2Triggers: triggerRows.filter(({ name }) => D2_TRIGGERS.some(([expected]) => expected === name)), d3Functions,
    d3Triggers: triggerRows.filter(({ name }) => name.startsWith('domain_')), d4Functions,
    d4Triggers: triggerRows.filter(({ name }) => name === 'payments_require_protected_workflow'),
    d4Schema: { indexes: d4Schema.indexes, projectColumn: d4Schema.project_column, tenantForeignKey: d4Schema.tenant_foreign_key, projectSourceQuoteValues: d4Schema.project_source_quote_values },
    d4Preconditions: { invoiceQuoteDuplicates: d4Preconditions.invoice_quote_duplicates, paymentReferenceDuplicates: d4Preconditions.payment_reference_duplicates },
  };
}

async function main(): Promise<void> {
  const phase = phaseFromArgs();
  let databaseUrl = directDatabaseUrl();
  const [ownerToken, demoToken] = await Promise.all([
    verifiedToken('PURPLELOK_OWNER_ACCESS_TOKEN', OWNER_ID),
    verifiedToken('PURPLELOK_DEMO_ADMIN_ACCESS_TOKEN', DEMO_ADMIN_ID),
  ]);
  const hostname = new URL(databaseUrl).hostname;
  let addresses: string[];
  try { addresses = await resolve6(hostname); } catch { throw new Error('Batch 5F-D4 contract failed: production direct hostname has no IPv6 resolution'); }
  requireCondition(addresses.length > 0, 'production direct hostname has no IPv6 address');
  const client = new Client({ connectionString: databaseUrl, application_name: `batch-5f-d4-${phase}-readonly-check` });
  try {
    await client.connect();
    const connection = await one<{ ipv6: boolean; port: number }>(client, `select pg_catalog.family(pg_catalog.inet_server_addr())=6 ipv6,pg_catalog.inet_server_port()::integer port`);
    requireCondition(connection.ipv6 && connection.port === 5432, 'runtime connection is not direct IPv6 port 5432');
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const readOnly = await one<{ value: string }>(client, `select current_setting('transaction_read_only') value`);
    requireCondition(readOnly.value === 'on', 'transaction is not read only');
    const snapshot = await collectSnapshot(client, { owner: ownerToken, demo: demoToken });
    validateD4Snapshot(snapshot, phase);
    await client.query('select public.batch_3b_assert_seed_manifest()');
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ mode: 'READ ONLY', projectRef: PROJECT_REF, phase, migrations: snapshot.migrations.length, permissions: snapshot.permissionKeys.length, policies: snapshot.policy, domain: snapshot.domain, tenantIntegrity: snapshot.tenantIntegrity, result: 'PASS' }, null, 2));
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
    console.error(error instanceof Error ? error.message : 'Batch 5F-D4 production check failed');
    process.exitCode = 1;
  });
}
