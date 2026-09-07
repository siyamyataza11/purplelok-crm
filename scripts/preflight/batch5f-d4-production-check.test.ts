import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  D4_MIGRATION,
  D4_FUNCTIONS,
  DOMAIN_TABLES,
  PERMISSION_KEYS,
  POST_D3_MIGRATIONS,
  ROLE_PERMISSIONS,
  type D4Phase,
  type D4Snapshot,
  type FunctionSnapshot,
  validateD4Snapshot,
} from './batch5f-d4-production-check.js';

const REAL = '2f02d28b-a8f1-48cd-acbc-f47a5bcd1757';
const DEMO = '9e35e50a-8a9f-4fec-b64e-13388a415e10';
const names: Record<string, string> = { owner: 'Owner', admin: 'Admin', finance: 'Finance', project_manager: 'Project Manager', staff: 'Staff', client: 'Client' };

function fn(signature: string, securityDefiner: boolean, authenticated: boolean, result: string, volatility = 's', rowSecurity = 'row_security=off', language = 'plpgsql', strict = false, bodyHash = ''): FunctionSnapshot {
  return { signature, owner: 'postgres', volatility, securityDefiner, result, config: ['search_path=""', rowSecurity], executeGrantees: authenticated ? ['authenticated', 'postgres'] : ['postgres'], language, strict, bodyHash };
}

function fixture(phase: D4Phase): D4Snapshot {
  const identity = { users: 1, emailIdentities: 1, liveSessions: 1, tokenSessionMatches: 1, profiles: 1, memberships: 1, expectedRoles: 1, assignedRoles: 1, clientRoles: 0 };
  const trigger = (name: string, table: string, functionName: string, type: number) => ({ name, table, functionSchema: 'private', functionName, enabled: 'O', type, internal: false });
  return {
    migrations: (phase === 'pre' ? POST_D3_MIGRATIONS : [...POST_D3_MIGRATIONS, D4_MIGRATION]).map(([version, name]) => [version, name]),
    organizations: [{ id: REAL, slug: 'purplelok', status: 'active' }, { id: DEMO, slug: 'purplelok-demo', status: 'active' }],
    permissionKeys: [...PERMISSION_KEYS],
    roles: [REAL, DEMO].flatMap((organizationId) => Object.entries(ROLE_PERMISSIONS).map(([key, permissions]) => ({ organizationId, key, name: names[key], isSystem: true, permissions: [...permissions].sort() }))),
    authority: { clientAssignments: 0, mixedAssignments: 0, malformedPermissions: 0, orphanMappings: 0, platformAdmins: 0 },
    domain: { total: 88, demo: 88, purplelok: 0, nullOwned: 0, orphaned: 0 },
    tenantIntegrity: { validForeignKeys: 22, invalidForeignKeys: 0, childMismatches: 0 },
    policy: { count: 52, hash: 'ce50cde59a1bd0116a593f0db805e1d8', d3Named: 52 },
    rls: DOMAIN_TABLES.map((name) => ({ name, enabled: true, forced: false, owner: 'postgres' })),
    owner: { ...identity }, demoAdmin: { ...identity }, gates: { total: 0, recoveryPending: 0 },
    d1Helpers: [
      fn('private.purplelok_current_session_id()', false, false, 'uuid', 's', 'row_security=on'),
      fn('private.purplelok_has_normal_session()', true, true, 'boolean'), fn('private.purplelok_has_active_membership(uuid)', true, true, 'boolean'),
      fn('private.purplelok_has_permission(uuid,text)', true, true, 'boolean'), fn('private.purplelok_can_access_resource(uuid,text)', false, true, 'boolean', 's', 'row_security=on', 'sql'),
    ],
    d2Functions: [fn('private.purplelok_protect_system_role_identity()', true, false, 'trigger', 'v'), fn('private.purplelok_reject_client_role_assignment()', true, false, 'trigger', 'v'), fn('private.purplelok_restrict_client_permissions()', true, false, 'trigger', 'v')],
    d2Triggers: [trigger('organization_roles_protect_system_identity', 'organization_roles', 'purplelok_protect_system_role_identity', 31), trigger('organization_member_roles_reject_client', 'organization_member_roles', 'purplelok_reject_client_role_assignment', 23), trigger('organization_role_permissions_restrict_client', 'organization_role_permissions', 'purplelok_restrict_client_permissions', 23)],
    d3Functions: [fn('private.purplelok_can_reference_members(uuid,text,uuid[])', true, true, 'boolean', 's', 'row_security=off', 'sql'), fn('private.purplelok_protect_domain_update()', false, false, 'trigger', 'v', 'row_security=on')],
    d3Triggers: DOMAIN_TABLES.map((table) => trigger(`domain_${table}_protect_update`, table, 'purplelok_protect_domain_update', 19)),
    d4Functions: phase === 'pre' ? [] : [
      fn('private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)', false, false, 'uuid', 'v', 'row_security=off', 'plpgsql', false, '7f2fb12b2e52dc48f7a44a1c93127eb9'),
      fn('private.purplelok_protect_payment_insert()', false, false, 'trigger', 'v', 'row_security=off', 'plpgsql', false, '7f974ea113adb5727433fcc18c9fb8ee'),
      fn('public.send_quote(uuid)', true, true, 'TABLE(quote_id uuid, quote_status text)', 'v', 'row_security=off', 'plpgsql', false, 'c26b72f48cdf45e4d7fd4865ce067c0c'),
      fn('public.approve_quote(uuid)', true, true, 'TABLE(quote_id uuid, quote_status text)', 'v', 'row_security=off', 'plpgsql', false, 'cff8ef07560e3a36a02c620074767ea8'),
      fn('public.convert_quote_to_invoice(uuid,text,date,date)', true, true, 'TABLE(invoice_id uuid, invoice_status text)', 'v', 'row_security=off', 'plpgsql', false, '961b5f4e9b5ce3896b17659dfa4bb8d3'),
      fn('public.convert_quote_to_project(uuid)', true, true, 'TABLE(project_id uuid, project_status text)', 'v', 'row_security=off', 'plpgsql', false, '1ab7f6fb3d8eb91cf2409a66227282b1'),
      fn('public.change_lead_stage(uuid,text)', true, true, 'TABLE(lead_id uuid, lead_stage text)', 'v', 'row_security=off', 'plpgsql', false, 'f26a38145da89f1c2bf45f131a4672ee'),
      fn('public.record_payment(uuid,numeric,text,text)', true, true, 'TABLE(payment_id uuid, invoice_id uuid, invoice_status text, amount_paid numeric, balance numeric)', 'v', 'row_security=off', 'plpgsql', false, '9d6674950cd8aee9a493bd4d5fd45350'),
    ],
    d4Triggers: phase === 'pre' ? [] : [trigger('payments_require_protected_workflow', 'payments', 'purplelok_protect_payment_insert', 7)],
    d4Schema: phase === 'pre' ? { indexes: 0, projectColumn: 0, tenantForeignKey: 0, projectSourceQuoteValues: 0 } : { indexes: 3, projectColumn: 1, tenantForeignKey: 1, projectSourceQuoteValues: 0 },
    d4Preconditions: { invoiceQuoteDuplicates: 0, paymentReferenceDuplicates: 0 },
  };
}

function rejects(name: string, phase: D4Phase, mutate: (snapshot: D4Snapshot) => void): void {
  test(name, () => { const snapshot = fixture(phase); mutate(snapshot); assert.throws(() => validateD4Snapshot(snapshot, phase), /Batch 5F-D4 contract failed/); });
}

test('exact post-D3 state passes pre mode', () => assert.doesNotThrow(() => validateD4Snapshot(fixture('pre'), 'pre')));
test('exact post-D4 state passes after mode', () => assert.doesNotThrow(() => validateD4Snapshot(fixture('after'), 'after')));
rejects('only ten migrations is rejected', 'pre', (s) => { s.migrations.pop(); });
rejects('D3 missing is rejected', 'pre', (s) => { s.migrations.splice(-1, 1); });
rejects('partial D4 function state is rejected', 'pre', (s) => { s.d4Functions.push(fixture('after').d4Functions[0]); });
rejects('partial D4 schema state is rejected', 'pre', (s) => { s.d4Schema.indexes = 1; });
rejects('D1 helper drift is rejected', 'pre', (s) => { s.d1Helpers[0].owner = 'authenticated'; });
rejects('D2 function drift is rejected', 'pre', (s) => { s.d2Functions[0].securityDefiner = false; });
rejects('D2 trigger drift is rejected', 'pre', (s) => { s.d2Triggers[0].enabled = 'D'; });
rejects('wrong permission count is rejected', 'pre', (s) => { s.permissionKeys.pop(); });
rejects('wrong role mapping is rejected', 'pre', (s) => { s.roles[0].permissions.pop(); });
rejects('D3 policy count drift is rejected', 'pre', (s) => { s.policy.count = 51; });
rejects('D3 policy hash drift is rejected', 'pre', (s) => { s.policy.hash = 'wrong'; });
rejects('legacy policy residue is rejected', 'pre', (s) => { s.policy.d3Named = 51; });
rejects('D3 helper drift is rejected', 'pre', (s) => { s.d3Functions[0].executeGrantees = ['postgres']; });
rejects('D3 trigger drift is rejected', 'pre', (s) => { s.d3Triggers.pop(); });
rejects('tenant FK drift is rejected', 'pre', (s) => { s.tenantIntegrity.validForeignKeys = 21; });
rejects('tenant child mismatch is rejected', 'pre', (s) => { s.tenantIntegrity.childMismatches = 1; });
rejects('data ownership drift is rejected', 'pre', (s) => { s.domain.demo = 87; s.domain.nullOwned = 1; });
rejects('Owner invalid is rejected', 'pre', (s) => { s.owner.tokenSessionMatches = 0; });
rejects('Demo Admin invalid is rejected', 'pre', (s) => { s.demoAdmin.expectedRoles = 0; });
rejects('recovery gate is rejected', 'pre', (s) => { s.gates.total = 1; });
rejects('missing D4 RPC is rejected', 'after', (s) => { s.d4Functions.pop(); });
rejects('extra D4 RPC overload is rejected', 'after', (s) => { s.d4Functions.push({ ...s.d4Functions[2], signature: 'public.send_quote(text)' }); });
rejects('wrong D4 signature is rejected', 'after', (s) => { s.d4Functions[2].signature = 'public.send_quote(text)'; });
rejects('wrong D4 owner is rejected', 'after', (s) => { s.d4Functions[2].owner = 'authenticated'; });
rejects('D4 SECURITY DEFINER drift is rejected', 'after', (s) => { s.d4Functions[2].securityDefiner = false; });
rejects('D4 search_path drift is rejected', 'after', (s) => { s.d4Functions[2].config = ['row_security=off']; });
rejects('D4 ACL drift is rejected', 'after', (s) => { s.d4Functions[2].executeGrantees.push('PUBLIC'); });
rejects('D4 row_security drift is rejected', 'after', (s) => { s.d4Functions[2].config[1] = 'row_security=on'; });
rejects('D4 language drift is rejected', 'after', (s) => { s.d4Functions[2].language = 'sql'; });
rejects('D4 STRICT drift is rejected', 'after', (s) => { s.d4Functions[2].strict = true; });
rejects('D4 body drift is rejected', 'after', (s) => { s.d4Functions[2].bodyHash = 'wrong'; });
rejects('missing private activity helper is rejected', 'after', (s) => { s.d4Functions.shift(); });
rejects('payment guard trigger drift is rejected', 'after', (s) => { s.d4Triggers[0].type = 23; });
rejects('D4 index drift is rejected', 'after', (s) => { s.d4Schema.indexes = 2; });
rejects('D4 column drift is rejected', 'after', (s) => { s.d4Schema.projectColumn = 0; });
rejects('D4 composite FK drift is rejected', 'after', (s) => { s.d4Schema.tenantForeignKey = 0; });
rejects('D4 invoice uniqueness precondition drift is rejected', 'pre', (s) => { s.d4Preconditions.invoiceQuoteDuplicates = 1; });
rejects('D4 payment uniqueness precondition drift is rejected', 'pre', (s) => { s.d4Preconditions.paymentReferenceDuplicates = 1; });
rejects('unexpected source quote data is rejected', 'after', (s) => { s.d4Schema.projectSourceQuoteValues = 1; });

test('D1-D4 migrations and frontend workflow signatures remain compatible', () => {
  const d1 = readFileSync('supabase/migrations/20260903120000_batch_5f_d1_authorization_foundation.sql', 'utf8');
  const d2 = readFileSync('supabase/migrations/20260903180000_batch_5f_d2_permission_catalogue.sql', 'utf8');
  const d3 = readFileSync('supabase/migrations/20260904120000_batch_5f_d3_domain_rls_cutover.sql', 'utf8');
  const d4 = readFileSync('supabase/migrations/20260904180000_batch_5f_d4_protected_workflows.sql', 'utf8');
  const frontend = readFileSync('src/lib/protected-workflows.ts', 'utf8');
  assert.match(d1, /CREATE FUNCTION private\.purplelok_has_permission/);
  for (const permission of ['quotes.write', 'quotes.approve', 'invoices.write', 'projects.write', 'leads.write', 'payments.record']) assert.match(d2, new RegExp(`'${permission.replace('.', '\\.')}'`));
  assert.match(d3, /private\.purplelok_can_access_resource/);
  assert.match(d3, /private\.purplelok_can_reference_members/);
  for (const rpc of ['record_payment', 'send_quote', 'approve_quote', 'convert_quote_to_invoice', 'convert_quote_to_project', 'change_lead_stage']) {
    assert.match(d4, new RegExp(`CREATE FUNCTION public\\.${rpc}\\(`));
    assert.match(frontend, new RegExp(`['"]${rpc}['"]`));
  }
  assert.match(d4, /^BEGIN;/m);
  assert.match(d4, /COMMIT;\s*$/);
});

test('D4 function-body fingerprints derive from the canonical migration', () => {
  const sql = readFileSync('supabase/migrations/20260904180000_batch_5f_d4_protected_workflows.sql', 'utf8');
  const matches = [...sql.matchAll(/CREATE FUNCTION\s+((?:public|private)\.[^(]+)\s*\(([^)]*)\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/g)];
  assert.equal(matches.length, 8);
  const hashes = matches.map((match) => createHash('md5').update((match[3] ?? '').replace(/\s+/g, ' ').trim()).digest('hex')).sort();
  assert.deepEqual(hashes, D4_FUNCTIONS.map((contract) => contract[8]).sort());
});
