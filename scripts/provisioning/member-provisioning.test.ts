import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMemberProvisioningPlan,
  executeMemberProvisioning,
  type MemberProvisioningRepository,
  type MemberProvisioningRequest,
  type MemberProvisioningSnapshot,
} from './member-provisioning.js';
import { parseMemberProvisioningArgs } from './member-provisioner.js';

const request = (overrides: Partial<MemberProvisioningRequest> = {}): MemberProvisioningRequest => ({
  email: 'employee@example.com',
  organizationSlug: 'purplelok',
  role: 'Staff',
  jobTitle: 'Web Developer',
  ...overrides,
});

const snapshot = (
  overrides: Partial<MemberProvisioningSnapshot> = {},
): MemberProvisioningSnapshot => ({
  authCandidates: [{ id: 'user-1', email: 'employee@example.com', deleted: false }],
  profileCandidates: [{
    id: 'user-1',
    email: 'employee@example.com',
    fullName: 'Example Employee',
    active: true,
    profileRole: 'staff',
  }],
  organizationCandidates: [{
    id: 'organization-1',
    name: 'PURPLELOK',
    slug: 'purplelok',
    status: 'active',
  }],
  roleCandidates: [{
    id: 'role-staff',
    organizationId: 'organization-1',
    name: 'Staff',
    key: 'staff',
  }],
  membershipCandidates: [],
  roleAssignments: [],
  platformAdminFingerprint: 'platform-admins-original',
  platformAdminCount: 0,
  ...overrides,
});

function compatibleSnapshot(): MemberProvisioningSnapshot {
  return snapshot({
    membershipCandidates: [{
      id: 'membership-1',
      organizationId: 'organization-1',
      userId: 'user-1',
      status: 'active',
      jobTitle: 'Web Developer',
    }],
    roleAssignments: [{
      organizationId: 'organization-1',
      organizationMemberId: 'membership-1',
      organizationRoleId: 'role-staff',
      roleName: 'Staff',
      roleKey: 'staff',
    }],
  });
}

class MemoryRepository implements MemberProvisioningRepository {
  state: MemberProvisioningSnapshot;
  readonly writeLog: string[] = [];
  mutateAfterWrite?: (state: MemberProvisioningSnapshot) => MemberProvisioningSnapshot;
  private mutationApplied = false;

  constructor(initial: MemberProvisioningSnapshot) {
    this.state = structuredClone(initial);
  }

  async loadSnapshot(): Promise<MemberProvisioningSnapshot> {
    if (this.writeLog.length > 0 && this.mutateAfterWrite && !this.mutationApplied) {
      this.state = this.mutateAfterWrite(this.state);
      this.mutationApplied = true;
    }
    return structuredClone(this.state);
  }

  async createMembership(input: {
    organizationId: string;
    userId: string;
    status: 'active';
    jobTitle: string;
  }): Promise<string> {
    this.writeLog.push('organization_members.insert');
    this.state = {
      ...this.state,
      membershipCandidates: [{
        id: 'membership-created',
        organizationId: input.organizationId,
        userId: input.userId,
        status: input.status,
        jobTitle: input.jobTitle,
      }],
    };
    return 'membership-created';
  }

  async assignRole(input: {
    organizationId: string;
    organizationMemberId: string;
    organizationRoleId: string;
  }): Promise<void> {
    this.writeLog.push('organization_member_roles.insert');
    const role = this.state.roleCandidates.find((candidate) => candidate.id === input.organizationRoleId);
    if (!role) throw new Error('Test role was not found');
    this.state = {
      ...this.state,
      roleAssignments: [{
        organizationId: input.organizationId,
        organizationMemberId: input.organizationMemberId,
        organizationRoleId: input.organizationRoleId,
        roleName: role.name,
        roleKey: role.key,
      }],
    };
  }
}

test('existing unprovisioned user produces a Staff membership plan', () => {
  const plan = buildMemberProvisioningPlan(request(), snapshot());
  assert.equal(plan.createMembership, true);
  assert.equal(plan.assignRole, true);
  assert.equal(plan.role.name, 'Staff');
  assert.equal(plan.hasChanges, true);
});

test('apply creates exactly one active membership with the explicit job title', async () => {
  const repository = new MemoryRepository(snapshot());
  const result = await executeMemberProvisioning(repository, request(), true);
  assert.deepEqual(repository.writeLog, [
    'organization_members.insert',
    'organization_member_roles.insert',
  ]);
  assert.deepEqual(repository.state.membershipCandidates, [{
    id: 'membership-created',
    organizationId: 'organization-1',
    userId: 'user-1',
    status: 'active',
    jobTitle: 'Web Developer',
  }]);
  assert.equal(result.writes, 2);
});

test('apply assigns exactly the requested organization role', async () => {
  const repository = new MemoryRepository(snapshot());
  await executeMemberProvisioning(repository, request(), true);
  assert.deepEqual(repository.state.roleAssignments, [{
    organizationId: 'organization-1',
    organizationMemberId: 'membership-created',
    organizationRoleId: 'role-staff',
    roleName: 'Staff',
    roleKey: 'staff',
  }]);
});

test('second execution after successful provisioning plans zero changes', async () => {
  const repository = new MemoryRepository(snapshot());
  await executeMemberProvisioning(repository, request(), true);
  const repeated = await executeMemberProvisioning(repository, request(), false);
  assert.equal(repeated.initialPlan.hasChanges, false);
  assert.equal(repeated.writes, 0);
  assert.equal(repository.writeLog.length, 2);
});

test('unknown Auth user fails closed', () => {
  assert.throws(
    () => buildMemberProvisioningPlan(request(), snapshot({ authCandidates: [] })),
    /exactly one auth\.users identity.*found 0/,
  );
});

test('duplicate Auth identity fails closed', () => {
  assert.throws(
    () => buildMemberProvisioningPlan(request(), snapshot({
      authCandidates: [
        { id: 'user-1', email: 'employee@example.com', deleted: false },
        { id: 'user-2', email: 'EMPLOYEE@example.com', deleted: false },
      ],
    })),
    /exactly one auth\.users identity.*found 2/,
  );
});

test('deleted Auth user fails closed', () => {
  assert.throws(
    () => buildMemberProvisioningPlan(request(), snapshot({
      authCandidates: [{ id: 'user-1', email: 'employee@example.com', deleted: true }],
    })),
    /Auth user is deleted/,
  );
});

test('inactive profile fails closed', () => {
  assert.throws(
    () => buildMemberProvisioningPlan(request(), snapshot({
      profileCandidates: [{
        id: 'user-1',
        email: 'employee@example.com',
        fullName: 'Example Employee',
        active: false,
        profileRole: 'staff',
      }],
    })),
    /Profile is inactive/,
  );
});

test('ambiguous or mismatched profile fails closed', () => {
  assert.throws(
    () => buildMemberProvisioningPlan(request(), snapshot({
      profileCandidates: [
        snapshot().profileCandidates[0],
        { ...snapshot().profileCandidates[0], id: 'user-2' },
      ],
    })),
    /exactly one matching profile.*found 2/,
  );
});

test('unknown organization slug fails closed', () => {
  assert.throws(
    () => buildMemberProvisioningPlan(request(), snapshot({ organizationCandidates: [] })),
    /exactly one organization for slug purplelok.*found 0/,
  );
});

test('unknown organization role fails closed', () => {
  assert.throws(
    () => buildMemberProvisioningPlan(request(), snapshot({ roleCandidates: [] })),
    /Unknown role Staff/,
  );
});

test('matching role from another organization is rejected', () => {
  assert.throws(
    () => buildMemberProvisioningPlan(request(), snapshot({
      roleCandidates: [{
        id: 'other-staff',
        organizationId: 'organization-2',
        name: 'Staff',
        key: 'staff',
      }],
    })),
    /exists only outside organization purplelok/,
  );
});

test('incompatible existing membership fails without silent update', () => {
  const existing = compatibleSnapshot();
  assert.throws(
    () => buildMemberProvisioningPlan(request(), {
      ...existing,
      membershipCandidates: [{
        ...existing.membershipCandidates[0],
        status: 'suspended',
      }],
    }),
    /Existing membership is incompatible/,
  );
  assert.throws(
    () => buildMemberProvisioningPlan(request(), {
      ...existing,
      membershipCandidates: [{
        ...existing.membershipCandidates[0],
        jobTitle: 'Different Title',
      }],
    }),
    /Existing membership is incompatible/,
  );
});

test('unexpected existing role fails rather than replacing authority', () => {
  const existing = compatibleSnapshot();
  assert.throws(
    () => buildMemberProvisioningPlan(request(), {
      ...existing,
      roleAssignments: [{
        organizationId: 'organization-1',
        organizationMemberId: 'membership-1',
        organizationRoleId: 'role-owner',
        roleName: 'Owner',
        roleKey: 'owner',
      }],
    }),
    /Unexpected existing role Owner\/owner/,
  );
});

test('Client role provisioning is rejected entirely', () => {
  assert.throws(
    () => buildMemberProvisioningPlan(request({ role: 'Client' }), snapshot()),
    /Client role provisioning is disabled/,
  );
});

test('platform_admins remains unchanged and drift aborts final verification', async () => {
  const repository = new MemoryRepository(snapshot());
  await executeMemberProvisioning(repository, request(), true);
  assert.equal(repository.state.platformAdminFingerprint, 'platform-admins-original');
  assert.equal(repository.state.platformAdminCount, 0);

  const driftingRepository = new MemoryRepository(snapshot());
  driftingRepository.mutateAfterWrite = (state) => ({
    ...state,
    platformAdminFingerprint: 'platform-admins-changed',
    platformAdminCount: 1,
  });
  await assert.rejects(
    executeMemberProvisioning(driftingRepository, request(), true),
    /platform_admins changed/,
  );
});

test('profiles.role remains unchanged and drift aborts final verification', async () => {
  const repository = new MemoryRepository(snapshot());
  await executeMemberProvisioning(repository, request(), true);
  assert.equal(repository.state.profileCandidates[0].profileRole, 'staff');

  const driftingRepository = new MemoryRepository(snapshot());
  driftingRepository.mutateAfterWrite = (state) => ({
    ...state,
    profileCandidates: [{ ...state.profileCandidates[0], profileRole: 'super_admin' }],
  });
  await assert.rejects(
    executeMemberProvisioning(driftingRepository, request(), true),
    /profiles\.role changed/,
  );
});

test('bootstrap account cannot accidentally join real PURPLELOK', () => {
  assert.throws(
    () => buildMemberProvisioningPlan(request({
      email: 'admin@purplelok.com',
      organizationSlug: 'purplelok',
      role: 'Staff',
      jobTitle: 'Designer',
    }), snapshot()),
    /Protected account admin@purplelok\.com may only be inspected for purplelok-demo/,
  );
});

test('real owner cannot accidentally join PURPLELOK Demo', () => {
  assert.throws(
    () => buildMemberProvisioningPlan(request({
      email: 'siyamyataza11@gmail.com',
      organizationSlug: 'purplelok-demo',
      role: 'Admin',
      jobTitle: 'Demo Administrator',
    }), snapshot()),
    /Protected account siyamyataza11@gmail\.com may only be inspected for purplelok/,
  );
});

test('dry run performs zero repository writes', async () => {
  const repository = new MemoryRepository(snapshot());
  const result = await executeMemberProvisioning(repository, request(), false);
  assert.equal(result.initialPlan.hasChanges, true);
  assert.equal(result.writes, 0);
  assert.deepEqual(repository.writeLog, []);
  assert.deepEqual(repository.state.membershipCandidates, []);
  assert.deepEqual(repository.state.roleAssignments, []);
});

test('compatible existing membership with requested role is a no-op', () => {
  const plan = buildMemberProvisioningPlan(request(), compatibleSnapshot());
  assert.equal(plan.createMembership, false);
  assert.equal(plan.assignRole, false);
  assert.equal(plan.hasChanges, false);
});

test('CLI defaults to dry run and requires explicit apply', () => {
  const argumentsList = [
    '--email', 'employee@example.com',
    '--organization', 'purplelok',
    '--role', 'Staff',
    '--job-title', 'Web Developer',
  ];
  assert.equal(parseMemberProvisioningArgs(argumentsList).apply, false);
  assert.equal(parseMemberProvisioningArgs([...argumentsList, '--apply']).apply, true);
  assert.throws(
    () => parseMemberProvisioningArgs([...argumentsList, '--dry-run', '--apply']),
    /cannot be used together/,
  );
});

test('planner never exposes profile, platform-admin, or role-removal writes', () => {
  const plan = buildMemberProvisioningPlan(request(), snapshot());
  assert.deepEqual(Object.keys(plan).sort(), [
    'assignRole',
    'createMembership',
    'hasChanges',
    'identity',
    'membership',
    'organization',
    'role',
  ]);
});
