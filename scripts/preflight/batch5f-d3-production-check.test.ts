import assert from 'node:assert/strict';
import test from 'node:test';
import {
  D3_MIGRATION,
  DOMAIN_TABLES,
  PERMISSION_KEYS,
  POST_D2_MIGRATIONS,
  ROLE_PERMISSIONS,
  type D3Phase,
  type D3Snapshot,
  type FunctionSnapshot,
  validateD3Snapshot,
} from './batch5f-d3-production-check.js';

const REAL = '2f02d28b-a8f1-48cd-acbc-f47a5bcd1757';
const DEMO = '9e35e50a-8a9f-4fec-b64e-13388a415e10';
const names: Record<string, string> = { owner: 'Owner', admin: 'Admin', finance: 'Finance', project_manager: 'Project Manager', staff: 'Staff', client: 'Client' };

function fn(signature: string, securityDefiner: boolean, authenticated: boolean, result: string, volatility = 's', rowSecurity = 'row_security=off'): FunctionSnapshot {
  return { signature, owner: 'postgres', volatility, securityDefiner, result, config: ['search_path=""', rowSecurity], executeGrantees: authenticated ? ['authenticated', 'postgres'] : ['postgres'] };
}

function fixture(phase: D3Phase): D3Snapshot {
  const identity = { users: 1, emailIdentities: 1, liveSessions: 1, tokenSessionMatches: 1, profiles: 1, memberships: 1, expectedRoles: 1, assignedRoles: 1, clientRoles: 0 };
  const d2Triggers = [
    ['organization_roles_protect_system_identity', 'organization_roles', 'purplelok_protect_system_role_identity', 31],
    ['organization_member_roles_reject_client', 'organization_member_roles', 'purplelok_reject_client_role_assignment', 23],
    ['organization_role_permissions_restrict_client', 'organization_role_permissions', 'purplelok_restrict_client_permissions', 23],
  ].map(([name, table, functionName, type]) => ({ name: String(name), table: String(table), functionSchema: 'private', functionName: String(functionName), enabled: 'O', type: Number(type), internal: false }));
  return {
    migrations: (phase === 'pre' ? POST_D2_MIGRATIONS : [...POST_D2_MIGRATIONS, D3_MIGRATION]).map(([version, name]) => [version, name]),
    organizations: [{ id: REAL, slug: 'purplelok', status: 'active' }, { id: DEMO, slug: 'purplelok-demo', status: 'active' }],
    permissionKeys: [...PERMISSION_KEYS],
    roles: [REAL, DEMO].flatMap((organizationId) => Object.entries(ROLE_PERMISSIONS).map(([key, permissions]) => ({ organizationId, key, name: names[key], isSystem: true, permissions: [...permissions].sort() }))),
    authority: { clientAssignments: 0, mixedAssignments: 0, malformedPermissions: 0, orphanMappings: 0, platformAdmins: 0 },
    domain: { total: 88, demo: 88, purplelok: 0, nullOwned: 0, orphaned: 0 },
    tenantIntegrity: { validForeignKeys: 22, invalidForeignKeys: 0, childMismatches: 0 },
    policy: phase === 'pre' ? { count: 84, hash: 'eb744436bf76a7cc18e32b06734b5478', d3Named: 0 } : { count: 52, hash: 'ce50cde59a1bd0116a593f0db805e1d8', d3Named: 52 },
    rls: DOMAIN_TABLES.map((name) => ({ name, enabled: true, forced: false, owner: 'postgres' })),
    owner: { ...identity }, demoAdmin: { ...identity }, gates: { total: 0, recoveryPending: 0 },
    d1Helpers: [
      fn('private.purplelok_current_session_id()', false, false, 'uuid', 's', 'row_security=on'),
      fn('private.purplelok_has_normal_session()', true, true, 'boolean'),
      fn('private.purplelok_has_active_membership(uuid)', true, true, 'boolean'),
      fn('private.purplelok_has_permission(uuid,text)', true, true, 'boolean'),
      fn('private.purplelok_can_access_resource(uuid,text)', false, true, 'boolean', 's', 'row_security=on'),
    ],
    d2Functions: [
      fn('private.purplelok_protect_system_role_identity()', true, false, 'trigger', 'v'),
      fn('private.purplelok_reject_client_role_assignment()', true, false, 'trigger', 'v'),
      fn('private.purplelok_restrict_client_permissions()', true, false, 'trigger', 'v'),
    ],
    d2Triggers,
    d3Functions: phase === 'pre' ? [] : [
      fn('private.purplelok_can_reference_members(uuid,text,uuid[])', true, true, 'boolean'),
      fn('private.purplelok_protect_domain_update()', false, false, 'trigger', 'v', 'row_security=on'),
    ],
    d3Triggers: phase === 'pre' ? [] : DOMAIN_TABLES.map((table) => ({ name: `domain_${table}_protect_update`, table, functionSchema: 'private', functionName: 'purplelok_protect_domain_update', enabled: 'O', type: 19, internal: false })),
    d4Objects: 0,
  };
}

function rejects(name: string, phase: D3Phase, mutate: (snapshot: D3Snapshot) => void): void {
  test(name, () => { const snapshot = fixture(phase); mutate(snapshot); assert.throws(() => validateD3Snapshot(snapshot, phase), /Batch 5F-D3 contract failed/); });
}

test('exact post-D2 state passes pre mode', () => assert.doesNotThrow(() => validateD3Snapshot(fixture('pre'), 'pre')));
test('exact post-D3 state passes after mode', () => assert.doesNotThrow(() => validateD3Snapshot(fixture('after'), 'after')));
rejects('nine migrations is rejected', 'pre', (s) => { s.migrations.pop(); });
rejects('D2 missing is rejected', 'pre', (s) => { s.migrations.splice(-1, 1); });
rejects('partial D3 functions in pre mode is rejected', 'pre', (s) => { s.d3Functions.push(fn('private.purplelok_can_reference_members(uuid,text,uuid[])', true, true, 'boolean')); });
rejects('partial D3 policies in pre mode is rejected', 'pre', (s) => { s.policy.d3Named = 1; });
rejects('D4 migration is rejected', 'after', (s) => { s.migrations.push(['20260904180000', 'batch_5f_d4_protected_workflows']); });
rejects('D4 objects are rejected', 'after', (s) => { s.d4Objects = 1; });
for (const count of [28, 29, 30, 31, 33]) rejects(`${count} permissions is rejected`, 'pre', (s) => { s.permissionKeys = Array.from({ length: count }, (_, index) => `invalid.${index}`); });
rejects('the exact legacy 28-key catalogue is rejected', 'pre', (s) => { s.permissionKeys = s.permissionKeys.filter((key) => !['activities.read', 'collaboration.read', 'collaboration.write', 'collaboration.manage'].includes(key)); });
rejects('a 32-key catalogue containing an unknown key is rejected', 'pre', (s) => { s.permissionKeys[0] = 'unknown.read'; });
rejects('incorrect D2 mapping is rejected', 'pre', (s) => { s.roles[0].permissions.pop(); });
rejects('D1 helper drift is rejected', 'pre', (s) => { s.d1Helpers[0].executeGrantees = ['authenticated', 'postgres']; });
rejects('D2 function drift is rejected', 'pre', (s) => { s.d2Functions[0].securityDefiner = false; });
rejects('D2 trigger drift is rejected', 'pre', (s) => { s.d2Triggers[0].enabled = 'D'; });
for (const count of [83, 85]) rejects(`${count} legacy policies is rejected`, 'pre', (s) => { s.policy.count = count; });
rejects('wrong legacy policy hash is rejected', 'pre', (s) => { s.policy.hash = 'wrong'; });
for (const count of [51, 53]) rejects(`${count} D3 policies is rejected`, 'after', (s) => { s.policy.count = count; });
rejects('wrong D3 policy hash is rejected', 'after', (s) => { s.policy.hash = 'wrong'; });
rejects('missing D3 policy name is rejected', 'after', (s) => { s.policy.d3Named = 51; });
rejects('RLS disabled is rejected', 'after', (s) => { s.rls[0].enabled = false; });
rejects('FORCE RLS is rejected', 'after', (s) => { s.rls[0].forced = true; });
rejects('tenant FK count mismatch is rejected', 'pre', (s) => { s.tenantIntegrity.validForeignKeys = 21; });
rejects('unvalidated tenant FK is rejected', 'pre', (s) => { s.tenantIntegrity.invalidForeignKeys = 1; });
rejects('child tenant mismatch is rejected', 'pre', (s) => { s.tenantIntegrity.childMismatches = 1; });
rejects('ownership drift is rejected', 'pre', (s) => { s.domain.demo = 87; s.domain.purplelok = 1; });
rejects('Owner invalid is rejected', 'pre', (s) => { s.owner.tokenSessionMatches = 0; });
rejects('Demo Admin invalid is rejected', 'pre', (s) => { s.demoAdmin.expectedRoles = 0; });
rejects('recovery gate is rejected', 'pre', (s) => { s.gates.total = 1; s.gates.recoveryPending = 1; });
rejects('D3 helper ACL drift is rejected', 'after', (s) => { s.d3Functions[0].executeGrantees = ['postgres']; });
rejects('D3 trigger drift is rejected', 'after', (s) => { s.d3Triggers[0].type = 23; });
rejects('partial D3 trigger state is rejected', 'after', (s) => { s.d3Triggers.pop(); });
