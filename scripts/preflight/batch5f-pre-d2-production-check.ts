import { existsSync, readFileSync } from 'node:fs';
import { Client, type QueryResultRow } from 'pg';

const PROJECT_REF = 'vkgvfllqgfleosufzwhc';
const PURPLELOK_ID = '2f02d28b-a8f1-48cd-acbc-f47a5bcd1757';
const DEMO_ID = '9e35e50a-8a9f-4fec-b64e-13388a415e10';
const EXPECTED_POLICY_HASH = 'eb744436bf76a7cc18e32b06734b5478';

const EXPECTED_MIGRATIONS = [
  ['20260728110005', 'create_crm_schema'],
  ['20260728111045', 'seed_demo_data'],
  ['20260828120000', 'batch_1_identity_rbac_foundation'],
  ['20260828150000', 'batch_3b_tenant_ownership_foundation'],
  ['20260828170000', 'batch_4_active_organization_context'],
  ['20260829100000', 'batch_5a_tenant_data_foundation'],
  ['20260831120000', 'batch_5e_b2r_profile_authority'],
  ['20260902120000', 'batch_5f_c1_auth_session_gate'],
] as const;

const DOMAIN_TABLES = [
  'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
  'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
  'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
  'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
  'messages',
] as const;

const EXPECTED_PERMISSION_KEYS = [
  'clients.read', 'clients.write', 'documents.read', 'documents.write',
  'invoices.approve', 'invoices.read', 'invoices.write', 'leads.read',
  'leads.write', 'members.manage', 'members.read', 'payments.read',
  'payments.record', 'projects.manage', 'projects.read', 'projects.write',
  'quotes.approve', 'quotes.read', 'quotes.write', 'reports.read',
  'roles.manage', 'roles.read', 'settings.manage', 'settings.read',
  'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write',
] as const;

const EXPECTED_ROLE_MAPPINGS = new Map([
  ['owner', 28],
  ['admin', 28],
  ['finance', 13],
  ['project_manager', 12],
  ['staff', 9],
  ['client', 6],
]);

const EXPECTED_ROLE_NAMES = new Map([
  ['owner', 'Owner'],
  ['admin', 'Admin'],
  ['finance', 'Finance'],
  ['project_manager', 'Project Manager'],
  ['staff', 'Staff'],
  ['client', 'Client'],
]);

function fail(message: string): never {
  throw new Error(`Batch 5F pre-D2 preflight failed: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function loadLocalDatabaseUrl(): void {
  if (process.env.SUPABASE_DB_URL || !existsSync('.env.provisioning.local')) return;

  for (const line of readFileSync('.env.provisioning.local', 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^\s*SUPABASE_DB_URL\s*=\s*(.*)\s*$/u);
    if (!match) continue;
    process.env.SUPABASE_DB_URL = match[1].replace(/^['"]|['"]$/gu, '');
    return;
  }
}

function requireProductionDatabaseUrl(): string {
  loadLocalDatabaseUrl();
  const value = process.env.SUPABASE_DB_URL?.trim();
  assert(value, 'SUPABASE_DB_URL is required');

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail('SUPABASE_DB_URL is not a valid URL');
  }

  assert(['postgres:', 'postgresql:'].includes(parsed.protocol), 'database URL must use PostgreSQL');
  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username);
  const isDirectConnection = hostname === `db.${PROJECT_REF}.supabase.co`;
  const isPoolerConnection = hostname.endsWith('.pooler.supabase.com')
    && username === `postgres.${PROJECT_REF}`;
  assert(
    isDirectConnection || isPoolerConnection,
    `database URL does not exactly identify project ${PROJECT_REF}`,
  );
  return value;
}

async function one<T extends QueryResultRow>(client: Client, sql: string): Promise<T> {
  const result = await client.query<T>(sql);
  assert(result.rowCount === 1, 'a singleton catalogue check returned an unexpected row count');
  return result.rows[0];
}

async function main(): Promise<void> {
  const client = new Client({
    connectionString: requireProductionDatabaseUrl(),
    application_name: 'batch-5f-pre-d2-readonly-preflight',
  });

  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const readOnly = await one<{ read_only: string }>(client, "select current_setting('transaction_read_only') read_only");
    assert(readOnly.read_only === 'on', 'database transaction is not read only');

    const migrations = await client.query<{ version: string; name: string }>(
      'select version, name from supabase_migrations.schema_migrations order by version',
    );
    assert(
      JSON.stringify(migrations.rows.map(({ version, name }) => [version, name]))
        === JSON.stringify(EXPECTED_MIGRATIONS),
      'migration history is not the exact eight-migration pre-D2 baseline',
    );

    const permissions = await client.query<{ key: string }>('select key from public.permissions order by key');
    assert(
      JSON.stringify(permissions.rows.map(({ key }) => key)) === JSON.stringify(EXPECTED_PERMISSION_KEYS),
      'permission catalogue is not the exact 28-key baseline',
    );

    const organizations = await client.query<{ id: string; slug: string; status: string }>(
      'select id, slug, status from public.organizations order by slug',
    );
    assert(organizations.rowCount === 2, 'organization count is not exactly two');
    assert(
      organizations.rows.some((row) => row.id === PURPLELOK_ID && row.slug === 'purplelok' && row.status === 'active'),
      'PURPLELOK identity/status differs',
    );
    assert(
      organizations.rows.some((row) => row.id === DEMO_ID && row.slug === 'purplelok-demo' && row.status === 'active'),
      'PURPLELOK Demo identity/status differs',
    );

    const roles = await client.query<{
      organization_id: string;
      key: string;
      name: string;
      is_system: boolean;
      permission_count: number;
    }>(`
      select role.organization_id, role.key, role.name, role.is_system,
             count(mapping.permission_key)::integer permission_count
      from public.organization_roles role
      left join public.organization_role_permissions mapping
        on mapping.organization_id = role.organization_id
       and mapping.organization_role_id = role.id
      group by role.organization_id, role.id, role.key, role.name, role.is_system
      order by role.organization_id, role.key
    `);
    assert(roles.rowCount === 12, 'role count is not exactly six per organization');
    for (const organizationId of [PURPLELOK_ID, DEMO_ID]) {
      const organizationRoles = roles.rows.filter((role) => role.organization_id === organizationId);
      assert(organizationRoles.length === 6, `organization ${organizationId} lacks six roles`);
      for (const role of organizationRoles) {
        assert(role.is_system, `role ${role.key} is not a system role`);
        assert(EXPECTED_ROLE_NAMES.get(role.key) === role.name, `role ${role.key} name differs`);
        assert(EXPECTED_ROLE_MAPPINGS.get(role.key) === role.permission_count, `role ${role.key} mapping count differs`);
      }
    }

    const rbacDrift = await one<{
      duplicate_roles: number;
      client_assignments: number;
      orphan_mappings: number;
      malformed_permissions: number;
      mixed_client_internal: number;
      platform_admins: number;
    }>(client, `
      select
        (select count(*) from (
          select organization_id, key from public.organization_roles
          group by organization_id, key having count(*) > 1
        ) duplicate)::integer duplicate_roles,
        (select count(*) from public.organization_member_roles member_role
          join public.organization_roles role
            on role.id=member_role.organization_role_id
           and role.organization_id=member_role.organization_id
          where role.key='client')::integer client_assignments,
        (select count(*) from public.organization_role_permissions mapping
          left join public.organization_roles role
            on role.id=mapping.organization_role_id
           and role.organization_id=mapping.organization_id
          left join public.permissions permission on permission.key=mapping.permission_key
          where role.id is null or permission.key is null)::integer orphan_mappings,
        (select count(*) from public.permissions
          where key is null or btrim(key)='' or key<>btrim(key) or key<>lower(key))::integer malformed_permissions,
        (select count(*) from public.organization_members member
          where exists (
            select 1 from public.organization_member_roles member_role
            join public.organization_roles role
              on role.id=member_role.organization_role_id
             and role.organization_id=member_role.organization_id
            where member_role.organization_member_id=member.id
              and member_role.organization_id=member.organization_id
              and role.key='client'
          ) and exists (
            select 1 from public.organization_member_roles member_role
            join public.organization_roles role
              on role.id=member_role.organization_role_id
             and role.organization_id=member_role.organization_id
            where member_role.organization_member_id=member.id
              and member_role.organization_id=member.organization_id
              and role.key<>'client'
          ))::integer mixed_client_internal,
        (select count(*) from public.platform_admins)::integer platform_admins
    `);
    assert(Object.values(rbacDrift).every((value) => value === 0), 'RBAC drift is present');

    const domainCounts: Array<{
      table: string;
      total: number;
      demo: number;
      purplelok: number;
      null_owned: number;
      orphaned: number;
    }> = [];
    for (const table of DOMAIN_TABLES) {
      const count = await one<{ total: number; demo: number; purplelok: number; null_owned: number; orphaned: number }>(client, `
        select count(*)::integer total,
          count(*) filter (where row.organization_id='${DEMO_ID}')::integer demo,
          count(*) filter (where row.organization_id='${PURPLELOK_ID}')::integer purplelok,
          count(*) filter (where row.organization_id is null)::integer null_owned,
          count(*) filter (where row.organization_id is not null and organization.id is null)::integer orphaned
        from public.${table} row
        left join public.organizations organization on organization.id=row.organization_id
      `);
      domainCounts.push({ table, ...count });
    }
    const totals = domainCounts.reduce(
      (sum, row) => ({
        total: sum.total + row.total,
        demo: sum.demo + row.demo,
        purplelok: sum.purplelok + row.purplelok,
        nullOwned: sum.nullOwned + row.null_owned,
        orphaned: sum.orphaned + row.orphaned,
      }),
      { total: 0, demo: 0, purplelok: 0, nullOwned: 0, orphaned: 0 },
    );
    assert(
      totals.total === 88 && totals.demo === 88 && totals.purplelok === 0
        && totals.nullOwned === 0 && totals.orphaned === 0,
      'domain ownership is not 88 Demo / 0 PURPLELOK / 0 NULL / 0 orphaned',
    );

    const childRelationships = [
      ['client_contacts', 'client_id', 'clients'],
      ['client_notes', 'client_id', 'clients'],
      ['quote_items', 'quote_id', 'quotes'],
      ['invoice_items', 'invoice_id', 'invoices'],
      ['project_milestones', 'project_id', 'projects'],
      ['task_comments', 'task_id', 'tasks'],
      ['ticket_messages', 'ticket_id', 'tickets'],
      ['messages', 'channel_id', 'channels'],
    ] as const;
    for (const [child, foreignKey, parent] of childRelationships) {
      const mismatch = await one<{ count: number }>(client, `
        select count(*)::integer count from public.${child} child
        join public.${parent} parent on parent.id=child.${foreignKey}
        where child.organization_id is distinct from parent.organization_id
      `);
      assert(mismatch.count === 0, `${child} has a parent-tenant mismatch`);
    }

    const scalarAssignments = [
      ['leads', 'assigned_to'], ['tasks', 'assigned_to'],
      ['meetings', 'assigned_to'], ['tickets', 'assigned_to'],
    ] as const;
    for (const [table, column] of scalarAssignments) {
      const invalid = await one<{ count: number }>(client, `
        select count(*)::integer count from public.${table} row
        left join auth.users auth_user on auth_user.id=row.${column}
        left join public.profiles profile on profile.id=row.${column}
        left join public.organization_members member
          on member.user_id=row.${column} and member.organization_id=row.organization_id
        where row.${column} is not null and (
          auth_user.id is null or auth_user.deleted_at is not null
          or profile.id is null or not profile.active
          or member.id is null or member.status<>'active'
          or not exists (
            select 1 from public.organization_member_roles member_role
            join public.organization_roles role
              on role.id=member_role.organization_role_id
             and role.organization_id=member_role.organization_id
            where member_role.organization_member_id=member.id
              and member_role.organization_id=member.organization_id
              and role.key<>'client'
          )
        )
      `);
      assert(invalid.count === 0, `${table}.${column} has an invalid member reference`);
    }
    const invalidProjectAssignments = await one<{ count: number }>(client, `
      select count(*)::integer count from public.projects project
      cross join lateral unnest(coalesce(project.assigned_to, '{}'::uuid[])) assigned(user_id)
      left join auth.users auth_user on auth_user.id=assigned.user_id
      left join public.profiles profile on profile.id=assigned.user_id
      left join public.organization_members member
        on member.user_id=assigned.user_id and member.organization_id=project.organization_id
      where auth_user.id is null or auth_user.deleted_at is not null
         or profile.id is null or not profile.active
         or member.id is null or member.status<>'active'
         or not exists (
           select 1 from public.organization_member_roles member_role
           join public.organization_roles role
             on role.id=member_role.organization_role_id
            and role.organization_id=member_role.organization_id
           where member_role.organization_member_id=member.id
             and member_role.organization_id=member.organization_id
             and role.key<>'client'
         )
    `);
    assert(invalidProjectAssignments.count === 0, 'projects.assigned_to has an invalid member reference');

    const policies = await one<{ count: number; hash: string }>(client, `
      select count(*)::integer count,
        md5(string_agg(
          format('%s|%s|%s|%s|%s|%s|%s', schemaname, tablename,
            policyname, permissive, roles::text, cmd,
            coalesce(qual,'') || '|' || coalesce(with_check,'')),
          E'\\n' order by schemaname,tablename,policyname)) hash
      from pg_catalog.pg_policies
      where schemaname='public' and tablename=any(array[${DOMAIN_TABLES.map((table) => `'${table}'`).join(',')}])
    `);
    assert(policies.count === 84 && policies.hash === EXPECTED_POLICY_HASH, 'domain policy count/hash differs');

    const d4Data = await one<{
      invoice_quote_duplicates: boolean;
      payment_reference_duplicates: boolean;
      blank_references: number;
      nonpositive_payments: number;
      duplicate_invoice_numbers: boolean;
      blank_invoice_numbers: number;
    }>(client, `
      select
        exists(select 1 from public.invoices where quote_id is not null group by quote_id having count(*)>1)
          invoice_quote_duplicates,
        exists(select 1 from public.payments where reference is not null and btrim(reference)<>''
          group by invoice_id, reference having count(*)>1) payment_reference_duplicates,
        (select count(*) from public.payments where reference is not null and btrim(reference)='')::integer blank_references,
        (select count(*) from public.payments where amount<=0)::integer nonpositive_payments,
        exists(select 1 from public.invoices group by invoice_number having count(*)>1) duplicate_invoice_numbers,
        (select count(*) from public.invoices where invoice_number is null or btrim(invoice_number)='')::integer blank_invoice_numbers
    `);
    assert(
      !d4Data.invoice_quote_duplicates && !d4Data.payment_reference_duplicates
        && d4Data.blank_references === 0 && d4Data.nonpositive_payments === 0
        && !d4Data.duplicate_invoice_numbers && d4Data.blank_invoice_numbers === 0,
      'D4 uniqueness/data preconditions differ',
    );

    const pendingObjects = await one<{
      functions: number;
      triggers: number;
      relations: number;
      columns: number;
      policies: number;
    }>(client, `
      with pending_functions(signature) as (values
        ('private.purplelok_current_session_id()'),
        ('private.purplelok_has_normal_session()'),
        ('private.purplelok_has_active_membership(uuid)'),
        ('private.purplelok_has_permission(uuid,text)'),
        ('private.purplelok_can_access_resource(uuid,text)'),
        ('private.purplelok_protect_system_role_identity()'),
        ('private.purplelok_reject_client_role_assignment()'),
        ('private.purplelok_restrict_client_permissions()'),
        ('private.purplelok_can_reference_members(uuid,text,uuid[])'),
        ('private.purplelok_protect_domain_update()'),
        ('private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)'),
        ('private.purplelok_protect_payment_insert()'),
        ('public.record_payment(uuid,numeric,text,text)'),
        ('public.send_quote(uuid)'),
        ('public.approve_quote(uuid)'),
        ('public.convert_quote_to_invoice(uuid,text,date,date)'),
        ('public.convert_quote_to_project(uuid)'),
        ('public.change_lead_stage(uuid,text)')
      ), pending_triggers(name) as (values
        ('organization_roles_protect_system_identity'),
        ('organization_member_roles_reject_client'),
        ('organization_role_permissions_restrict_client')
      ), pending_relations(name) as (values
        ('public.invoices_quote_id_unique'),
        ('public.payments_invoice_reference_unique'),
        ('public.projects_source_quote_id_unique')
      )
      select
        (select count(*) from pending_functions where to_regprocedure(signature) is not null)::integer functions,
        (select count(*) from pg_trigger where not tgisinternal and (
          tgname in (select name from pending_triggers)
          or tgname like 'domain\\_%\\_protect\\_update' escape '\\'
        ))::integer triggers,
        (select count(*) from pending_relations where to_regclass(name) is not null)::integer relations,
        (select count(*) from information_schema.columns
          where table_schema='public' and table_name='projects'
            and column_name='source_quote_id')::integer columns,
        (select count(*) from pg_policies
          where schemaname='public' and policyname like 'domain\\_%' escape '\\')::integer policies
    `);
    assert(Object.values(pendingObjects).every((value) => value === 0), 'a D1-D4 object already exists');

    await client.query('select public.batch_3b_assert_seed_manifest()');
    await client.query('ROLLBACK');

    console.log(JSON.stringify({
      mode: 'READ ONLY',
      projectRef: PROJECT_REF,
      migrations: EXPECTED_MIGRATIONS.length,
      permissions: permissions.rowCount,
      roles: roles.rowCount,
      domain: totals,
      policies,
      clientAssignments: rbacDrift.client_assignments,
      result: 'PASS',
    }, null, 2));
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original preflight failure.
    }
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Batch 5F pre-D2 preflight failed');
  process.exitCode = 1;
});
