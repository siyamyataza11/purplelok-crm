import type { TenantProvisioningSpec } from './tenant-provisioning.js';

export const REAL_OWNER_EMAIL = 'siyamyataza11@gmail.com';
export const BOOTSTRAP_ADMIN_EMAIL = 'admin@purplelok.com';

export const PURPLELOK_SPEC: TenantProvisioningSpec = {
  key: 'purplelok',
  commandName: 'provision:purplelok',
  applicationName: 'purplelok-provisioning-v2',
  organization: {
    name: 'PURPLELOK',
    slug: 'purplelok',
    status: 'active',
  },
  member: {
    email: REAL_OWNER_EMAIL,
    status: 'active',
    jobTitle: 'Co-Founder & CEO',
    roleKey: 'owner',
    forbiddenOrganizationSlugs: ['purplelok-demo'],
  },
  protectedUsers: [{ email: BOOTSTRAP_ADMIN_EMAIL, mustNotBeMember: true }],
  security: {
    requirePlatformAdminsEmpty: true,
    requireClientRoleUnassigned: true,
  },
};

export const PURPLELOK_DEMO_SPEC: TenantProvisioningSpec = {
  key: 'purplelok-demo',
  commandName: 'provision:purplelok-demo',
  applicationName: 'purplelok-demo-provisioning-v1',
  organization: {
    name: 'PURPLELOK Demo',
    slug: 'purplelok-demo',
    status: 'active',
  },
  member: {
    email: BOOTSTRAP_ADMIN_EMAIL,
    status: 'active',
    jobTitle: 'Demo Administrator',
    roleKey: 'admin',
    forbiddenOrganizationSlugs: ['purplelok'],
  },
  protectedUsers: [{ email: REAL_OWNER_EMAIL, mustNotBeMember: true }],
  security: {
    requirePlatformAdminsEmpty: true,
    requireClientRoleUnassigned: true,
  },
};
