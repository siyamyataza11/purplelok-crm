import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTION_PERMISSIONS,
  authorizedPages,
  canAccessPage,
  hasPermission,
  type PermissionKey,
} from '../../src/lib/authorization.js';
import {
  buildUsableOrganizations,
  createRequestGeneration,
  EMPTY_RESOLVED_ORGANIZATION,
  isOrganizationContextReady,
  selectAuthorizedOrganization,
  type Organization,
  type OrganizationAccess,
  type OrganizationMembership,
  type ResolvedOrganizationState,
} from '../../src/context/organization-context-state.js';

const organization = (id: string, status: Organization['status'] = 'active'): Organization => ({
  id,
  name: `Organization ${id}`,
  slug: `organization-${id}`,
  status,
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
});

const membership = (
  id: string,
  organizationId: string,
  status: OrganizationMembership['status'] = 'active',
): OrganizationMembership => ({
  id,
  organization_id: organizationId,
  user_id: 'user-1',
  job_title: 'Tester',
  status,
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
});

const access = (id: string): OrganizationAccess => ({
  organization: organization(id),
  membership: membership(`membership-${id}`, id),
});

const readyState = (): ResolvedOrganizationState => ({
  currentOrganization: organization('one'),
  membership: membership('membership-one', 'one'),
  roles: [{
    id: 'role-one',
    organization_id: 'one',
    name: 'Staff',
    key: 'staff',
    is_system: true,
    created_at: '2026-08-28T00:00:00Z',
    updated_at: '2026-08-28T00:00:00Z',
  }],
  permissions: new Set<PermissionKey>(['clients.read']),
});

test('CRM shell waits while organization context loads', () => {
  assert.equal(isOrganizationContextReady(true, null, readyState()), false);
});

test('no-membership user cannot enter the CRM', () => {
  assert.equal(isOrganizationContextReady(false, null, EMPTY_RESOLVED_ORGANIZATION), false);
});

test('active membership without a role cannot enter the normal CRM', () => {
  const state = { ...readyState(), roles: [], permissions: new Set<PermissionKey>() };
  assert.equal(isOrganizationContextReady(false, null, state), false);
});

test('forged stored organization is rejected for a multi-organization user', () => {
  assert.equal(selectAuthorizedOrganization([access('one'), access('two')], 'forged'), null);
});

test('one valid organization auto-selects even when the stored preference is forged', () => {
  assert.equal(
    selectAuthorizedOrganization([access('one')], 'forged')?.organization.id,
    'one',
  );
});

test('only active memberships in active organizations are usable', () => {
  const result = buildUsableOrganizations(
    [
      membership('active', 'one'),
      membership('suspended-member', 'two', 'suspended'),
      membership('suspended-org', 'three'),
    ],
    [organization('one'), organization('two'), organization('three', 'suspended')],
  );
  assert.deepEqual(result.map(({ organization: item }) => item.id), ['one']);
});

test('switching begins from cleared tenant role and permission state', () => {
  assert.equal(EMPTY_RESOLVED_ORGANIZATION.currentOrganization, null);
  assert.deepEqual(EMPTY_RESOLVED_ORGANIZATION.roles, []);
  assert.equal(EMPTY_RESOLVED_ORGANIZATION.permissions.size, 0);
});

test('authorization query failure fails closed', () => {
  assert.equal(
    isOrganizationContextReady(
      false,
      { code: 'authorization_error', message: 'query failed' },
      readyState(),
    ),
    false,
  );
});

test('page guard blocks a missing read capability', () => {
  assert.equal(canAccessPage('invoices', new Set<PermissionKey>(['clients.read'])), false);
  assert.equal(canAccessPage('dashboard', new Set<PermissionKey>()), true);
});

test('sidebar source list excludes unauthorized navigation targets', () => {
  const result = authorizedPages(
    ['dashboard', 'clients', 'invoices', 'reports'],
    new Set<PermissionKey>(['clients.read']),
  );
  assert.deepEqual(result, ['dashboard', 'clients']);
});

test('action guard blocks unauthorized mutation UI', () => {
  const permissions = new Set<PermissionKey>(['invoices.read']);
  assert.equal(hasPermission(permissions, ACTION_PERMISSIONS.invoicesWrite), false);
  assert.equal(hasPermission(permissions, ACTION_PERMISSIONS.invoicesApprove), false);
});

test('stale async organization generation cannot overwrite a newer selection', () => {
  const gate = createRequestGeneration();
  const first = gate.next();
  const second = gate.next();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(second), false);
});

