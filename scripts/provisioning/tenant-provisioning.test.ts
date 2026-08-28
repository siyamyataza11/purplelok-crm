import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTenantProvisioningPlan,
  PERMISSION_KEYS,
  ProvisioningConflictError,
  ROLE_SPECS,
  type ProvisioningSnapshot,
  type ResolvedIdentity,
  type TenantProvisioningSpec,
} from './tenant-provisioning.js';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  PURPLELOK_DEMO_SPEC,
  PURPLELOK_SPEC,
  REAL_OWNER_EMAIL,
} from './tenant-specs.js';

const realOwner: ResolvedIdentity = {
  id: 'dc62be87-fe6a-4b3f-8a6c-a875ffe36a9c',
  email: REAL_OWNER_EMAIL,
  fullName: 'Siyamthanda Myataza',
  profileRole: 'staff',
  active: true,
};

const bootstrapAdmin: ResolvedIdentity = {
  id: '148803f0-322b-408e-9ffc-c9ce486172a6',
  email: BOOTSTRAP_ADMIN_EMAIL,
  fullName: 'PURPLELOK Admin',
  profileRole: 'super_admin',
  active: true,
};

function identityFor(email: string): ResolvedIdentity {
  if (email === REAL_OWNER_EMAIL) return realOwner;
  if (email === BOOTSTRAP_ADMIN_EMAIL) return bootstrapAdmin;
  throw new Error(`No test identity for ${email}`);
}

function emptySnapshot(
  spec: TenantProvisioningSpec,
  overrides: Partial<ProvisioningSnapshot> = {},
): ProvisioningSnapshot {
  return {
    member: identityFor(spec.member.email),
    protectedUsers: spec.protectedUsers.map((protectedUser) => ({
      identity: identityFor(protectedUser.email),
      targetOrganizationMembershipCount: 0,
    })),
    memberForbiddenMemberships: spec.member.forbiddenOrganizationSlugs.map(
      (organizationSlug) => ({ organizationSlug, membershipCount: 0 }),
    ),
    permissionKeys: PERMISSION_KEYS,
    organizationCandidates: [],
    roles: [],
    memberMembership: null,
    platformAdminCount: 0,
    clientRoleAssignmentCount: 0,
    ...overrides,
  };
}

function provisionedSnapshot(
  spec: TenantProvisioningSpec,
  overrides: Partial<ProvisioningSnapshot> = {},
): ProvisioningSnapshot {
  return emptySnapshot(spec, {
    organizationCandidates: [
      {
        id: '10000000-0000-0000-0000-000000000001',
        ...spec.organization,
      },
    ],
    roles: ROLE_SPECS.map((role, index) => ({
      id: `20000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
      name: role.name,
      key: role.key,
      isSystem: role.isSystem,
      permissionKeys: role.permissions,
    })),
    memberMembership: {
      id: '30000000-0000-0000-0000-000000000001',
      status: spec.member.status,
      jobTitle: spec.member.jobTitle,
      roleKeys: [spec.member.roleKey],
    },
    ...overrides,
  });
}

test('PURPLELOK provisioning still produces the approved owner plan after refactor', () => {
  const plan = buildTenantProvisioningPlan(PURPLELOK_SPEC, emptySnapshot(PURPLELOK_SPEC));

  assert.equal(plan.createOrganization, true);
  assert.equal(plan.rolesToCreate.length, 6);
  assert.equal(plan.createMemberMembership, true);
  assert.equal(plan.assignMemberRole, true);
  assert.equal(PURPLELOK_SPEC.member.roleKey, 'owner');
  assert.equal(PURPLELOK_SPEC.member.jobTitle, 'Co-Founder & CEO');
});

test('PURPLELOK Demo initial plan creates the tenant exactly once', () => {
  const initial = buildTenantProvisioningPlan(
    PURPLELOK_DEMO_SPEC,
    emptySnapshot(PURPLELOK_DEMO_SPEC),
  );
  const repeated = buildTenantProvisioningPlan(
    PURPLELOK_DEMO_SPEC,
    provisionedSnapshot(PURPLELOK_DEMO_SPEC),
  );

  assert.equal(initial.createOrganization, true);
  assert.equal(repeated.createOrganization, false);
  assert.equal(repeated.hasChanges, false);
});

test('repeated PURPLELOK Demo provisioning is a complete no-op', () => {
  const plan = buildTenantProvisioningPlan(
    PURPLELOK_DEMO_SPEC,
    provisionedSnapshot(PURPLELOK_DEMO_SPEC),
  );

  assert.deepEqual(plan.rolesToCreate, []);
  assert.deepEqual(plan.permissionAdditions, []);
  assert.equal(plan.createMemberMembership, false);
  assert.equal(plan.assignMemberRole, false);
  assert.equal(plan.hasChanges, false);
});

test('shared matrix defines exactly six system roles', () => {
  assert.equal(ROLE_SPECS.length, 6);
  assert.deepEqual(
    ROLE_SPECS.map((role) => [role.name, role.key, role.isSystem]),
    [
      ['Owner', 'owner', true],
      ['Admin', 'admin', true],
      ['Finance', 'finance', true],
      ['Project Manager', 'project_manager', true],
      ['Staff', 'staff', true],
      ['Client', 'client', true],
    ],
  );
});

test('shared matrix defines exactly 96 approved role-permission mappings', () => {
  const counts = Object.fromEntries(
    ROLE_SPECS.map((role) => [role.key, role.permissions.length]),
  );
  assert.deepEqual(counts, {
    owner: 28,
    admin: 28,
    finance: 13,
    project_manager: 12,
    staff: 9,
    client: 6,
  });
  assert.equal(ROLE_SPECS.reduce((total, role) => total + role.permissions.length, 0), 96);
  assert.equal(new Set(PERMISSION_KEYS).size, 28);
});

test('bootstrap user receives active Demo Administrator membership and Admin only', () => {
  const snapshot = provisionedSnapshot(PURPLELOK_DEMO_SPEC);
  assert.equal(snapshot.member.email, BOOTSTRAP_ADMIN_EMAIL);
  assert.equal(snapshot.memberMembership?.status, 'active');
  assert.equal(snapshot.memberMembership?.jobTitle, 'Demo Administrator');
  assert.deepEqual(snapshot.memberMembership?.roleKeys, ['admin']);
  assert.equal(buildTenantProvisioningPlan(PURPLELOK_DEMO_SPEC, snapshot).hasChanges, false);
});

test('bootstrap user membership in real PURPLELOK aborts demo provisioning', () => {
  const snapshot = emptySnapshot(PURPLELOK_DEMO_SPEC, {
    memberForbiddenMemberships: [{ organizationSlug: 'purplelok', membershipCount: 1 }],
  });
  assert.throws(
    () => buildTenantProvisioningPlan(PURPLELOK_DEMO_SPEC, snapshot),
    /admin@purplelok\.com must not belong to purplelok/,
  );
});

test('real owner membership in PURPLELOK Demo aborts provisioning', () => {
  const snapshot = emptySnapshot(PURPLELOK_DEMO_SPEC, {
    protectedUsers: [
      { identity: realOwner, targetOrganizationMembershipCount: 1 },
    ],
  });
  assert.throws(
    () => buildTenantProvisioningPlan(PURPLELOK_DEMO_SPEC, snapshot),
    /siyamyataza11@gmail\.com must not belong to purplelok-demo/,
  );
});

test('Client role remains unassigned', () => {
  assert.equal(buildTenantProvisioningPlan(PURPLELOK_DEMO_SPEC, emptySnapshot(PURPLELOK_DEMO_SPEC)).assignMemberRole, true);
  assert.throws(
    () =>
      buildTenantProvisioningPlan(
        PURPLELOK_DEMO_SPEC,
        emptySnapshot(PURPLELOK_DEMO_SPEC, { clientRoleAssignmentCount: 1 }),
      ),
    /Client role must be unassigned/,
  );
});

test('platform_admins must remain empty and cannot be planned', () => {
  const plan = buildTenantProvisioningPlan(
    PURPLELOK_DEMO_SPEC,
    emptySnapshot(PURPLELOK_DEMO_SPEC),
  );
  assert.equal(Object.keys(plan).some((key) => key.toLowerCase().includes('platform')), false);
  assert.throws(
    () =>
      buildTenantProvisioningPlan(
        PURPLELOK_DEMO_SPEC,
        emptySnapshot(PURPLELOK_DEMO_SPEC, { platformAdminCount: 1 }),
      ),
    /platform_admins must remain empty/,
  );
});

test('profiles.role is ignored and super_admin creates only organization Admin authority', () => {
  const snapshot = emptySnapshot(PURPLELOK_DEMO_SPEC, {
    member: { ...bootstrapAdmin, profileRole: 'super_admin' },
  });
  const plan = buildTenantProvisioningPlan(PURPLELOK_DEMO_SPEC, snapshot);

  assert.equal(PURPLELOK_DEMO_SPEC.member.roleKey, 'admin');
  assert.equal(plan.assignMemberRole, true);
  assert.equal(Object.keys(plan).some((key) => key.toLowerCase().includes('profile')), false);
});

test('conflicting tenant name, slug, or status aborts without repair', () => {
  assert.throws(
    () =>
      buildTenantProvisioningPlan(
        PURPLELOK_DEMO_SPEC,
        emptySnapshot(PURPLELOK_DEMO_SPEC, {
          organizationCandidates: [
            {
              id: '10000000-0000-0000-0000-000000000001',
              name: 'Wrong Name',
              slug: 'purplelok-demo',
              status: 'active',
            },
          ],
        }),
      ),
    /Existing purplelok-demo organization is incompatible/,
  );
  assert.throws(
    () =>
      buildTenantProvisioningPlan(
        PURPLELOK_DEMO_SPEC,
        emptySnapshot(PURPLELOK_DEMO_SPEC, {
          organizationCandidates: [
            {
              id: '10000000-0000-0000-0000-000000000002',
              name: 'PURPLELOK Demo',
              slug: 'different-slug',
              status: 'active',
            },
          ],
        }),
      ),
    /already exists with a different slug/,
  );
});

test('unexpected role or conflicting role authority aborts', () => {
  const base = provisionedSnapshot(PURPLELOK_DEMO_SPEC);
  assert.throws(
    () =>
      buildTenantProvisioningPlan(PURPLELOK_DEMO_SPEC, {
        ...base,
        roles: [
          ...base.roles,
          {
            id: '20000000-0000-0000-0000-000000000099',
            name: 'Auditor',
            key: 'auditor',
            isSystem: true,
            permissionKeys: ['reports.read'],
          },
        ],
      }),
    /Unexpected organization roles/,
  );
  assert.throws(
    () =>
      buildTenantProvisioningPlan(PURPLELOK_DEMO_SPEC, {
        ...base,
        roles: base.roles.map((role) =>
          role.key === 'staff'
            ? { ...role, permissionKeys: [...role.permissionKeys, 'settings.manage'] }
            : role,
        ),
      }),
    /Role Staff has unexpected permissions/,
  );
});

test('unexpected member-role authority aborts', () => {
  const snapshot = provisionedSnapshot(PURPLELOK_DEMO_SPEC, {
    memberMembership: {
      id: '30000000-0000-0000-0000-000000000001',
      status: 'active',
      jobTitle: 'Demo Administrator',
      roleKeys: ['admin', 'owner'],
    },
  });
  assert.throws(
    () => buildTenantProvisioningPlan(PURPLELOK_DEMO_SPEC, snapshot),
    /Member has unexpected roles: owner/,
  );
});

test('incompatible membership status or job title aborts', () => {
  const base = provisionedSnapshot(PURPLELOK_DEMO_SPEC);
  assert.throws(
    () =>
      buildTenantProvisioningPlan(PURPLELOK_DEMO_SPEC, {
        ...base,
        memberMembership: { ...base.memberMembership!, status: 'inactive' },
      }),
    /Existing membership is incompatible/,
  );
  assert.throws(
    () =>
      buildTenantProvisioningPlan(PURPLELOK_DEMO_SPEC, {
        ...base,
        memberMembership: { ...base.memberMembership!, jobTitle: 'CEO' },
      }),
    /Existing membership is incompatible/,
  );
});

test('inactive member or protected identity aborts', () => {
  assert.throws(
    () =>
      buildTenantProvisioningPlan(
        PURPLELOK_DEMO_SPEC,
        emptySnapshot(PURPLELOK_DEMO_SPEC, {
          member: { ...bootstrapAdmin, active: false },
        }),
      ),
    /Required member profile is inactive/,
  );
  assert.throws(
    () =>
      buildTenantProvisioningPlan(
        PURPLELOK_DEMO_SPEC,
        emptySnapshot(PURPLELOK_DEMO_SPEC, {
          protectedUsers: [
            { identity: { ...realOwner, active: false }, targetOrganizationMembershipCount: 0 },
          ],
        }),
      ),
    /Protected profile is inactive/,
  );
});

test('permission catalogue drift aborts instead of creating new keys', () => {
  assert.throws(
    () =>
      buildTenantProvisioningPlan(
        PURPLELOK_DEMO_SPEC,
        emptySnapshot(PURPLELOK_DEMO_SPEC, {
          permissionKeys: [...PERMISSION_KEYS.slice(1), 'unexpected.permission'],
        }),
      ),
    ProvisioningConflictError,
  );
});
