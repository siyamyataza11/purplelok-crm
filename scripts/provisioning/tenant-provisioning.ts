export const PERMISSION_KEYS = [
  'members.read',
  'members.manage',
  'roles.read',
  'roles.manage',
  'clients.read',
  'clients.write',
  'leads.read',
  'leads.write',
  'projects.read',
  'projects.write',
  'projects.manage',
  'tasks.read',
  'tasks.write',
  'quotes.read',
  'quotes.write',
  'quotes.approve',
  'invoices.read',
  'invoices.write',
  'invoices.approve',
  'payments.read',
  'payments.record',
  'documents.read',
  'documents.write',
  'tickets.read',
  'tickets.write',
  'reports.read',
  'settings.read',
  'settings.manage',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export interface RoleSpec {
  readonly name: string;
  readonly key: string;
  readonly isSystem: true;
  readonly permissions: readonly PermissionKey[];
}

export const ROLE_SPECS: readonly RoleSpec[] = [
  { name: 'Owner', key: 'owner', isSystem: true, permissions: PERMISSION_KEYS },
  {
    name: 'Admin',
    key: 'admin',
    isSystem: true,
    // Owner-specific lifecycle and billing capabilities may differentiate the
    // roles later. The current approved matrix grants both the full catalogue.
    permissions: PERMISSION_KEYS,
  },
  {
    name: 'Finance',
    key: 'finance',
    isSystem: true,
    permissions: [
      'clients.read',
      'projects.read',
      'quotes.read',
      'quotes.write',
      'quotes.approve',
      'invoices.read',
      'invoices.write',
      'invoices.approve',
      'payments.read',
      'payments.record',
      'documents.read',
      'reports.read',
      'settings.read',
    ],
  },
  {
    name: 'Project Manager',
    key: 'project_manager',
    isSystem: true,
    permissions: [
      'clients.read',
      'projects.read',
      'projects.write',
      'projects.manage',
      'tasks.read',
      'tasks.write',
      'documents.read',
      'documents.write',
      'tickets.read',
      'tickets.write',
      'reports.read',
      'settings.read',
    ],
  },
  {
    name: 'Staff',
    key: 'staff',
    isSystem: true,
    permissions: [
      'clients.read',
      'projects.read',
      'tasks.read',
      'tasks.write',
      'documents.read',
      'documents.write',
      'tickets.read',
      'tickets.write',
      'settings.read',
    ],
  },
  {
    name: 'Client',
    key: 'client',
    isSystem: true,
    permissions: [
      'projects.read',
      'documents.read',
      'quotes.read',
      'invoices.read',
      'tickets.read',
      'tickets.write',
    ],
  },
] as const;

export interface TenantProvisioningSpec {
  readonly key: string;
  readonly commandName: string;
  readonly applicationName: string;
  readonly organization: {
    readonly name: string;
    readonly slug: string;
    readonly status: 'active';
  };
  readonly member: {
    readonly email: string;
    readonly status: 'active';
    readonly jobTitle: string;
    readonly roleKey: string;
    readonly forbiddenOrganizationSlugs: readonly string[];
  };
  readonly protectedUsers: readonly {
    readonly email: string;
    readonly mustNotBeMember: boolean;
  }[];
  readonly security: {
    readonly requirePlatformAdminsEmpty: boolean;
    readonly requireClientRoleUnassigned: boolean;
  };
}

export interface ResolvedIdentity {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly profileRole: string;
  readonly active: boolean;
}

export interface OrganizationSnapshot {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly status: string;
}

export interface RoleSnapshot {
  readonly id: string;
  readonly name: string;
  readonly key: string;
  readonly isSystem: boolean;
  readonly permissionKeys: readonly string[];
}

export interface MembershipSnapshot {
  readonly id: string;
  readonly status: string;
  readonly jobTitle: string | null;
  readonly roleKeys: readonly string[];
}

export interface ProtectedIdentitySnapshot {
  readonly identity: ResolvedIdentity;
  readonly targetOrganizationMembershipCount: number;
}

export interface ForbiddenMembershipSnapshot {
  readonly organizationSlug: string;
  readonly membershipCount: number;
}

export interface ProvisioningSnapshot {
  readonly member: ResolvedIdentity;
  readonly protectedUsers: readonly ProtectedIdentitySnapshot[];
  readonly memberForbiddenMemberships: readonly ForbiddenMembershipSnapshot[];
  readonly permissionKeys: readonly string[];
  readonly organizationCandidates: readonly OrganizationSnapshot[];
  readonly roles: readonly RoleSnapshot[];
  readonly memberMembership: MembershipSnapshot | null;
  readonly platformAdminCount: number;
  readonly clientRoleAssignmentCount: number;
}

export interface PermissionAdditions {
  readonly roleKey: string;
  readonly permissionKeys: readonly PermissionKey[];
}

export interface ProvisioningPlan {
  readonly organization: OrganizationSnapshot | null;
  readonly createOrganization: boolean;
  readonly rolesToCreate: readonly RoleSpec[];
  readonly permissionAdditions: readonly PermissionAdditions[];
  readonly createMemberMembership: boolean;
  readonly assignMemberRole: boolean;
  readonly hasChanges: boolean;
}

export class ProvisioningConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisioningConflictError';
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function setDifference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return sortedUnique(left).filter((value) => !rightSet.has(value));
}

function assertExactSet(
  label: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  const missing = setDifference(expected, actual);
  const unexpected = setDifference(actual, expected);
  if (!missing.length && !unexpected.length) return;

  const details = [
    missing.length ? `missing: ${missing.join(', ')}` : null,
    unexpected.length ? `unexpected: ${unexpected.join(', ')}` : null,
  ].filter(Boolean);
  throw new ProvisioningConflictError(`${label} conflict (${details.join('; ')})`);
}

export function validateTenantProvisioningSpec(spec: TenantProvisioningSpec): void {
  if (!spec.organization.name.trim()) throw new Error('Organization name must not be blank');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.organization.slug)) {
    throw new Error(`Invalid organization slug: ${spec.organization.slug}`);
  }
  if (!spec.member.jobTitle.trim()) throw new Error('Member job title must not be blank');
  if (!ROLE_SPECS.some((role) => role.key === spec.member.roleKey)) {
    throw new Error(`Unknown assigned role key: ${spec.member.roleKey}`);
  }
  if (spec.protectedUsers.some((user) => user.email === spec.member.email)) {
    throw new Error('The target member cannot also be a protected user');
  }
  if (new Set(spec.protectedUsers.map((user) => user.email)).size !== spec.protectedUsers.length) {
    throw new Error('Protected user emails must be unique');
  }
  if (
    new Set(spec.member.forbiddenOrganizationSlugs).size !==
    spec.member.forbiddenOrganizationSlugs.length
  ) {
    throw new Error('Forbidden organization slugs must be unique');
  }
}

export function buildTenantProvisioningPlan(
  spec: TenantProvisioningSpec,
  snapshot: ProvisioningSnapshot,
): ProvisioningPlan {
  validateTenantProvisioningSpec(spec);

  if (snapshot.member.email !== spec.member.email) {
    throw new ProvisioningConflictError(
      `Resolved member email is ${snapshot.member.email}, expected ${spec.member.email}`,
    );
  }
  if (!snapshot.member.active) {
    throw new ProvisioningConflictError(`Required member profile is inactive: ${spec.member.email}`);
  }

  const expectedProtectedEmails = spec.protectedUsers.map((user) => user.email);
  assertExactSet(
    'Protected identity snapshot',
    snapshot.protectedUsers.map((user) => user.identity.email),
    expectedProtectedEmails,
  );
  const identityIds = [snapshot.member.id, ...snapshot.protectedUsers.map((user) => user.identity.id)];
  if (new Set(identityIds).size !== identityIds.length) {
    throw new ProvisioningConflictError('Required identities resolve to overlapping user IDs');
  }
  for (const protectedSpec of spec.protectedUsers) {
    const protectedSnapshot = snapshot.protectedUsers.find(
      (entry) => entry.identity.email === protectedSpec.email,
    );
    if (!protectedSnapshot) {
      throw new ProvisioningConflictError(`Missing protected identity: ${protectedSpec.email}`);
    }
    if (!protectedSnapshot.identity.active) {
      throw new ProvisioningConflictError(`Protected profile is inactive: ${protectedSpec.email}`);
    }
    if (protectedSpec.mustNotBeMember && protectedSnapshot.targetOrganizationMembershipCount !== 0) {
      throw new ProvisioningConflictError(
        `${protectedSpec.email} must not belong to ${spec.organization.slug}; found ${protectedSnapshot.targetOrganizationMembershipCount} membership(s)`,
      );
    }
  }

  assertExactSet(
    'Forbidden membership snapshot',
    snapshot.memberForbiddenMemberships.map((entry) => entry.organizationSlug),
    spec.member.forbiddenOrganizationSlugs,
  );
  for (const forbidden of snapshot.memberForbiddenMemberships) {
    if (forbidden.membershipCount !== 0) {
      throw new ProvisioningConflictError(
        `${spec.member.email} must not belong to ${forbidden.organizationSlug}; found ${forbidden.membershipCount} membership(s)`,
      );
    }
  }

  if (spec.security.requirePlatformAdminsEmpty && snapshot.platformAdminCount !== 0) {
    throw new ProvisioningConflictError(
      `platform_admins must remain empty; found ${snapshot.platformAdminCount} row(s)`,
    );
  }
  if (spec.security.requireClientRoleUnassigned && snapshot.clientRoleAssignmentCount !== 0) {
    throw new ProvisioningConflictError(
      `Client role must be unassigned; found ${snapshot.clientRoleAssignmentCount} assignment(s)`,
    );
  }

  assertExactSet('Permission catalogue', snapshot.permissionKeys, PERMISSION_KEYS);

  const slugMatches = snapshot.organizationCandidates.filter(
    (organization) => organization.slug === spec.organization.slug,
  );
  if (slugMatches.length > 1) {
    throw new ProvisioningConflictError(
      `Multiple organizations use the ${spec.organization.slug} slug`,
    );
  }
  const nameConflicts = snapshot.organizationCandidates.filter(
    (organization) =>
      organization.name === spec.organization.name &&
      organization.slug !== spec.organization.slug,
  );
  if (nameConflicts.length) {
    throw new ProvisioningConflictError(
      `An organization named ${spec.organization.name} already exists with a different slug`,
    );
  }

  const organization = slugMatches[0] ?? null;
  if (
    organization &&
    (organization.name !== spec.organization.name ||
      organization.status !== spec.organization.status)
  ) {
    throw new ProvisioningConflictError(
      `Existing ${spec.organization.slug} organization is incompatible (name=${organization.name}, status=${organization.status})`,
    );
  }
  if (!organization && snapshot.roles.length) {
    throw new ProvisioningConflictError(
      `Roles were returned without a resolved ${spec.organization.slug} organization`,
    );
  }
  if (!organization && snapshot.memberMembership) {
    throw new ProvisioningConflictError(
      `Membership was returned without a resolved ${spec.organization.slug} organization`,
    );
  }

  const expectedRoleKeys = ROLE_SPECS.map((role) => role.key);
  const expectedRoleNames = ROLE_SPECS.map((role) => role.name);
  const unexpectedRoles = snapshot.roles.filter(
    (role) => !expectedRoleKeys.includes(role.key) || !expectedRoleNames.includes(role.name),
  );
  if (unexpectedRoles.length) {
    throw new ProvisioningConflictError(
      `Unexpected organization roles: ${unexpectedRoles.map((role) => `${role.name}/${role.key}`).join(', ')}`,
    );
  }

  const rolesToCreate: RoleSpec[] = [];
  const permissionAdditions: PermissionAdditions[] = [];
  for (const roleSpec of ROLE_SPECS) {
    const keyMatches = snapshot.roles.filter((role) => role.key === roleSpec.key);
    const nameMatches = snapshot.roles.filter((role) => role.name === roleSpec.name);
    if (keyMatches.length > 1 || nameMatches.length > 1) {
      throw new ProvisioningConflictError(`Duplicate role identity detected for ${roleSpec.name}`);
    }

    const existing = keyMatches[0] ?? nameMatches[0];
    if (!existing) {
      rolesToCreate.push(roleSpec);
      permissionAdditions.push({ roleKey: roleSpec.key, permissionKeys: roleSpec.permissions });
      continue;
    }
    if (
      existing.key !== roleSpec.key ||
      existing.name !== roleSpec.name ||
      existing.isSystem !== roleSpec.isSystem
    ) {
      throw new ProvisioningConflictError(
        `Existing role ${roleSpec.name}/${roleSpec.key} has incompatible name, key, or is_system state`,
      );
    }

    const unexpectedPermissions = setDifference(existing.permissionKeys, roleSpec.permissions);
    if (unexpectedPermissions.length) {
      throw new ProvisioningConflictError(
        `Role ${roleSpec.name} has unexpected permissions: ${unexpectedPermissions.join(', ')}`,
      );
    }
    const missingPermissions = setDifference(
      roleSpec.permissions,
      existing.permissionKeys,
    ) as PermissionKey[];
    if (missingPermissions.length) {
      permissionAdditions.push({ roleKey: roleSpec.key, permissionKeys: missingPermissions });
    }
  }

  let createMemberMembership = false;
  let assignMemberRole = false;
  if (!snapshot.memberMembership) {
    createMemberMembership = true;
    assignMemberRole = true;
  } else {
    if (
      snapshot.memberMembership.status !== spec.member.status ||
      snapshot.memberMembership.jobTitle !== spec.member.jobTitle
    ) {
      throw new ProvisioningConflictError(
        `Existing membership is incompatible (status=${snapshot.memberMembership.status}, job_title=${snapshot.memberMembership.jobTitle ?? 'null'})`,
      );
    }
    const unexpectedMemberRoles = snapshot.memberMembership.roleKeys.filter(
      (key) => key !== spec.member.roleKey,
    );
    if (unexpectedMemberRoles.length) {
      throw new ProvisioningConflictError(
        `Member has unexpected roles: ${sortedUnique(unexpectedMemberRoles).join(', ')}`,
      );
    }
    assignMemberRole = !snapshot.memberMembership.roleKeys.includes(spec.member.roleKey);
  }

  const createOrganization = organization === null;
  const hasChanges =
    createOrganization ||
    rolesToCreate.length > 0 ||
    permissionAdditions.some((addition) => addition.permissionKeys.length > 0) ||
    createMemberMembership ||
    assignMemberRole;

  return {
    organization,
    createOrganization,
    rolesToCreate,
    permissionAdditions,
    createMemberMembership,
    assignMemberRole,
    hasChanges,
  };
}
