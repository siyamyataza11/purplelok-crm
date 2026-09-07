import assert from 'node:assert/strict';
import test from 'node:test';
import {
  D2_MIGRATION,
  POST_D1_MIGRATIONS,
  POST_D2_PERMISSION_KEYS,
  PRE_D2_PERMISSION_KEYS,
  type D2Phase,
  type D2Snapshot,
  type FunctionSnapshot,
  validateD2Snapshot,
} from './batch5f-d2-production-check.js';

const PURPLELOK_ID = '2f02d28b-a8f1-48cd-acbc-f47a5bcd1757';
const DEMO_ID = '9e35e50a-8a9f-4fec-b64e-13388a415e10';
const TABLES = ['activities', 'channels', 'client_contacts', 'client_notes', 'clients', 'documents', 'invoice_items', 'invoices', 'leads', 'meetings', 'messages', 'notifications', 'payments', 'project_milestones', 'projects', 'quote_items', 'quotes', 'task_comments', 'tasks', 'ticket_messages', 'tickets'];
const legacyPermissions = ['clients.read', 'clients.write', 'documents.read', 'documents.write', 'invoices.approve', 'invoices.read', 'invoices.write', 'leads.read', 'leads.write', 'members.manage', 'members.read', 'payments.read', 'payments.record', 'projects.manage', 'projects.read', 'projects.write', 'quotes.approve', 'quotes.read', 'quotes.write', 'reports.read', 'roles.manage', 'roles.read', 'settings.manage', 'settings.read', 'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write'];
const finalPermissions = ['activities.read', 'clients.read', 'clients.write', 'collaboration.manage', 'collaboration.read', 'collaboration.write', 'documents.read', 'documents.write', 'invoices.approve', 'invoices.read', 'invoices.write', 'leads.read', 'leads.write', 'members.manage', 'members.read', 'payments.read', 'payments.record', 'projects.manage', 'projects.read', 'projects.write', 'quotes.approve', 'quotes.read', 'quotes.write', 'reports.read', 'roles.manage', 'roles.read', 'settings.manage', 'settings.read', 'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write'];

const preMappings: Record<string, string[]> = {
  owner: [...legacyPermissions], admin: [...legacyPermissions],
  finance: ['clients.read', 'documents.read', 'invoices.approve', 'invoices.read', 'invoices.write', 'members.read', 'payments.read', 'payments.record', 'projects.read', 'quotes.approve', 'quotes.read', 'quotes.write', 'reports.read'],
  project_manager: ['clients.read', 'documents.read', 'documents.write', 'members.read', 'projects.manage', 'projects.read', 'projects.write', 'reports.read', 'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write'],
  staff: ['clients.read', 'documents.read', 'documents.write', 'members.read', 'projects.read', 'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write'],
  client: ['documents.read', 'invoices.read', 'projects.read', 'quotes.read', 'tickets.read', 'tickets.write'],
};

const postMappings: Record<string, string[]> = {
  owner: [...finalPermissions], admin: [...finalPermissions],
  finance: ['clients.read', 'collaboration.read', 'collaboration.write', 'documents.read', 'invoices.approve', 'invoices.read', 'invoices.write', 'members.read', 'payments.read', 'payments.record', 'projects.read', 'quotes.approve', 'quotes.read', 'quotes.write', 'reports.read', 'settings.read'],
  project_manager: ['clients.read', 'collaboration.read', 'collaboration.write', 'documents.read', 'documents.write', 'members.read', 'projects.manage', 'projects.read', 'projects.write', 'reports.read', 'settings.read', 'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write'],
  staff: ['clients.read', 'collaboration.read', 'collaboration.write', 'documents.read', 'documents.write', 'members.read', 'projects.read', 'settings.read', 'tasks.read', 'tasks.write', 'tickets.read', 'tickets.write'],
  client: ['documents.read', 'invoices.read', 'projects.read', 'quotes.read', 'tickets.read', 'tickets.write'],
};

const roleNames: Record<string, string> = { owner: 'Owner', admin: 'Admin', finance: 'Finance', project_manager: 'Project Manager', staff: 'Staff', client: 'Client' };

function d1Helper(signature: string, securityDefiner: boolean, authenticated: boolean, result: string, rowSecurity: string): FunctionSnapshot {
  return { signature, owner: 'postgres', volatility: 's', securityDefiner, result, config: ['search_path=""', rowSecurity], executeGrantees: authenticated ? ['authenticated', 'postgres'] : ['postgres'] };
}

function d2Function(signature: string): FunctionSnapshot {
  return { signature, owner: 'postgres', volatility: 'v', securityDefiner: true, result: 'trigger', config: ['search_path=""', 'row_security=off'], executeGrantees: ['postgres'] };
}

function fixture(phase: D2Phase): D2Snapshot {
  const mappings = phase === 'pre' ? preMappings : postMappings;
  return {
    migrations: (phase === 'pre' ? POST_D1_MIGRATIONS : [...POST_D1_MIGRATIONS, D2_MIGRATION]).map(([version, name]) => [version, name]),
    organizations: [
      { id: PURPLELOK_ID, slug: 'purplelok', status: 'active' },
      { id: DEMO_ID, slug: 'purplelok-demo', status: 'active' },
    ],
    permissionKeys: [...(phase === 'pre' ? legacyPermissions : finalPermissions)],
    roles: [PURPLELOK_ID, DEMO_ID].flatMap((organizationId) => Object.entries(mappings).map(([key, permissions]) => ({ organizationId, key, name: roleNames[key], isSystem: true, permissions: [...permissions] }))),
    authority: { clientAssignments: 0, mixedAssignments: 0, malformedPermissions: 0, orphanMappings: 0, platformAdmins: 0 },
    domain: { total: 88, demo: 88, purplelok: 0, nullOwned: 0, orphaned: 0 },
    policy: { count: 84, hash: 'eb744436bf76a7cc18e32b06734b5478' },
    rls: TABLES.map((name) => ({ name, enabled: true, forced: false, owner: 'postgres' })),
    owner: { users: 1, emailIdentities: 1, sessions: 1, correlatedSessions: 1, profiles: 1, memberships: 1, ownerRoles: 1, assignedRoles: 1, clientRoles: 0, gates: 0, recoveryPending: 0 },
    d1Helpers: [
      d1Helper('private.purplelok_current_session_id()', false, false, 'uuid', 'row_security=on'),
      d1Helper('private.purplelok_has_normal_session()', true, true, 'boolean', 'row_security=off'),
      d1Helper('private.purplelok_has_active_membership(uuid)', true, true, 'boolean', 'row_security=off'),
      d1Helper('private.purplelok_has_permission(uuid,text)', true, true, 'boolean', 'row_security=off'),
      d1Helper('private.purplelok_can_access_resource(uuid,text)', false, true, 'boolean', 'row_security=on'),
    ],
    d2Functions: phase === 'pre' ? [] : [
      d2Function('private.purplelok_protect_system_role_identity()'),
      d2Function('private.purplelok_reject_client_role_assignment()'),
      d2Function('private.purplelok_restrict_client_permissions()'),
    ],
    d2Triggers: phase === 'pre' ? [] : [
      { name: 'organization_roles_protect_system_identity', table: 'organization_roles', functionSchema: 'private', functionName: 'purplelok_protect_system_role_identity', enabled: 'O', type: 31, internal: false },
      { name: 'organization_member_roles_reject_client', table: 'organization_member_roles', functionSchema: 'private', functionName: 'purplelok_reject_client_role_assignment', enabled: 'O', type: 23, internal: false },
      { name: 'organization_role_permissions_restrict_client', table: 'organization_role_permissions', functionSchema: 'private', functionName: 'purplelok_restrict_client_permissions', enabled: 'O', type: 23, internal: false },
    ],
    laterObjects: 0,
  };
}

function rejects(name: string, phase: D2Phase, mutate: (snapshot: D2Snapshot) => void): void {
  test(name, () => {
    const snapshot = structuredClone(fixture(phase));
    mutate(snapshot);
    assert.throws(() => validateD2Snapshot(snapshot, phase), /Batch 5F-D2 contract failed:/u);
  });
}

test('pre accepts only exact post-D1 pre-D2 state', () => assert.doesNotThrow(() => validateD2Snapshot(fixture('pre'), 'pre')));
test('after accepts only exact post-D2 state', () => assert.doesNotThrow(() => validateD2Snapshot(fixture('after'), 'after')));
test('checker pre-D2 catalogue is the frozen independent 28-key set', () => assert.deepEqual([...PRE_D2_PERMISSION_KEYS], legacyPermissions));
test('checker post-D2 catalogue is the frozen independent 32-key set', () => assert.deepEqual([...POST_D2_PERMISSION_KEYS], finalPermissions));
rejects('pre rejects the eight-migration pre-D1 state', 'pre', (state) => { state.migrations.pop(); });
rejects('pre rejects a missing D1 helper', 'pre', (state) => { state.d1Helpers.pop(); });
rejects('pre rejects a partially applied D2 function', 'pre', (state) => { state.d2Functions.push(d2Function('private.purplelok_protect_system_role_identity()')); });
const futurePermissions = ['activities.read', 'collaboration.read', 'collaboration.write', 'collaboration.manage'];
for (const count of [29, 30, 31]) rejects(`pre rejects ${count} permissions`, 'pre', (state) => { state.permissionKeys.push(...futurePermissions.slice(0, count - 28)); state.permissionKeys.sort(); });
rejects('after rejects 33 or more permissions', 'after', (state) => { state.permissionKeys.push('unknown.permission'); state.permissionKeys.sort(); });
rejects('pre rejects an unknown permission with the expected count', 'pre', (state) => { state.permissionKeys[state.permissionKeys.length - 1] = 'unknown.permission'; state.permissionKeys.sort(); });
rejects('pre rejects a wrong role mapping count', 'pre', (state) => { state.roles[0].permissions.pop(); });
rejects('pre rejects a Client assignment', 'pre', (state) => { state.authority.clientAssignments = 1; });
rejects('pre rejects a mixed Client and internal assignment', 'pre', (state) => { state.authority.mixedAssignments = 1; });
rejects('pre rejects a malformed permission', 'pre', (state) => { state.authority.malformedPermissions = 1; });
rejects('pre rejects an orphan role-permission mapping', 'pre', (state) => { state.authority.orphanMappings = 1; });
rejects('pre rejects an active platform administrator', 'pre', (state) => { state.authority.platformAdmins = 1; });
rejects('pre rejects a missing Owner live session', 'pre', (state) => { state.owner.sessions = 0; state.owner.correlatedSessions = 0; });
rejects('pre rejects a broadened D1 helper ACL', 'pre', (state) => { state.d1Helpers[0].executeGrantees.push('authenticated'); state.d1Helpers[0].executeGrantees.sort(); });
rejects('after rejects a missing D2 protection function', 'after', (state) => { state.d2Functions.pop(); });
rejects('after rejects a wrong D2 trigger binding', 'after', (state) => { state.d2Triggers[0].functionName = 'unexpected_function'; });
rejects('pre rejects 83 policies', 'pre', (state) => { state.policy.count = 83; });
rejects('pre rejects 85 policies', 'pre', (state) => { state.policy.count = 85; });
rejects('pre rejects the wrong policy hash', 'pre', (state) => { state.policy.hash = '00000000000000000000000000000000'; });
rejects('pre rejects changed RLS flags', 'pre', (state) => { state.rls[0].forced = true; });
rejects('pre rejects domain ownership drift', 'pre', (state) => { state.domain.demo = 87; state.domain.nullOwned = 1; });
rejects('pre rejects a recovery gate', 'pre', (state) => { state.owner.gates = 1; state.owner.recoveryPending = 1; });
rejects('pre rejects D3 or D4 objects', 'pre', (state) => { state.laterObjects = 1; });
