export const TARGET_OWNER_EMAIL = 'siyamyataza11@gmail.com';
export const BOOTSTRAP_ADMIN_EMAIL = 'admin@purplelok.com';

export const ORGANIZATION_SPEC = {
  name: 'PURPLELOK',
  slug: 'purplelok',
  status: 'active',
} as const;

export const OWNER_MEMBERSHIP_SPEC = {
  status: 'active',
  jobTitle: 'Co-Founder & CEO',
} as const;

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
  {
    name: 'Owner',
    key: 'owner',
    isSystem: true,
    permissions: PERMISSION_KEYS,
  },
  {
    name: 'Admin',
    key: 'admin',
    isSystem: true,
    // Owner-specific lifecycle and billing capabilities may differentiate this
    // role later. Batch 1 currently grants both roles the full catalogue.
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

export interface ProvisioningSnapshot {
  readonly owner: ResolvedIdentity;
  readonly bootstrapAdmin: ResolvedIdentity;
  readonly permissionKeys: readonly string[];
  readonly organizationCandidates: readonly OrganizationSnapshot[];
  readonly roles: readonly RoleSnapshot[];
  readonly ownerMembership: MembershipSnapshot | null;
  readonly bootstrapMembershipCount: number;
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
  readonly createOwnerMembership: boolean;
  readonly assignOwnerRole: boolean;
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

function describeSetConflict(
  label: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  const missing = setDifference(expected, actual);
  const unexpected = setDifference(actual, expected);

  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `missing: ${missing.join(', ')}` : null,
      unexpected.length ? `unexpected: ${unexpected.join(', ')}` : null,
    ].filter(Boolean);
    throw new ProvisioningConflictError(`${label} conflict (${details.join('; ')})`);
  }
}

export function buildProvisioningPlan(snapshot: ProvisioningSnapshot): ProvisioningPlan {
  if (snapshot.owner.email !== TARGET_OWNER_EMAIL) {
    throw new ProvisioningConflictError(
      `Resolved owner email is ${snapshot.owner.email}, expected ${TARGET_OWNER_EMAIL}`,
    );
  }
  if (!snapshot.owner.active) {
    throw new ProvisioningConflictError('The approved owner profile is inactive');
  }
  if (snapshot.bootstrapAdmin.email !== BOOTSTRAP_ADMIN_EMAIL) {
    throw new ProvisioningConflictError(
      `Resolved bootstrap email is ${snapshot.bootstrapAdmin.email}, expected ${BOOTSTRAP_ADMIN_EMAIL}`,
    );
  }
  if (snapshot.owner.id === snapshot.bootstrapAdmin.id) {
    throw new ProvisioningConflictError('Owner and bootstrap identities resolve to the same user');
  }
  if (snapshot.platformAdminCount !== 0) {
    throw new ProvisioningConflictError(
      `platform_admins must remain empty; found ${snapshot.platformAdminCount} row(s)`,
    );
  }
  if (snapshot.bootstrapMembershipCount !== 0) {
    throw new ProvisioningConflictError(
      `Bootstrap admin must have no organization membership; found ${snapshot.bootstrapMembershipCount}`,
    );
  }
  if (snapshot.clientRoleAssignmentCount !== 0) {
    throw new ProvisioningConflictError(
      `Client role must be unassigned; found ${snapshot.clientRoleAssignmentCount} assignment(s)`,
    );
  }

  describeSetConflict('Permission catalogue', snapshot.permissionKeys, PERMISSION_KEYS);

  const slugMatches = snapshot.organizationCandidates.filter(
    (organization) => organization.slug === ORGANIZATION_SPEC.slug,
  );
  if (slugMatches.length > 1) {
    throw new ProvisioningConflictError('Multiple organizations use the PURPLELOK slug');
  }

  const nameConflicts = snapshot.organizationCandidates.filter(
    (organization) =>
      organization.name === ORGANIZATION_SPEC.name && organization.slug !== ORGANIZATION_SPEC.slug,
  );
  if (nameConflicts.length) {
    throw new ProvisioningConflictError(
      'An organization named PURPLELOK already exists with a different slug',
    );
  }

  const organization = slugMatches[0] ?? null;
  if (
    organization &&
    (organization.name !== ORGANIZATION_SPEC.name ||
      organization.status !== ORGANIZATION_SPEC.status)
  ) {
    throw new ProvisioningConflictError(
      `Existing purplelok organization is incompatible (name=${organization.name}, status=${organization.status})`,
    );
  }

  if (!organization && snapshot.roles.length) {
    throw new ProvisioningConflictError('Roles were returned without a resolved PURPLELOK organization');
  }
  if (!organization && snapshot.ownerMembership) {
    throw new ProvisioningConflictError(
      'Owner membership was returned without a resolved PURPLELOK organization',
    );
  }

  const rolesToCreate: RoleSpec[] = [];
  const permissionAdditions: PermissionAdditions[] = [];

  for (const spec of ROLE_SPECS) {
    const keyMatches = snapshot.roles.filter((role) => role.key === spec.key);
    const nameMatches = snapshot.roles.filter((role) => role.name === spec.name);
    if (keyMatches.length > 1 || nameMatches.length > 1) {
      throw new ProvisioningConflictError(`Duplicate role identity detected for ${spec.name}`);
    }

    const existing = keyMatches[0] ?? nameMatches[0];
    if (!existing) {
      rolesToCreate.push(spec);
      permissionAdditions.push({ roleKey: spec.key, permissionKeys: spec.permissions });
      continue;
    }

    if (
      existing.key !== spec.key ||
      existing.name !== spec.name ||
      existing.isSystem !== spec.isSystem
    ) {
      throw new ProvisioningConflictError(
        `Existing role ${spec.name}/${spec.key} has incompatible name, key, or is_system state`,
      );
    }

    const unexpectedPermissions = setDifference(existing.permissionKeys, spec.permissions);
    if (unexpectedPermissions.length) {
      throw new ProvisioningConflictError(
        `Role ${spec.name} has unexpected permissions: ${unexpectedPermissions.join(', ')}`,
      );
    }

    const missingPermissions = setDifference(spec.permissions, existing.permissionKeys) as PermissionKey[];
    if (missingPermissions.length) {
      permissionAdditions.push({ roleKey: spec.key, permissionKeys: missingPermissions });
    }
  }

  let createOwnerMembership = false;
  let assignOwnerRole = false;
  if (!snapshot.ownerMembership) {
    createOwnerMembership = true;
    assignOwnerRole = true;
  } else {
    if (
      snapshot.ownerMembership.status !== OWNER_MEMBERSHIP_SPEC.status ||
      snapshot.ownerMembership.jobTitle !== OWNER_MEMBERSHIP_SPEC.jobTitle
    ) {
      throw new ProvisioningConflictError(
        `Existing owner membership is incompatible (status=${snapshot.ownerMembership.status}, job_title=${snapshot.ownerMembership.jobTitle ?? 'null'})`,
      );
    }

    const unexpectedRoles = snapshot.ownerMembership.roleKeys.filter((key) => key !== 'owner');
    if (unexpectedRoles.length) {
      throw new ProvisioningConflictError(
        `Owner membership has additional roles: ${sortedUnique(unexpectedRoles).join(', ')}`,
      );
    }
    assignOwnerRole = !snapshot.ownerMembership.roleKeys.includes('owner');
  }

  const createOrganization = organization === null;
  const hasChanges =
    createOrganization ||
    rolesToCreate.length > 0 ||
    permissionAdditions.some((addition) => addition.permissionKeys.length > 0) ||
    createOwnerMembership ||
    assignOwnerRole;

  return {
    organization,
    createOrganization,
    rolesToCreate,
    permissionAdditions,
    createOwnerMembership,
    assignOwnerRole,
    hasChanges,
  };
}
