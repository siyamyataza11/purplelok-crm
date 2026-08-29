import process from 'node:process';
import { Client, type PoolClient, type QueryResultRow } from 'pg';
import {
  executeMemberProvisioning,
  MemberProvisioningConflictError,
  normalizeMemberProvisioningRequest,
  type AuthIdentityCandidate,
  type MemberMembershipCandidate,
  type MemberOrganizationCandidate,
  type MemberProvisioningPlan,
  type MemberProvisioningRepository,
  type MemberProvisioningRequest,
  type MemberProvisioningSnapshot,
  type MemberRoleAssignmentCandidate,
  type MemberRoleCandidate,
  type ProfileIdentityCandidate,
} from './member-provisioning.js';

type Queryable = Pick<PoolClient, 'query'>;

export interface MemberProvisioningCliOptions {
  readonly apply: boolean;
  readonly help: boolean;
  readonly request: MemberProvisioningRequest | null;
}

interface AuthRow extends QueryResultRow {
  id: string;
  email: string;
  deleted: boolean;
}

interface ProfileRow extends QueryResultRow {
  id: string;
  email: string;
  full_name: string;
  active: boolean;
  profile_role: string;
}

interface OrganizationRow extends QueryResultRow {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface RoleRow extends QueryResultRow {
  id: string;
  organization_id: string;
  name: string;
  key: string;
}

interface MembershipRow extends QueryResultRow {
  id: string;
  organization_id: string;
  user_id: string;
  status: string;
  job_title: string | null;
}

interface AssignmentRow extends QueryResultRow {
  organization_id: string;
  organization_member_id: string;
  organization_role_id: string;
  role_name: string;
  role_key: string;
}

function usage(): string {
  return [
    'Usage: npm run provision:member -- --email <email> --organization <slug> --role <role> --job-title <title> [--dry-run | --apply]',
    '',
    'Dry run is the default. Only --apply permits the two narrowly scoped inserts.',
    'Client role provisioning is disabled in Batch 4D.',
  ].join('\n');
}

export function parseMemberProvisioningArgs(
  args: readonly string[],
): MemberProvisioningCliOptions {
  const values = new Map<string, string>();
  let apply = false;
  let dryRun = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--apply') {
      if (apply) throw new Error('--apply may be supplied only once');
      apply = true;
      continue;
    }
    if (argument === '--dry-run') {
      if (dryRun) throw new Error('--dry-run may be supplied only once');
      dryRun = true;
      continue;
    }
    if (argument === '--help') {
      help = true;
      continue;
    }
    if (!['--email', '--organization', '--role', '--job-title'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}\n\n${usage()}`);
    }
    if (values.has(argument)) throw new Error(`${argument} may be supplied only once`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    values.set(argument, value);
    index += 1;
  }

  if (apply && dryRun) throw new Error('--dry-run and --apply cannot be used together');
  if (help) return { apply: false, help: true, request: null };

  const missing = ['--email', '--organization', '--role', '--job-title'].filter(
    (name) => !values.has(name),
  );
  if (missing.length) throw new Error(`Missing required option(s): ${missing.join(', ')}\n\n${usage()}`);

  return {
    apply,
    help: false,
    request: normalizeMemberProvisioningRequest({
      email: values.get('--email')!,
      organizationSlug: values.get('--organization')!,
      role: values.get('--role')!,
      jobTitle: values.get('--job-title')!,
    }),
  };
}

function requireDatabaseUrl(): string {
  const value = process.env.SUPABASE_DB_URL?.trim();
  if (!value) {
    throw new Error(
      'SUPABASE_DB_URL is required. Use a server-only PostgreSQL connection string; VITE_ credentials are not accepted.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('SUPABASE_DB_URL is not a valid URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('SUPABASE_DB_URL must use the postgres:// or postgresql:// protocol');
  }
  if (!parsed.username || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new Error('SUPABASE_DB_URL is missing a database username, hostname, or database name');
  }
  return value;
}

class PgMemberProvisioningRepository implements MemberProvisioningRepository {
  constructor(private readonly db: Queryable) {}

  async loadSnapshot(request: MemberProvisioningRequest): Promise<MemberProvisioningSnapshot> {
    const authResult = await this.db.query<AuthRow>(
      `select id::text, email, deleted_at is not null as deleted
         from auth.users
        where lower(email) = lower($1)
        order by id`,
      [request.email],
    );
    const authIds = authResult.rows.map((row) => row.id);

    const profileResult = await this.db.query<ProfileRow>(
      `select id::text, email, full_name, active, role as profile_role
         from public.profiles
        where lower(email) = lower($1)
           or id = any($2::uuid[])
        order by id`,
      [request.email, authIds],
    );
    const organizationResult = await this.db.query<OrganizationRow>(
      `select id::text, name, slug, status
         from public.organizations
        where slug = $1
        order by id`,
      [request.organizationSlug],
    );
    const roleResult = await this.db.query<RoleRow>(
      `select id::text, organization_id::text, name, key
         from public.organization_roles
        where lower(name) = lower($1)
           or lower(key) = lower($1)
        order by organization_id, id`,
      [request.role],
    );

    let membershipRows: MembershipRow[] = [];
    if (authResult.rows.length === 1 && organizationResult.rows.length === 1) {
      membershipRows = (
        await this.db.query<MembershipRow>(
          `select id::text, organization_id::text, user_id::text, status, job_title
             from public.organization_members
            where organization_id = $1::uuid
              and user_id = $2::uuid
            order by id`,
          [organizationResult.rows[0].id, authResult.rows[0].id],
        )
      ).rows;
    }

    let assignmentRows: AssignmentRow[] = [];
    if (membershipRows.length > 0) {
      assignmentRows = (
        await this.db.query<AssignmentRow>(
          `select mr.organization_id::text,
                  mr.organization_member_id::text,
                  mr.organization_role_id::text,
                  r.name as role_name,
                  r.key as role_key
             from public.organization_member_roles mr
             join public.organization_roles r
               on r.id = mr.organization_role_id
              and r.organization_id = mr.organization_id
            where mr.organization_member_id = any($1::uuid[])
            order by mr.organization_member_id, mr.organization_role_id`,
          [membershipRows.map((row) => row.id)],
        )
      ).rows;
    }

    const platformResult = await this.db.query<{ count: number; fingerprint: string }>(
      `select count(*)::int as count,
              md5(coalesce(jsonb_agg(to_jsonb(pa) order by pa.user_id)::text, '[]')) as fingerprint
         from public.platform_admins pa`,
    );

    return {
      authCandidates: authResult.rows.map<AuthIdentityCandidate>((row) => ({
        id: row.id,
        email: row.email,
        deleted: row.deleted,
      })),
      profileCandidates: profileResult.rows.map<ProfileIdentityCandidate>((row) => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        active: row.active,
        profileRole: row.profile_role,
      })),
      organizationCandidates: organizationResult.rows.map<MemberOrganizationCandidate>((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
      })),
      roleCandidates: roleResult.rows.map<MemberRoleCandidate>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        key: row.key,
      })),
      membershipCandidates: membershipRows.map<MemberMembershipCandidate>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        status: row.status,
        jobTitle: row.job_title,
      })),
      roleAssignments: assignmentRows.map<MemberRoleAssignmentCandidate>((row) => ({
        organizationId: row.organization_id,
        organizationMemberId: row.organization_member_id,
        organizationRoleId: row.organization_role_id,
        roleName: row.role_name,
        roleKey: row.role_key,
      })),
      platformAdminFingerprint: platformResult.rows[0]?.fingerprint ?? '',
      platformAdminCount: platformResult.rows[0]?.count ?? 0,
    };
  }

  async createMembership(input: {
    organizationId: string;
    userId: string;
    status: 'active';
    jobTitle: string;
  }): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `insert into public.organization_members (organization_id, user_id, status, job_title)
       values ($1::uuid, $2::uuid, $3, $4)
       returning id::text`,
      [input.organizationId, input.userId, input.status, input.jobTitle],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Membership insert did not return an ID');
    return id;
  }

  async assignRole(input: {
    organizationId: string;
    organizationMemberId: string;
    organizationRoleId: string;
  }): Promise<void> {
    await this.db.query(
      `insert into public.organization_member_roles
         (organization_id, organization_member_id, organization_role_id)
       values ($1::uuid, $2::uuid, $3::uuid)`,
      [input.organizationId, input.organizationMemberId, input.organizationRoleId],
    );
  }
}

function printPlan(
  plan: MemberProvisioningPlan,
  request: MemberProvisioningRequest,
  apply: boolean,
): void {
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN (read only)'}`);
  console.log(`Identity: ${plan.identity.fullName} <${plan.identity.email}>`);
  console.log(`Organization: ${plan.organization.name} (${plan.organization.slug})`);
  console.log(`Role: ${plan.role.name} (${plan.role.key})`);
  console.log(`Job title: ${request.jobTitle}`);
  console.log(`Existing profiles.role ignored: ${plan.identity.profileRole}`);
  console.log('Platform administrator change: none');
  console.log('Planned changes:');
  console.log(`- Create active membership: ${plan.createMembership ? 'yes' : 'no'}`);
  console.log(`- Assign requested role only: ${plan.assignRole ? 'yes' : 'no'}`);
  if (!plan.hasChanges) console.log('- State is compatible; zero changes are pending.');
}

export async function runMemberProvisioningCli(args: readonly string[]): Promise<void> {
  const options = parseMemberProvisioningArgs(args);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.request) throw new Error('Member provisioning request was not resolved');

  const connectionString = requireDatabaseUrl();
  const client = new Client({
    connectionString,
    application_name: 'purplelok-member-provisioning-v1',
  });
  let transactionOpen = false;

  try {
    await client.connect();
    if (options.apply) {
      await client.query('begin isolation level serializable');
    } else {
      await client.query('begin isolation level repeatable read read only');
    }
    transactionOpen = true;
    await client.query("set local statement_timeout = '30s'");
    await client.query("set local lock_timeout = '5s'");

    if (options.apply) {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `member-provisioning:${options.request.organizationSlug}:${options.request.email}:v1`,
      ]);
    }

    const repository = new PgMemberProvisioningRepository(client);
    const execution = await executeMemberProvisioning(
      repository,
      options.request,
      options.apply,
    );
    printPlan(execution.initialPlan, options.request, options.apply);

    if (!options.apply) {
      await client.query('rollback');
      transactionOpen = false;
      console.log('Dry run complete. Zero writes were attempted. Use --apply explicitly to provision.');
      return;
    }

    if (!execution.finalPlan || execution.finalPlan.hasChanges) {
      throw new Error('Final zero-change verification was not completed');
    }
    await client.query('commit');
    transactionOpen = false;
    console.log(
      execution.writes === 0
        ? 'No-op verified; state was already compatible.'
        : `Provisioning committed and verified (${execution.writes} insert(s)).`,
    );
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('rollback');
      } catch {
        // Preserve the original error without printing connection details.
      }
    }
    if (error instanceof MemberProvisioningConflictError) throw error;
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
