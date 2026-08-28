import type { ReactNode } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import type { PermissionKey } from '@/lib/authorization';

export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: PermissionKey;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { hasPermission } = useOrganization();
  return hasPermission(permission) ? children : fallback;
}

