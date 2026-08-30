import type { TenantDataApi, TenantMutationInput } from '@/lib/tenant-data';

interface ExampleDatabaseRow {
  id: string;
  organization_id: string;
  name: string;
}

type ExampleMutation = TenantMutationInput<ExampleDatabaseRow>;

// This compile-only contract proves a caller-provided organization_id has no
// inhabitable value. Removing the optional-never protection makes this fail.
type OrganizationInputIsNever = Exclude<
  ExampleMutation['organization_id'],
  undefined
> extends never ? true : false;

export const tenantMutationExcludesOrganizationId: OrganizationInputIsNever = true;

// @ts-expect-error Batch 5A mutation inputs reject caller-controlled tenancy.
const invalidTenantMutation: ExampleMutation = { id: 'record', name: 'Name', organization_id: 'forged' };
void invalidTenantMutation;

export const assertTenantApiTypes = (tenant: TenantDataApi): void => {
  void tenant.table('clients').insert({ company_name: 'Allowed' });
  // @ts-expect-error The public insert method also rejects caller tenancy.
  void tenant.table('clients').insert({ company_name: 'Forged', organization_id: 'org-b' });
  // @ts-expect-error The public update method also rejects caller tenancy.
  void tenant.table('clients').updateById('client-a', { organization_id: 'org-b' });
};
