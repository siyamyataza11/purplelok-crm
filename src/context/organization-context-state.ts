import type { PermissionKey } from '@/lib/authorization';

export type OrganizationStatus = 'active' | 'suspended' | 'archived';
export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'removed';

export interface Organization {
  id: string;
  name: string;
  slug: string | null;
  status: OrganizationStatus;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMembership {
  id: string;
  organization_id: string;
  user_id: string;
  job_title: string | null;
  status: MembershipStatus;
  created_at: string;
  updated_at: string;
}

export interface OrganizationRole {
  id: string;
  organization_id: string;
  name: string;
  key: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganizationAccess {
  organization: Organization;
  membership: OrganizationMembership;
}

export type OrganizationErrorCode =
  | 'no_organization_access'
  | 'organization_suspended'
  | 'organization_archived'
  | 'membership_suspended'
  | 'invitation_pending'
  | 'no_permissions'
  | 'selection_required'
  | 'authorization_error';

export interface OrganizationError {
  code: OrganizationErrorCode;
  message: string;
}

export interface ResolvedOrganizationState {
  currentOrganization: Organization | null;
  membership: OrganizationMembership | null;
  roles: OrganizationRole[];
  permissions: ReadonlySet<PermissionKey>;
}

export const EMPTY_RESOLVED_ORGANIZATION: ResolvedOrganizationState = {
  currentOrganization: null,
  membership: null,
  roles: [],
  permissions: new Set<PermissionKey>(),
};

export function isOrganizationContextReady(
  isLoading: boolean,
  error: OrganizationError | null,
  state: ResolvedOrganizationState,
): boolean {
  return !isLoading
    && error === null
    && state.currentOrganization !== null
    && state.membership?.status === 'active'
    && state.roles.length > 0
    && state.permissions.size > 0;
}

export function buildUsableOrganizations(
  memberships: readonly OrganizationMembership[],
  organizations: readonly Organization[],
): OrganizationAccess[] {
  const organizationsById = new Map(
    organizations.map((organization) => [organization.id, organization]),
  );

  return memberships.flatMap((membership) => {
    const organization = organizationsById.get(membership.organization_id);
    if (membership.status !== 'active' || organization?.status !== 'active') return [];
    return [{ membership, organization }];
  });
}

export function selectAuthorizedOrganization(
  availableOrganizations: readonly OrganizationAccess[],
  preferredOrganizationId: string | null,
): OrganizationAccess | null {
  if (availableOrganizations.length === 1) return availableOrganizations[0];
  if (!preferredOrganizationId) return null;
  return availableOrganizations.find(
    ({ organization }) => organization.id === preferredOrganizationId,
  ) ?? null;
}

export function classifyNoAccess(
  memberships: readonly OrganizationMembership[],
  organizations: readonly Organization[],
): OrganizationError {
  const organizationById = new Map(
    organizations.map((organization) => [organization.id, organization]),
  );

  if (memberships.some((membership) => membership.status === 'invited')) {
    return { code: 'invitation_pending', message: 'Your organization invitation is pending.' };
  }
  if (memberships.some((membership) => membership.status === 'suspended')) {
    return { code: 'membership_suspended', message: 'Your organization membership is suspended.' };
  }
  if (memberships.some((membership) =>
    organizationById.get(membership.organization_id)?.status === 'suspended')) {
    return { code: 'organization_suspended', message: 'This organization is suspended.' };
  }
  if (memberships.some((membership) =>
    organizationById.get(membership.organization_id)?.status === 'archived')) {
    return { code: 'organization_archived', message: 'This organization is archived.' };
  }
  return {
    code: 'no_organization_access',
    message: 'Your account does not have access to an active organization.',
  };
}

export function createRequestGeneration() {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: (generation: number) => generation === current,
    invalidate: () => { current += 1; },
  };
}
