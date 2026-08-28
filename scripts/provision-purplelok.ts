#!/usr/bin/env node

import process from 'node:process';
import { Client, type PoolClient, type QueryResultRow } from 'pg';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  buildProvisioningPlan,
  ORGANIZATION_SPEC,
  OWNER_MEMBERSHIP_SPEC,
  PERMISSION_KEYS,
  ProvisioningConflictError,
  ROLE_SPECS,
  TARGET_OWNER_EMAIL,
  type MembershipSnapshot,
  type ProvisioningPlan,
  type ProvisioningSnapshot,
  type ResolvedIdentity,
  type RoleSnapshot,
} from './provisioning/purplelok-provisioning.js';

const LOCK_NAME = 'purplelok:first-organization-provisioning:v1';

type Queryable = Pick<PoolClient, 'query'>;

interface CliOptions {
  readonly apply: boolean;
}

interface AuthRow extends QueryResultRow {
  id: string;
  email: string;
}

interface ProfileRow extends QueryResultRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  active: boolean;
}

interface OrganizationRow extends QueryResultRow {
  id: string;
  name: string;
  slug: string | null;
  status: string;
}

interface RoleRow extends QueryResultRow {
  id: string;
  name: string;
  key: string;
  is_system: boolean;
  permission_keys: string[];
}

interface MembershipRow extends QueryResultRow {
  id: string;
  status: string;
  job_title: string | null;
  role_keys: string[];
}

function usage(): string {
  return [
    'Usage: npm run provision:purplelok -- [--dry-run | --apply]',
    '',
    'No flag and --dry-run both perform a read-only inspection.',
    '--apply is the only mode that can write provisioning data.',
  ].join('\n');
}

function parseOptions(args: readonly string[]): CliOptions {
  const allowed = new Set(['--dry-run', '--apply', '--help']);
  const unknown = args.filter((arg) => !allowed.has(arg));
  if (unknown.length) {
    throw new Error(`Unknown option(s): ${unknown.join(', ')}\n\n${usage()}`);
  }
  if (args.includes('--help')) {
    console.log(usage());
    process.exit(0);
  }
  if (args.includes('--dry-run') && args.includes('--apply')) {
    throw new Error('--dry-run and --apply cannot be used together');
  }
  return { apply: args.includes('--apply') };
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

async function resolveIdentity(db: Queryable, email: string): Promise<ResolvedIdentity> {
  const authResult = await db.query<AuthRow>(
    `select id::text, email
       from auth.users
      where email = $1`,
    [email],
  );
  if (authResult.rowCount !== 1) {
    throw new ProvisioningConflictError(
      `Expected exactly one auth.users identity for ${email}; found ${authResult.rowCount ?? 0}`,
    );
  }

  const authUser = authResult.rows[0];
  const profileResult = await db.query<ProfileRow>(
    `select id::text, email, full_name, role, active
       from public.profiles
      where id = $1::uuid or email = $2`,
    [authUser.id, email],
  );
  if (profileResult.rowCount !== 1) {
    throw new ProvisioningConflictError(
      `Expected exactly one matching profile identity for ${email}; found ${profileResult.rowCount ?? 0}`,
    );
  }

  const profile = profileResult.rows[0];
  if (profile.id !== authUser.id || profile.email !== authUser.email || profile.email !== email) {
    throw new ProvisioningConflictError(`auth.users/profile identity mismatch for ${email}`);
  }

  return {
    id: authUser.id,
    email: authUser.email,
    fullName: profile.full_name,
    profileRole: profile.role,
    active: profile.active,
  };
}

async function loadSnapshot(db: Queryable): Promise<ProvisioningSnapshot> {
  const owner = await resolveIdentity(db, TARGET_OWNER_EMAIL);
  const bootstrapAdmin = await resolveIdentity(db, BOOTSTRAP_ADMIN_EMAIL);

  const permissionResult = await db.query<{ key: string }>(
    'select key from public.permissions order by key',
  );
  const organizationResult = await db.query<OrganizationRow>(
    `select id::text, name, slug, status
       from public.organizations
      where slug = $1 or name = $2
      order by id`,
    [ORGANIZATION_SPEC.slug, ORGANIZATION_SPEC.name],
  );

  const exactOrganization =
    organizationResult.rows.find((organization) => organization.slug === ORGANIZATION_SPEC.slug) ??
    null;

  let roles: RoleSnapshot[] = [];
  let ownerMembership: MembershipSnapshot | null = null;
  let clientRoleAssignmentCount = 0;

  if (exactOrganization) {
    const roleResult = await db.query<RoleRow>(
      `select r.id::text,
              r.name,
              r.key,
              r.is_system,
              coalesce(
                array_agg(rp.permission_key order by rp.permission_key)
                  filter (where rp.permission_key is not null),
                '{}'::text[]
              ) as permission_keys
         from public.organization_roles r
         left join public.organization_role_permissions rp
           on rp.organization_role_id = r.id
          and rp.organization_id = r.organization_id
        where r.organization_id = $1::uuid
        group by r.id, r.name, r.key, r.is_system
        order by r.key`,
      [exactOrganization.id],
    );
    roles = roleResult.rows.map((role) => ({
      id: role.id,
      name: role.name,
      key: role.key,
      isSystem: role.is_system,
      permissionKeys: role.permission_keys,
    }));

    const membershipResult = await db.query<MembershipRow>(
      `select m.id::text,
              m.status,
              m.job_title,
              coalesce(
                array_agg(r.key order by r.key) filter (where r.key is not null),
                '{}'::text[]
              ) as role_keys
         from public.organization_members m
         left join public.organization_member_roles mr
           on mr.organization_member_id = m.id
          and mr.organization_id = m.organization_id
         left join public.organization_roles r
           on r.id = mr.organization_role_id
          and r.organization_id = mr.organization_id
        where m.organization_id = $1::uuid
          and m.user_id = $2::uuid
        group by m.id, m.status, m.job_title`,
      [exactOrganization.id, owner.id],
    );
    if ((membershipResult.rowCount ?? 0) > 1) {
      throw new ProvisioningConflictError('Multiple PURPLELOK memberships exist for the owner');
    }
    const membership = membershipResult.rows[0];
    if (membership) {
      ownerMembership = {
        id: membership.id,
        status: membership.status,
        jobTitle: membership.job_title,
        roleKeys: membership.role_keys,
      };
    }

    const clientAssignments = await db.query<{ count: number }>(
      `select count(*)::int as count
         from public.organization_member_roles mr
         join public.organization_roles r
           on r.id = mr.organization_role_id
          and r.organization_id = mr.organization_id
        where r.organization_id = $1::uuid
          and r.key = 'client'`,
      [exactOrganization.id],
    );
    clientRoleAssignmentCount = clientAssignments.rows[0]?.count ?? 0;
  }

  const bootstrapMembershipResult = await db.query<{ count: number }>(
    `select count(*)::int as count
       from public.organization_members
      where user_id = $1::uuid`,
    [bootstrapAdmin.id],
  );
  const platformAdminResult = await db.query<{ count: number }>(
    'select count(*)::int as count from public.platform_admins',
  );

  return {
    owner,
    bootstrapAdmin,
    permissionKeys: permissionResult.rows.map((row) => row.key),
    organizationCandidates: organizationResult.rows.map((organization) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
    })),
    roles,
    ownerMembership,
    bootstrapMembershipCount: bootstrapMembershipResult.rows[0]?.count ?? 0,
    platformAdminCount: platformAdminResult.rows[0]?.count ?? 0,
    clientRoleAssignmentCount,
  };
}

function printPlan(snapshot: ProvisioningSnapshot, plan: ProvisioningPlan, apply: boolean): void {
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN (read only)'}`);
  console.log('');
  console.log(`Organization: ${ORGANIZATION_SPEC.name} (${ORGANIZATION_SPEC.slug})`);
  console.log(`Owner: ${snapshot.owner.fullName} <${snapshot.owner.email}>`);
  console.log(
    `Membership: ${OWNER_MEMBERSHIP_SPEC.status} / ${OWNER_MEMBERSHIP_SPEC.jobTitle}`,
  );
  console.log('Role: Owner');
  console.log('Platform admin: No');
  console.log('Bootstrap admin modified: No');
  console.log('Client role assigned: No');
  console.log(`Existing profiles.role ignored: ${snapshot.owner.profileRole}`);
  console.log('');
  console.log('Planned changes:');
  console.log(`- Create organization: ${plan.createOrganization ? 'yes' : 'no'}`);
  console.log(
    `- Create roles: ${plan.rolesToCreate.length ? plan.rolesToCreate.map((role) => role.name).join(', ') : 'none'}`,
  );
  const permissionCount = plan.permissionAdditions.reduce(
    (total, addition) => total + addition.permissionKeys.length,
    0,
  );
  console.log(`- Add role-permission mappings: ${permissionCount}`);
  console.log(`- Create owner membership: ${plan.createOwnerMembership ? 'yes' : 'no'}`);
  console.log(`- Assign Owner role: ${plan.assignOwnerRole ? 'yes' : 'no'}`);
  if (!plan.hasChanges) console.log('- State is already fully provisioned; no writes are needed.');
  console.log('');
  console.log(
    'Security note: the Client role is intentionally unassigned and is not production-safe until client-specific row-level scope exists.',
  );
}

async function applyPlan(
  db: Queryable,
  snapshot: ProvisioningSnapshot,
  plan: ProvisioningPlan,
): Promise<void> {
  let organizationId = plan.organization?.id;
  if (plan.createOrganization) {
    const result = await db.query<{ id: string }>(
      `insert into public.organizations (name, slug, status)
       values ($1, $2, $3)
       returning id::text`,
      [ORGANIZATION_SPEC.name, ORGANIZATION_SPEC.slug, ORGANIZATION_SPEC.status],
    );
    organizationId = result.rows[0]?.id;
  }
  if (!organizationId) throw new Error('Unable to resolve the PURPLELOK organization ID');

  const roleIds = new Map(snapshot.roles.map((role) => [role.key, role.id]));
  for (const role of plan.rolesToCreate) {
    const result = await db.query<{ id: string }>(
      `insert into public.organization_roles (organization_id, name, key, is_system)
       values ($1::uuid, $2, $3, $4)
       returning id::text`,
      [organizationId, role.name, role.key, role.isSystem],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error(`Unable to create role ${role.name}`);
    roleIds.set(role.key, id);
  }

  for (const addition of plan.permissionAdditions) {
    const roleId = roleIds.get(addition.roleKey);
    if (!roleId) throw new Error(`Unable to resolve role ID for ${addition.roleKey}`);
    for (const permissionKey of addition.permissionKeys) {
      await db.query(
        `insert into public.organization_role_permissions
           (organization_id, organization_role_id, permission_key)
         values ($1::uuid, $2::uuid, $3)`,
        [organizationId, roleId, permissionKey],
      );
    }
  }

  let membershipId = snapshot.ownerMembership?.id;
  if (plan.createOwnerMembership) {
    const result = await db.query<{ id: string }>(
      `insert into public.organization_members
         (organization_id, user_id, status, job_title)
       values ($1::uuid, $2::uuid, $3, $4)
       returning id::text`,
      [
        organizationId,
        snapshot.owner.id,
        OWNER_MEMBERSHIP_SPEC.status,
        OWNER_MEMBERSHIP_SPEC.jobTitle,
      ],
    );
    membershipId = result.rows[0]?.id;
  }

  if (plan.assignOwnerRole) {
    const ownerRoleId = roleIds.get('owner');
    if (!membershipId || !ownerRoleId) {
      throw new Error('Unable to resolve the owner membership or Owner role ID');
    }
    await db.query(
      `insert into public.organization_member_roles
         (organization_id, organization_member_id, organization_role_id)
       values ($1::uuid, $2::uuid, $3::uuid)`,
      [organizationId, membershipId, ownerRoleId],
    );
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const connectionString = requireDatabaseUrl();
  const client = new Client({
    connectionString,
    application_name: 'purplelok-provisioning-v1',
  });
  let transactionOpen = false;

  try {
    await client.connect();
    if (options.apply) {
      await client.query('begin isolation level serializable');
      transactionOpen = true;
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [LOCK_NAME]);
    } else {
      await client.query('begin isolation level repeatable read read only');
      transactionOpen = true;
    }
    await client.query("set local statement_timeout = '30s'");
    await client.query("set local lock_timeout = '5s'");

    const snapshot = await loadSnapshot(client);
    const plan = buildProvisioningPlan(snapshot);
    printPlan(snapshot, plan, options.apply);

    if (!options.apply) {
      await client.query('rollback');
      transactionOpen = false;
      console.log('Dry run complete. Zero writes were attempted. Use --apply explicitly to provision.');
      return;
    }

    if (plan.hasChanges) await applyPlan(client, snapshot, plan);

    const verifiedSnapshot = await loadSnapshot(client);
    const verificationPlan = buildProvisioningPlan(verifiedSnapshot);
    if (verificationPlan.hasChanges) {
      throw new Error('Post-provisioning verification found an incomplete target state');
    }
    const ownerRole = verifiedSnapshot.roles.find((role) => role.key === 'owner');
    if (!ownerRole || ownerRole.permissionKeys.length !== PERMISSION_KEYS.length) {
      throw new Error('Post-provisioning verification failed: Owner does not have 28 permissions');
    }
    if (verifiedSnapshot.roles.length < ROLE_SPECS.length) {
      throw new Error('Post-provisioning verification failed: expected system roles are missing');
    }

    await client.query('commit');
    transactionOpen = false;
    console.log(plan.hasChanges ? 'Provisioning committed and verified.' : 'No-op verified; state was already provisioned.');
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('rollback');
      } catch {
        // Preserve the original failure without printing connection details.
      }
    }
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown provisioning failure';
  console.error(`Provisioning aborted: ${message}`);
  process.exitCode = 1;
});
