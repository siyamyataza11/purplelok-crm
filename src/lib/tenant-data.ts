/**
 * Safe public type surface for tenant data consumers.
 *
 * Application code obtains the runtime API exclusively from useTenantData().
 * Authority construction and database adapters live behind the enforced
 * tenant-data-internal import boundary.
 */
export type {
  OrganizationMemberDirectoryEntry,
  TenantDataApi,
  TenantDomainTable,
  TenantFilter,
  TenantMemberDirectoryApi,
  TenantNotificationApi,
  TenantMutationInput,
  TenantMutationResult,
  TenantOrder,
  TenantOwnedRecord,
  TenantParentTable,
  TenantReturningOptions,
  TenantSelectOptions,
  TenantTableApi,
} from '@/lib/tenant-data-internal';
