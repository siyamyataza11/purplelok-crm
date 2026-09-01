import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  hasAllPermissions as hasAll,
  hasAnyPermission as hasAny,
  hasPermission as hasOne,
  isPermissionKey,
  PERMISSION_KEYS,
  type PermissionKey,
} from '@/lib/authorization';
import {
  buildUsableOrganizations,
  classifyNoAccess,
  createRequestGeneration,
  EMPTY_RESOLVED_ORGANIZATION,
  selectAuthorizedOrganization,
  type Organization,
  type OrganizationAccess,
  type OrganizationError,
  type OrganizationMembership,
  type OrganizationRole,
  type ResolvedOrganizationState,
} from '@/context/organization-context-state';

interface OrganizationContextValue extends ResolvedOrganizationState {
  availableOrganizations: OrganizationAccess[];
  isOrganizationLoading: boolean;
  organizationError: OrganizationError | null;
  setActiveOrganization: (organizationId: string) => Promise<void>;
  refreshOrganizationContext: () => Promise<void>;
  hasPermission: (permission: PermissionKey) => boolean;
  hasAnyPermission: (permissions: readonly PermissionKey[]) => boolean;
  hasAllPermissions: (permissions: readonly PermissionKey[]) => boolean;
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);

const preferenceKey = (userId: string) =>
  `purplelok.activeOrganization.v1:${userId}`;

function readPreference(userId: string): string | null {
  try {
    return window.localStorage.getItem(preferenceKey(userId));
  } catch {
    return null;
  }
}

function writePreference(userId: string, organizationId: string) {
  try {
    window.localStorage.setItem(preferenceKey(userId), organizationId);
  } catch {
    // Storage is an optional preference only; authorization is server-derived.
  }
}

function clearPreference(userId: string) {
  try {
    window.localStorage.removeItem(preferenceKey(userId));
  } catch {
    // An unavailable storage implementation must not affect authorization.
  }
}

function authorizationError(): OrganizationError {
  return {
    code: 'authorization_error',
    message: 'Your organization access could not be verified. Please retry.',
  };
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const {
    user,
    session,
    profile,
    loading: isAuthLoading,
    status: authStatus,
    generation: authGeneration,
    revalidateAuth,
  } = useAuth();
  const [resolved, setResolved] = useState<ResolvedOrganizationState>(
    EMPTY_RESOLVED_ORGANIZATION,
  );
  const [availableOrganizations, setAvailableOrganizations] = useState<OrganizationAccess[]>([]);
  const [isOrganizationLoading, setIsOrganizationLoading] = useState(true);
  const [organizationError, setOrganizationError] = useState<OrganizationError | null>(null);
  const generation = useRef(createRequestGeneration());
  const abortController = useRef<AbortController | null>(null);

  const clearResolved = useCallback(() => {
    setResolved({
      currentOrganization: null,
      membership: null,
      roles: [],
      permissions: new Set<PermissionKey>(),
    });
  }, []);

  const loadOrganizationContext = useCallback(async (
    requestedOrganizationId?: string,
  ) => {
    if (authStatus !== 'authenticated' || !profile?.active || !user || !session) {
      abortController.current?.abort();
      generation.current.invalidate();
      setAvailableOrganizations([]);
      clearResolved();
      setOrganizationError(null);
      setIsOrganizationLoading(false);
      return;
    }

    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    const requestGeneration = generation.current.next();

    setIsOrganizationLoading(true);
    setOrganizationError(null);
    clearResolved();

    const isCurrent = () =>
      generation.current.isCurrent(requestGeneration) && !controller.signal.aborted;

    try {
      const membershipsResult = await supabase
        .from('organization_members')
        .select('id, organization_id, user_id, job_title, status, created_at, updated_at')
        .eq('user_id', user.id)
        .abortSignal(controller.signal);

      if (!isCurrent()) return;
      if (membershipsResult.error) throw membershipsResult.error;

      const memberships = (membershipsResult.data ?? []) as OrganizationMembership[];
      const organizationIds = [...new Set(
        memberships.map((membership) => membership.organization_id),
      )];

      let organizations: Organization[] = [];
      if (organizationIds.length > 0) {
        const organizationsResult = await supabase
          .from('organizations')
          .select('id, name, slug, status, created_at, updated_at')
          .in('id', organizationIds)
          .abortSignal(controller.signal);

        if (!isCurrent()) return;
        if (organizationsResult.error) throw organizationsResult.error;
        organizations = (organizationsResult.data ?? []) as Organization[];
      }

      const usableOrganizations = buildUsableOrganizations(memberships, organizations);
      setAvailableOrganizations(usableOrganizations);

      if (usableOrganizations.length === 0) {
        clearPreference(user.id);
        setOrganizationError(classifyNoAccess(memberships, organizations));
        setIsOrganizationLoading(false);
        return;
      }

      const savedPreference = requestedOrganizationId ?? readPreference(user.id);
      const selected = selectAuthorizedOrganization(usableOrganizations, savedPreference);

      if (!selected) {
        if (savedPreference) clearPreference(user.id);
        setOrganizationError({
          code: requestedOrganizationId ? 'authorization_error' : 'selection_required',
          message: requestedOrganizationId
            ? 'That organization is not available to your account.'
            : 'Select an organization to continue.',
        });
        setIsOrganizationLoading(false);
        return;
      }

      const assignmentsResult = await supabase
        .from('organization_member_roles')
        .select('organization_role_id')
        .eq('organization_id', selected.organization.id)
        .eq('organization_member_id', selected.membership.id)
        .abortSignal(controller.signal);

      if (!isCurrent()) return;
      if (assignmentsResult.error) throw assignmentsResult.error;

      const roleIds = [...new Set(
        (assignmentsResult.data ?? []).map((assignment) => assignment.organization_role_id as string),
      )];

      if (roleIds.length === 0) {
        setOrganizationError({
          code: 'no_permissions',
          message: 'Your membership does not have an organization role assigned.',
        });
        setIsOrganizationLoading(false);
        return;
      }

      const rolesResult = await supabase
        .from('organization_roles')
        .select('id, organization_id, name, key, is_system, created_at, updated_at')
        .eq('organization_id', selected.organization.id)
        .in('id', roleIds)
        .abortSignal(controller.signal);

      if (!isCurrent()) return;
      if (rolesResult.error) throw rolesResult.error;

      const roles = (rolesResult.data ?? []) as OrganizationRole[];
      if (roles.length !== roleIds.length) {
        throw new Error('Assigned organization roles could not be verified');
      }

      const [mappingsResult, catalogueResult] = await Promise.all([
        supabase
          .from('organization_role_permissions')
          .select('organization_role_id, permission_key')
          .eq('organization_id', selected.organization.id)
          .in('organization_role_id', roleIds)
          .abortSignal(controller.signal),
        supabase
          .from('permissions')
          .select('key')
          .abortSignal(controller.signal),
      ]);

      if (!isCurrent()) return;
      if (mappingsResult.error) throw mappingsResult.error;
      if (catalogueResult.error) throw catalogueResult.error;

      const catalogueKeys = new Set(
        (catalogueResult.data ?? []).map((permission) => permission.key as string),
      );
      if (catalogueKeys.size !== PERMISSION_KEYS.length
        || PERMISSION_KEYS.some((permission) => !catalogueKeys.has(permission))) {
        throw new Error('Permission catalogue does not match the application contract');
      }

      const effectivePermissions = new Set<PermissionKey>();
      for (const mapping of mappingsResult.data ?? []) {
        const permission = mapping.permission_key as string;
        if (!isPermissionKey(permission) || !catalogueKeys.has(permission)) {
          throw new Error('An assigned permission is not recognized by the application');
        }
        effectivePermissions.add(permission);
      }

      if (effectivePermissions.size === 0) {
        setOrganizationError({
          code: 'no_permissions',
          message: 'No permissions are assigned to your organization role.',
        });
        setIsOrganizationLoading(false);
        return;
      }

      if (!isCurrent()) return;
      setResolved({
        currentOrganization: selected.organization,
        membership: selected.membership,
        roles,
        permissions: effectivePermissions,
      });
      writePreference(user.id, selected.organization.id);
      setOrganizationError(null);
      setIsOrganizationLoading(false);
    } catch {
      if (!isCurrent()) return;
      clearResolved();
      setOrganizationError(authorizationError());
      setIsOrganizationLoading(false);
    }
  }, [authStatus, clearResolved, profile?.active, session, user]);

  useEffect(() => {
    if (isAuthLoading) {
      abortController.current?.abort();
      generation.current.invalidate();
      setAvailableOrganizations([]);
      clearResolved();
      setOrganizationError(null);
      setIsOrganizationLoading(true);
      return;
    }

    if (authStatus !== 'authenticated' || !profile?.active || !user || !session) {
      abortController.current?.abort();
      generation.current.invalidate();
      setAvailableOrganizations([]);
      clearResolved();
      setOrganizationError(null);
      setIsOrganizationLoading(false);
      return;
    }

    void loadOrganizationContext();
    return () => abortController.current?.abort();
  }, [
    authGeneration,
    authStatus,
    clearResolved,
    isAuthLoading,
    loadOrganizationContext,
    profile?.active,
    session,
    user,
  ]);

  const refreshOrganizationContext = useCallback(async () => {
    abortController.current?.abort();
    generation.current.invalidate();
    setAvailableOrganizations([]);
    clearResolved();
    setOrganizationError(null);
    setIsOrganizationLoading(true);
    const verified = await revalidateAuth();
    if (!verified) {
      setIsOrganizationLoading(false);
      return;
    }
    await loadOrganizationContext();
  }, [clearResolved, loadOrganizationContext, revalidateAuth]);

  const setActiveOrganization = useCallback(async (organizationId: string) => {
    if (!availableOrganizations.some(
      ({ organization }) => organization.id === organizationId,
    )) {
      setOrganizationError({
        code: 'authorization_error',
        message: 'That organization is not available to your account.',
      });
      return;
    }
    await loadOrganizationContext(organizationId);
  }, [availableOrganizations, loadOrganizationContext]);

  const value = useMemo<OrganizationContextValue>(() => ({
    ...resolved,
    availableOrganizations,
    isOrganizationLoading,
    organizationError,
    setActiveOrganization,
    refreshOrganizationContext,
    hasPermission: (permission) => hasOne(resolved.permissions, permission),
    hasAnyPermission: (permissions) => hasAny(resolved.permissions, permissions),
    hasAllPermissions: (permissions) => hasAll(resolved.permissions, permissions),
  }), [
    availableOrganizations,
    isOrganizationLoading,
    organizationError,
    refreshOrganizationContext,
    resolved,
    setActiveOrganization,
  ]);

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

// Context and its consumer hook intentionally share one module.
// eslint-disable-next-line react-refresh/only-export-components
export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error('useOrganization must be used within OrganizationProvider');
  }
  return context;
}
