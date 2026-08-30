import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/lib/supabase';
import {
  createTenantDataApi,
  TenantRequestScope,
  type TenantDatabaseClient,
} from '@/lib/tenant-data-internal';
import type { TenantDataApi } from '@/lib/tenant-data';

const TenantDataContext = createContext<TenantDataApi | undefined>(undefined);

export function TenantDataProvider({ children }: { children: ReactNode }) {
  const { currentOrganization } = useOrganization();
  const organizationId = currentOrganization?.id ?? null;
  const scope = useMemo(() => new TenantRequestScope(organizationId), [organizationId]);
  const tenant = useMemo(
    () => createTenantDataApi(supabase as unknown as TenantDatabaseClient, scope),
    [scope],
  );

  useEffect(() => () => scope.dispose(), [scope]);

  return (
    <TenantDataContext.Provider value={tenant}>
      {children}
    </TenantDataContext.Provider>
  );
}

// Context and its consumer hook intentionally share one module.
// eslint-disable-next-line react-refresh/only-export-components
export function useTenantData(): TenantDataApi {
  const context = useContext(TenantDataContext);
  if (!context) throw new Error('useTenantData must be used within TenantDataProvider');
  return context;
}
