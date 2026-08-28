import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  buildProvisioningPlan,
  ORGANIZATION_SPEC,
  OWNER_MEMBERSHIP_SPEC,
  PERMISSION_KEYS,
  ProvisioningConflictError,
  ROLE_SPECS,
  TARGET_OWNER_EMAIL,
  type ProvisioningSnapshot,
} from './purplelok-provisioning.js';

const owner = {
  id: 'dc62be87-fe6a-4b3f-8a6c-a875ffe36a9c',
  email: TARGET_OWNER_EMAIL,
  fullName: 'Siyamthanda Myataza',
  profileRole: 'staff',
  active: true,
} as const;

const bootstrapAdmin = {
  id: '148803f0-322b-408e-9ffc-c9ce486172a6',
  email: BOOTSTRAP_ADMIN_EMAIL,
  fullName: 'PURPLELOK Admin',
  profileRole: 'super_admin',
  active: true,
} as const;

function emptySnapshot(
  overrides: Partial<ProvisioningSnapshot> = {},
): ProvisioningSnapshot {
  return {
    owner,
    bootstrapAdmin,
    permissionKeys: PERMISSION_KEYS,
    organizationCandidates: [],
    roles: [],
    ownerMembership: null,
    bootstrapMembershipCount: 0,
    platformAdminCount: 0,
    clientRoleAssignmentCount: 0,
    ...overrides,
  };
}

function provisionedSnapshot(
  overrides: Partial<ProvisioningSnapshot> = {},
): ProvisioningSnapshot {
  return emptySnapshot({
    organizationCandidates: [
      {
        id: '10000000-0000-0000-0000-000000000001',
        ...ORGANIZATION_SPEC,
      },
    ],
    roles: ROLE_SPECS.map((role, index) => ({
      id: `20000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
      name: role.name,
      key: role.key,
      isSystem: true,
      permissionKeys: role.permissions,
    })),
    ownerMembership: {
      id: '30000000-0000-0000-0000-000000000001',
      status: OWNER_MEMBERSHIP_SPEC.status,
      jobTitle: OWNER_MEMBERSHIP_SPEC.jobTitle,
      roleKeys: ['owner'],
    },
    ...overrides,
  });
}

test('initial provisioning plan creates one tenant and all six roles', () => {
  const plan = buildProvisioningPlan(emptySnapshot());

  assert.equal(plan.createOrganization, true);
  assert.equal(plan.rolesToCreate.length, 6);
  assert.deepEqual(
    plan.rolesToCreate.map((role) => role.key),
    ['owner', 'admin', 'finance', 'project_manager', 'staff', 'client'],
  );
  assert.equal(plan.createOwnerMembership, true);
  assert.equal(plan.assignOwnerRole, true);
});

test('repeated execution is idempotent and plans no changes', () => {
  const plan = buildProvisioningPlan(provisionedSnapshot());

  assert.equal(plan.hasChanges, false);
  assert.equal(plan.createOrganization, false);
  assert.deepEqual(plan.rolesToCreate, []);
  assert.deepEqual(plan.permissionAdditions, []);
  assert.equal(plan.createOwnerMembership, false);
  assert.equal(plan.assignOwnerRole, false);
});

test('a compatible existing tenant is resolved instead of duplicated', () => {
  const snapshot = emptySnapshot({
    organizationCandidates: [
      {
        id: '10000000-0000-0000-0000-000000000001',
        ...ORGANIZATION_SPEC,
      },
    ],
  });

  assert.equal(buildProvisioningPlan(snapshot).createOrganization, false);
});

test('Owner receives exactly all 28 catalogue permissions', () => {
  const ownerRole = ROLE_SPECS.find((role) => role.key === 'owner');
  assert.ok(ownerRole);
  assert.equal(ownerRole.permissions.length, 28);
  assert.deepEqual([...ownerRole.permissions].sort(), [...PERMISSION_KEYS].sort());
});

test('the plan cannot create platform-admin authority', () => {
  const plan = buildProvisioningPlan(emptySnapshot());
  assert.equal(Object.keys(plan).some((key) => key.toLowerCase().includes('platform')), false);

  assert.throws(
    () => buildProvisioningPlan(emptySnapshot({ platformAdminCount: 1 })),
    ProvisioningConflictError,
  );
});

test('the bootstrap admin receives no membership and an existing one aborts', () => {
  const plan = buildProvisioningPlan(emptySnapshot());
  assert.equal(plan.createOwnerMembership, true);
  assert.notEqual(owner.id as string, bootstrapAdmin.id as string);

  assert.throws(
    () => buildProvisioningPlan(emptySnapshot({ bootstrapMembershipCount: 1 })),
    /Bootstrap admin must have no organization membership/,
  );
});

test('Client role is created but assigned to nobody', () => {
  const plan = buildProvisioningPlan(emptySnapshot());
  assert.ok(plan.rolesToCreate.some((role) => role.key === 'client'));
  assert.equal(plan.assignOwnerRole, true);

  assert.throws(
    () => buildProvisioningPlan(emptySnapshot({ clientRoleAssignmentCount: 1 })),
    /Client role must be unassigned/,
  );
});

test('conflicting pre-existing organization data aborts instead of overwriting', () => {
  assert.throws(
    () =>
      buildProvisioningPlan(
        emptySnapshot({
          organizationCandidates: [
            {
              id: '10000000-0000-0000-0000-000000000001',
              name: 'Unexpected Name',
              slug: ORGANIZATION_SPEC.slug,
              status: ORGANIZATION_SPEC.status,
            },
          ],
        }),
      ),
    /Existing purplelok organization is incompatible/,
  );
});

test('unexpected existing role authority aborts rather than being removed', () => {
  const snapshot = provisionedSnapshot({
    roles: provisionedSnapshot().roles.map((role) =>
      role.key === 'staff'
        ? { ...role, permissionKeys: [...role.permissionKeys, 'settings.manage'] }
        : role,
    ),
  });

  assert.throws(() => buildProvisioningPlan(snapshot), /Role Staff has unexpected permissions/);
});
