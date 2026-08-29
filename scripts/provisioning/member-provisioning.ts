export interface MemberProvisioningRequest {
  readonly email: string;
  readonly organizationSlug: string;
  readonly role: string;
  readonly jobTitle: string;
}

export interface AuthIdentityCandidate {
  readonly id: string;
  readonly email: string;
  readonly deleted: boolean;
}

export interface ProfileIdentityCandidate {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly active: boolean;
  readonly profileRole: string;
}

export interface MemberOrganizationCandidate {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
}

export interface MemberRoleCandidate {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly key: string;
}

export interface MemberMembershipCandidate {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly status: string;
  readonly jobTitle: string | null;
}

export interface MemberRoleAssignmentCandidate {
  readonly organizationId: string;
  readonly organizationMemberId: string;
  readonly organizationRoleId: string;
  readonly roleName: string;
  readonly roleKey: string;
}

export interface MemberProvisioningSnapshot {
  readonly authCandidates: readonly AuthIdentityCandidate[];
  readonly profileCandidates: readonly ProfileIdentityCandidate[];
  readonly organizationCandidates: readonly MemberOrganizationCandidate[];
  readonly roleCandidates: readonly MemberRoleCandidate[];
  readonly membershipCandidates: readonly MemberMembershipCandidate[];
  readonly roleAssignments: readonly MemberRoleAssignmentCandidate[];
  readonly platformAdminFingerprint: string;
  readonly platformAdminCount: number;
}

export interface MemberProvisioningPlan {
  readonly identity: ProfileIdentityCandidate;
  readonly organization: MemberOrganizationCandidate;
  readonly role: MemberRoleCandidate;
  readonly membership: MemberMembershipCandidate | null;
  readonly createMembership: boolean;
  readonly assignRole: boolean;
  readonly hasChanges: boolean;
}

export interface MemberProvisioningRepository {
  loadSnapshot(request: MemberProvisioningRequest): Promise<MemberProvisioningSnapshot>;
  createMembership(input: {
    organizationId: string;
    userId: string;
    status: 'active';
    jobTitle: string;
  }): Promise<string>;
  assignRole(input: {
    organizationId: string;
    organizationMemberId: string;
    organizationRoleId: string;
  }): Promise<void>;
}

export interface MemberProvisioningExecution {
  readonly initialPlan: MemberProvisioningPlan;
  readonly finalPlan: MemberProvisioningPlan | null;
  readonly writes: number;
}

export class MemberProvisioningConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberProvisioningConflictError';
  }
}

const PROTECTED_ACCOUNTS: ReadonlyMap<string, {
  readonly organizationSlug: string;
  readonly roleKey: string;
  readonly jobTitle: string;
}> = new Map([
  ['admin@purplelok.com', {
    organizationSlug: 'purplelok-demo',
    roleKey: 'admin',
    jobTitle: 'Demo Administrator',
  }],
  ['siyamyataza11@gmail.com', {
    organizationSlug: 'purplelok',
    roleKey: 'owner',
    jobTitle: 'Co-Founder & CEO',
  }],
] as const);

function exactlyOne<T>(label: string, candidates: readonly T[]): T {
  if (candidates.length !== 1) {
    throw new MemberProvisioningConflictError(
      `Expected exactly one ${label}; found ${candidates.length}`,
    );
  }
  return candidates[0];
}

function sameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function normalizeMemberProvisioningRequest(
  request: MemberProvisioningRequest,
): MemberProvisioningRequest {
  const normalized = {
    email: request.email.trim().toLowerCase(),
    organizationSlug: request.organizationSlug.trim(),
    role: request.role.trim(),
    jobTitle: request.jobTitle.trim(),
  };

  if (!normalized.email || !normalized.email.includes('@')) {
    throw new Error('A valid --email value is required');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized.organizationSlug)) {
    throw new Error('A valid lowercase organization slug is required');
  }
  if (!normalized.role) throw new Error('--role must not be blank');
  if (!normalized.jobTitle) throw new Error('--job-title must not be blank');
  if (normalized.role.toLowerCase() === 'client') {
    throw new MemberProvisioningConflictError(
      'Client role provisioning is disabled until client-specific row scope is implemented',
    );
  }

  return normalized;
}

export function buildMemberProvisioningPlan(
  rawRequest: MemberProvisioningRequest,
  snapshot: MemberProvisioningSnapshot,
): MemberProvisioningPlan {
  const request = normalizeMemberProvisioningRequest(rawRequest);
  const protectedAccount = PROTECTED_ACCOUNTS.get(request.email);
  if (protectedAccount && request.organizationSlug !== protectedAccount.organizationSlug) {
    throw new MemberProvisioningConflictError(
      `Protected account ${request.email} may only be inspected for ${protectedAccount.organizationSlug}`,
    );
  }

  const authUser = exactlyOne(`auth.users identity for ${request.email}`, snapshot.authCandidates);
  if (!sameEmail(authUser.email, request.email)) {
    throw new MemberProvisioningConflictError('Resolved Auth identity email does not match the request');
  }
  if (authUser.deleted) {
    throw new MemberProvisioningConflictError(`Auth user is deleted: ${request.email}`);
  }

  const profile = exactlyOne(`matching profile for ${request.email}`, snapshot.profileCandidates);
  if (profile.id !== authUser.id || !sameEmail(profile.email, authUser.email)) {
    throw new MemberProvisioningConflictError('auth.users/profile identity mismatch');
  }
  if (!profile.active) {
    throw new MemberProvisioningConflictError(`Profile is inactive: ${request.email}`);
  }

  const organization = exactlyOne(
    `organization for slug ${request.organizationSlug}`,
    snapshot.organizationCandidates,
  );
  if (organization.slug !== request.organizationSlug) {
    throw new MemberProvisioningConflictError('Resolved organization slug does not match the request');
  }
  if (organization.status !== 'active') {
    throw new MemberProvisioningConflictError(
      `Organization ${request.organizationSlug} is not active (status=${organization.status})`,
    );
  }

  const targetRoles = snapshot.roleCandidates.filter(
    (role) => role.organizationId === organization.id,
  );
  if (targetRoles.length === 0) {
    if (snapshot.roleCandidates.length > 0) {
      throw new MemberProvisioningConflictError(
        `Role ${request.role} exists only outside organization ${request.organizationSlug}`,
      );
    }
    throw new MemberProvisioningConflictError(
      `Unknown role ${request.role} in organization ${request.organizationSlug}`,
    );
  }
  const role = exactlyOne(
    `role ${request.role} in organization ${request.organizationSlug}`,
    targetRoles,
  );
  if (role.key.toLowerCase() === 'client' || role.name.toLowerCase() === 'client') {
    throw new MemberProvisioningConflictError(
      'Client role provisioning is disabled until client-specific row scope is implemented',
    );
  }

  if (snapshot.membershipCandidates.length > 1) {
    throw new MemberProvisioningConflictError(
      `Multiple memberships exist for ${request.email} in ${request.organizationSlug}`,
    );
  }
  const membership = snapshot.membershipCandidates[0] ?? null;
  if (
    membership &&
    (membership.organizationId !== organization.id || membership.userId !== authUser.id)
  ) {
    throw new MemberProvisioningConflictError('Resolved membership does not match the target identity and organization');
  }

  if (!membership && snapshot.roleAssignments.length > 0) {
    throw new MemberProvisioningConflictError('Role assignments exist without a target membership');
  }
  if (membership) {
    if (membership.status !== 'active' || membership.jobTitle !== request.jobTitle) {
      throw new MemberProvisioningConflictError(
        `Existing membership is incompatible (status=${membership.status}, job_title=${membership.jobTitle ?? 'null'})`,
      );
    }
    for (const assignment of snapshot.roleAssignments) {
      if (
        assignment.organizationId !== organization.id ||
        assignment.organizationMemberId !== membership.id
      ) {
        throw new MemberProvisioningConflictError('Existing role assignment has a forged organization or membership identity');
      }
      if (assignment.organizationRoleId !== role.id) {
        throw new MemberProvisioningConflictError(
          `Unexpected existing role ${assignment.roleName}/${assignment.roleKey}; refusing to replace authority`,
        );
      }
    }
    if (snapshot.roleAssignments.length > 1) {
      throw new MemberProvisioningConflictError('Duplicate requested role assignments were returned');
    }
  }

  const createMembership = membership === null;
  const assignRole = createMembership || snapshot.roleAssignments.length === 0;
  const plan: MemberProvisioningPlan = {
    identity: profile,
    organization,
    role,
    membership,
    createMembership,
    assignRole,
    hasChanges: createMembership || assignRole,
  };

  if (protectedAccount) {
    if (
      role.key !== protectedAccount.roleKey ||
      request.jobTitle !== protectedAccount.jobTitle ||
      plan.hasChanges
    ) {
      throw new MemberProvisioningConflictError(
        `Protected account ${request.email} cannot be changed by provision:member`,
      );
    }
  }

  return plan;
}

export async function executeMemberProvisioning(
  repository: MemberProvisioningRepository,
  rawRequest: MemberProvisioningRequest,
  apply: boolean,
): Promise<MemberProvisioningExecution> {
  const request = normalizeMemberProvisioningRequest(rawRequest);
  const initialSnapshot = await repository.loadSnapshot(request);
  const initialPlan = buildMemberProvisioningPlan(request, initialSnapshot);

  if (!apply) {
    return { initialPlan, finalPlan: null, writes: 0 };
  }

  let writes = 0;
  let membershipId = initialPlan.membership?.id ?? null;
  if (initialPlan.createMembership) {
    membershipId = await repository.createMembership({
      organizationId: initialPlan.organization.id,
      userId: initialPlan.identity.id,
      status: 'active',
      jobTitle: request.jobTitle,
    });
    writes += 1;
  }
  if (initialPlan.assignRole) {
    if (!membershipId) throw new Error('Cannot assign a role without a resolved membership');
    await repository.assignRole({
      organizationId: initialPlan.organization.id,
      organizationMemberId: membershipId,
      organizationRoleId: initialPlan.role.id,
    });
    writes += 1;
  }

  const finalSnapshot = await repository.loadSnapshot(request);
  const finalPlan = buildMemberProvisioningPlan(request, finalSnapshot);
  if (finalPlan.hasChanges) {
    throw new Error('Final member provisioning planner still reports pending changes');
  }
  if (finalSnapshot.platformAdminFingerprint !== initialSnapshot.platformAdminFingerprint) {
    throw new Error('platform_admins changed during member provisioning');
  }
  if (finalPlan.identity.profileRole !== initialPlan.identity.profileRole) {
    throw new Error('profiles.role changed during member provisioning');
  }

  return { initialPlan, finalPlan, writes };
}
