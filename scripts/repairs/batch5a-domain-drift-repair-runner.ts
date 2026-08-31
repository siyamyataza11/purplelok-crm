import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { Client, type PoolClient, type QueryResultRow } from 'pg';
import {
  CANONICAL_SEED_TIMESTAMP,
  DOMAIN_TABLES,
  LEAD_REPAIRS,
  asMicrosecondTimestamp,
  executeDomainDriftRepair,
  type ActivityFingerprint,
  type ActivityState,
  type DomainDriftRepairRepository,
  type LeadRepair,
  type LeadState,
  type ManifestDifference,
  type RepairPlan,
  type RepairSnapshot,
  type TriggerSnapshot,
} from './batch5a-domain-drift-repair.js';

type Queryable = Pick<PoolClient, 'query'>;
const PROJECT_REF = 'vkgvfllqgfleosufzwhc';
const MANIFEST_MIGRATION = 'supabase/migrations/20260828150000_batch_3b_tenant_ownership_foundation.sql';
const MANIFEST_MIGRATION_SHA256 = 'c50ec8eaf980870e88061d88cbd139be0738f9790c7caafb36b279cacab994f1';
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

function usage(): string {
  return [
    'Usage: npm run repair:batch5a-domain-drift -- [--dry-run | --apply]',
    '',
    'Dry run is the default and performs zero writes.',
    'This command can repair only the fingerprinted 2026-08-30 Batch 5A production incident.',
  ].join('\n');
}

export function parseRepairArgs(args: readonly string[]): { apply: boolean; help: boolean } {
  let apply = false;
  let dryRun = false;
  let help = false;
  for (const argument of args) {
    if (argument === '--') continue;
    if (argument === '--apply') {
      if (apply) throw new Error('--apply may be supplied only once');
      apply = true;
    } else if (argument === '--dry-run') {
      if (dryRun) throw new Error('--dry-run may be supplied only once');
      dryRun = true;
    } else if (argument === '--help') {
      help = true;
    } else {
      throw new Error(`Unknown option: ${argument}\n\n${usage()}`);
    }
  }
  if (apply && dryRun) throw new Error('--dry-run and --apply cannot be used together');
  return { apply, help };
}

function requireDatabaseUrl(): string {
  const value = process.env.SUPABASE_DB_URL?.trim();
  if (!value) throw new Error('SUPABASE_DB_URL is required; browser credentials are not accepted');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('SUPABASE_DB_URL is not a valid URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('SUPABASE_DB_URL must be a PostgreSQL URL');
  if (!parsed.hostname.includes(PROJECT_REF) && !decodeURIComponent(parsed.username).includes(PROJECT_REF)) {
    throw new Error(`SUPABASE_DB_URL does not identify the approved production project ${PROJECT_REF}`);
  }
  return value;
}

function timestampExpression(column: string): string {
  return `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

function manifestDifferenceSql(): string {
  const source = readFileSync(MANIFEST_MIGRATION, 'utf8');
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== MANIFEST_MIGRATION_SHA256) {
    throw new Error(`Batch 3B manifest source hash changed; reviewed extraction is ${MANIFEST_MIGRATION_SHA256}, found ${digest}`);
  }
  const startMarker = 'WITH expected(table_name, stable_key, material) AS (VALUES';
  const endMarker = '    differences AS (';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('Could not extract the reviewed Batch 3B manifest CTE');
  const prefix = source.slice(start, end).replaceAll('v_seeded_at', '(SELECT min(created_at) FROM public.clients)');
  return `${prefix}differences(direction, table_name, stable_key, material) AS (
    SELECT 'expected_only', table_name, stable_key, material FROM (SELECT * FROM expected EXCEPT ALL SELECT * FROM live) x
    UNION ALL
    SELECT 'live_only', table_name, stable_key, material FROM (SELECT * FROM live EXCEPT ALL SELECT * FROM expected) x
  ) SELECT direction, table_name, stable_key FROM differences ORDER BY table_name, stable_key, direction`;
}

interface OrganizationRow extends QueryResultRow { id: string; slug: string }
interface TotalRow extends QueryResultRow { total: number; demo: number; real: number; null_owned: number }
interface NullRow extends QueryResultRow { table_name: string; count: number }
interface FingerprintRow extends QueryResultRow { fingerprint: string }

class PgDomainDriftRepairRepository implements DomainDriftRepairRepository {
  constructor(private readonly db: Queryable) {}

  async organizations(): Promise<{ demoId: string; realId: string }> {
    const result = await this.db.query<OrganizationRow>(
      `select id::text, slug from public.organizations
        where (slug = 'purplelok-demo' and name = 'PURPLELOK Demo' and status = 'active')
           or (slug = 'purplelok' and name = 'PURPLELOK' and status = 'active')
        order by slug`,
    );
    const demo = result.rows.filter((row) => row.slug === 'purplelok-demo');
    const real = result.rows.filter((row) => row.slug === 'purplelok');
    if (demo.length !== 1 || real.length !== 1) throw new Error('Expected exactly one active real and Demo PURPLELOK organization');
    return { demoId: demo[0].id, realId: real[0].id };
  }

  async loadTouchLeadsTrigger(): Promise<readonly TriggerSnapshot[]> {
    const result = await this.db.query<{
      table_schema: string; table_name: string; table_oid: string; trigger_oid: string;
      trigger_name: string; enabled: string; internal: boolean; type: number;
      function_oid: string; function_schema: string; function_name: string;
      definition: string; qualification: string | null; arguments: string;
      old_table: string | null; new_table: string | null;
    }>(`select ns.nspname as table_schema, cls.relname as table_name,
               cls.oid::text as table_oid, t.oid::text as trigger_oid,
               t.tgname as trigger_name, t.tgenabled as enabled,
               t.tgisinternal as internal, t.tgtype::int as type,
               p.oid::text as function_oid, pns.nspname as function_schema,
               p.proname as function_name, pg_get_triggerdef(t.oid, false) as definition,
               pg_get_expr(t.tgqual, t.tgrelid) as qualification,
               encode(t.tgargs, 'hex') as arguments,
               t.tgoldtable as old_table, t.tgnewtable as new_table
          from pg_catalog.pg_trigger t
          join pg_catalog.pg_class cls on cls.oid = t.tgrelid
          join pg_catalog.pg_namespace ns on ns.oid = cls.relnamespace
          join pg_catalog.pg_proc p on p.oid = t.tgfoid
          join pg_catalog.pg_namespace pns on pns.oid = p.pronamespace
         where ns.nspname = 'public' and cls.relname = 'leads' and t.tgname = 'touch_leads'
         order by t.oid`);
    return result.rows.map((row) => ({
      tableSchema: row.table_schema, tableName: row.table_name, tableOid: row.table_oid,
      triggerOid: row.trigger_oid, triggerName: row.trigger_name, enabled: row.enabled,
      internal: row.internal, type: row.type, functionOid: row.function_oid,
      functionSchema: row.function_schema, functionName: row.function_name,
      definition: row.definition, qualification: row.qualification, arguments: row.arguments,
      oldTable: row.old_table, newTable: row.new_table,
    }));
  }

  async loadSnapshot(): Promise<RepairSnapshot> {
    const organizations = await this.organizations();
    const domainUnion = DOMAIN_TABLES.map((table) => `select '${table}'::text as table_name, organization_id from public.${table}`).join('\nunion all\n');
    const totals = (await this.db.query<TotalRow>(
      `with domain as (${domainUnion}) select count(*)::int as total,
         count(*) filter (where organization_id = $1::uuid)::int as demo,
         count(*) filter (where organization_id = $2::uuid)::int as real,
         count(*) filter (where organization_id is null)::int as null_owned from domain`,
      [organizations.demoId, organizations.realId],
    )).rows[0];
    const nullResult = await this.db.query<NullRow>(
      `with domain as (${domainUnion}) select table_name, count(*)::int as count
         from domain where organization_id is null group by table_name order by table_name`,
    );
    const nullRowsByTable = Object.fromEntries(DOMAIN_TABLES.map((table) => [table, 0]));
    for (const row of nullResult.rows) nullRowsByTable[row.table_name] = row.count;

    const activityResult = await this.db.query<{
      id: string; organization_id: string | null; user_id: string; type: string; entity: string;
      entity_id: string; description: string; metadata: unknown; created_at: string;
    }>(`select id::text, organization_id::text, user_id::text, type, entity,
              entity_id::text, description, metadata, ${timestampExpression('created_at')} as created_at
         from public.activities where organization_id is null order by id`);
    const activities = activityResult.rows.map<ActivityState>((row) => ({
      id: row.id, organizationId: row.organization_id, userId: row.user_id, type: row.type,
      entity: row.entity, entityId: row.entity_id, description: row.description,
      metadata: row.metadata,
      createdAt: asMicrosecondTimestamp(row.created_at, `activities.created_at for ${row.id}`),
    }));

    const leadIds = LEAD_REPAIRS.map((lead) => lead.id);
    const leadResult = await this.db.query<{
      id: string; company_name: string; organization_id: string; stage: string;
      created_at: string; updated_at: string; material: readonly unknown[];
    }>(`select l.id::text, l.company_name, l.organization_id::text, l.stage,
              ${timestampExpression('l.created_at')} as created_at,
              ${timestampExpression('l.updated_at')} as updated_at,
              jsonb_build_array(l.company_name, l.contact_name, l.email, l.phone,
                l.source, l.stage, l.lead_score, l.estimated_value,
                l.expected_closing_date::text, l.notes, l.assigned_to::text, c.company_name) as material
         from public.leads l left join public.clients c on c.id = l.client_id
        where l.id = any($1::uuid[]) order by l.id`, [leadIds]);
    const leads = leadResult.rows.map<LeadState>((row) => ({
      id: row.id, companyName: row.company_name, organizationId: row.organization_id,
      stage: row.stage,
      createdAt: asMicrosecondTimestamp(row.created_at, `leads.created_at for ${row.id}`),
      updatedAt: asMicrosecondTimestamp(row.updated_at, `leads.updated_at for ${row.id}`),
      material: row.material,
    }));

    const differences = (await this.db.query<ManifestDifference>(manifestDifferenceSql())).rows;
    const authority = await this.db.query<FingerprintRow>(`select md5(jsonb_build_object(
      'organizations', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.organizations x),
      'members', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.organization_members x),
      'roles', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.organization_roles x),
      'role_permissions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.organization_id, x.organization_role_id, x.permission_key), '[]') from public.organization_role_permissions x),
      'member_roles', (select coalesce(jsonb_agg(to_jsonb(x) order by x.organization_id, x.organization_member_id, x.organization_role_id), '[]') from public.organization_member_roles x),
      'permissions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.key), '[]') from public.permissions x),
      'platform_admins', (select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id), '[]') from public.platform_admins x),
      'profile_roles', (select coalesce(jsonb_agg(jsonb_build_array(x.id, x.role) order by x.id), '[]') from public.profiles x)
    )::text) as fingerprint`);
    const invariant = await this.db.query<{ permissions: number; platform_admins: number; client_assignments: number }>(
      `select (select count(*) from public.permissions)::int as permissions,
              (select count(*) from public.platform_admins)::int as platform_admins,
              (select count(*) from public.organization_member_roles mr join public.organization_roles r
                on r.id = mr.organization_role_id and r.organization_id = mr.organization_id where r.key = 'client')::int as client_assignments`,
    );
    const constraintResult = await this.db.query<{ count: number; valid: number }>(
      `select count(*)::int as count, count(*) filter (where convalidated)::int as valid
         from pg_catalog.pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace
          and conname = any($1::text[])`, [TENANT_FKS]);
    const triggers = await this.loadTouchLeadsTrigger();
    return {
      demoOrganizationId: organizations.demoId, realOrganizationId: organizations.realId,
      totals: { total: totals.total, demo: totals.demo, real: totals.real, nullOwned: totals.null_owned },
      nullRowsByTable, activities, leads,
      manifestDifferences: differences.map((row) => ({ direction: row.direction, tableName: row.tableName ?? (row as unknown as { table_name: string }).table_name, stableKey: row.stableKey ?? (row as unknown as { stable_key: string }).stable_key })),
      triggers, authorityFingerprint: authority.rows[0]?.fingerprint ?? '',
      permissionCount: invariant.rows[0].permissions, platformAdminCount: invariant.rows[0].platform_admins,
      clientAssignmentCount: invariant.rows[0].client_assignments,
      tenantConstraintCount: constraintResult.rows[0].count, validTenantConstraintCount: constraintResult.rows[0].valid,
    };
  }

  async disableTouchLeads(): Promise<void> { await this.db.query('alter table public.leads disable trigger touch_leads'); }
  async enableTouchLeads(): Promise<void> { await this.db.query('alter table public.leads enable trigger touch_leads'); }

  async deleteActivity(activity: ActivityFingerprint): Promise<number> {
    const result = await this.db.query(`delete from public.activities
      where id = $1::uuid and organization_id is null and type = 'lead_stage_change'
        and user_id = $2::uuid and entity = 'lead' and entity_id = $3::uuid
        and description = $4 and metadata = '{}'::jsonb and created_at = $5::timestamptz`,
      [activity.id, activity.userId, activity.entityId, activity.description, activity.createdAt]);
    return result.rowCount ?? 0;
  }

  async updateLead(repair: LeadRepair, demoOrganizationId: string): Promise<number> {
    const result = await this.db.query(`update public.leads set stage = $1, updated_at = $2::timestamptz
      where id = $3::uuid and organization_id = $4::uuid and company_name = $5
        and stage = $6 and created_at = $7::timestamptz and updated_at = $8::timestamptz`,
      [repair.canonicalStage, CANONICAL_SEED_TIMESTAMP, repair.id, demoOrganizationId,
        repair.companyName, repair.currentStage, CANONICAL_SEED_TIMESTAMP, repair.currentUpdatedAt]);
    return result.rowCount ?? 0;
  }

  async assertSeedManifest(): Promise<void> { await this.db.query('select public.batch_3b_assert_seed_manifest()'); }
}

function printPlan(plan: RepairPlan, apply: boolean): void {
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN (REPEATABLE READ READ ONLY)'}`);
  console.log(`State: ${plan.state}; pending writes: ${plan.pendingWrites}`);
  console.log('DELETE public.activities:');
  for (const activity of plan.activitiesToDelete) console.log(`- ${activity.id}`);
  console.log('UPDATE public.leads (stage and updated_at only):');
  for (const lead of plan.leadsToUpdate) console.log(`- ${lead.id} ${lead.currentStage} -> ${lead.canonicalStage}; updated_at -> ${CANONICAL_SEED_TIMESTAMP}`);
  if (plan.pendingWrites === 0) console.log('- Canonical state verified; zero changes pending.');
}

export async function runDomainDriftRepairCli(args: readonly string[]): Promise<void> {
  const options = parseRepairArgs(args);
  if (options.help) { console.log(usage()); return; }
  const client = new Client({ connectionString: requireDatabaseUrl(), application_name: 'purplelok-batch5a-domain-drift-repair-v1' });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query(options.apply ? 'begin isolation level serializable' : 'begin isolation level repeatable read read only');
    transactionOpen = true;
    await client.query("set local statement_timeout = '5min'");
    await client.query("set local lock_timeout = '10s'");
    if (options.apply) {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', ['batch5a-domain-drift-repair:v1']);
      await client.query(`lock table ${DOMAIN_TABLES.map((table) => `public.${table}`).join(', ')} in share row exclusive mode`);
    }
    const execution = await executeDomainDriftRepair(new PgDomainDriftRepairRepository(client), options.apply);
    printPlan(execution.initialPlan, options.apply);
    if (!options.apply) {
      await client.query('rollback'); transactionOpen = false;
      console.log('Dry run complete. Zero writes were attempted.');
      return;
    }
    if (!execution.finalPlan || execution.finalPlan.pendingWrites !== 0) throw new Error('Final zero-change verification was not completed');
    await client.query('commit'); transactionOpen = false;
    console.log(`Repair committed after manifest, trigger, authority, constraint, and final-state verification (${execution.writes} exact writes).`);
  } catch (error) {
    if (transactionOpen) await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
