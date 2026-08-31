import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANONICAL_SEED_TIMESTAMP,
  DOMAIN_TABLES,
  INCIDENT_ACTIVITIES,
  LEAD_REPAIRS,
  asMicrosecondTimestamp,
  buildDomainDriftRepairPlan,
  executeDomainDriftRepair,
  type ActivityFingerprint,
  type DomainDriftRepairRepository,
  type LeadRepair,
  type RepairSnapshot,
  type TriggerSnapshot,
} from './batch5a-domain-drift-repair.js';
import { parseRepairArgs } from './batch5a-domain-drift-repair-runner.js';

const DEMO_ID = 'demo-organization';
const REAL_ID = 'real-organization';

const trigger = (enabled = 'O'): TriggerSnapshot => ({
  tableSchema: 'public', tableName: 'leads', tableOid: '1200', triggerOid: '1300',
  triggerName: 'touch_leads', enabled, internal: false, type: 19,
  functionOid: '1400', functionSchema: 'public', functionName: 'touch_updated_at',
  definition: 'CREATE TRIGGER touch_leads BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
  qualification: null, arguments: '', oldTable: null, newTable: null,
});

function incidentDifferences() {
  return [
    ...INCIDENT_ACTIVITIES.map(() => ({ direction: 'live_only' as const, tableName: 'activities', stableKey: 'lead_stage_change' })),
    ...LEAD_REPAIRS.flatMap((lead) => [
      { direction: 'expected_only' as const, tableName: 'leads', stableKey: lead.companyName },
      { direction: 'live_only' as const, tableName: 'leads', stableKey: lead.companyName },
    ]),
  ];
}

function incidentSnapshot(overrides: Partial<RepairSnapshot> = {}): RepairSnapshot {
  const nullRowsByTable = Object.fromEntries(DOMAIN_TABLES.map((table) => [table, table === 'activities' ? 8 : 0]));
  return {
    demoOrganizationId: DEMO_ID,
    realOrganizationId: REAL_ID,
    totals: { total: 96, demo: 88, real: 0, nullOwned: 8 },
    nullRowsByTable,
    activities: INCIDENT_ACTIVITIES.map((activity) => ({
      ...activity, organizationId: null, type: 'lead_stage_change', entity: 'lead', metadata: {},
    })),
    leads: LEAD_REPAIRS.map((lead) => {
      const material = [...lead.canonicalMaterial];
      material[5] = lead.currentStage;
      return {
        id: lead.id, companyName: lead.companyName, organizationId: DEMO_ID,
        stage: lead.currentStage, createdAt: CANONICAL_SEED_TIMESTAMP,
        updatedAt: lead.currentUpdatedAt, material,
      };
    }),
    manifestDifferences: incidentDifferences(),
    triggers: [trigger()],
    authorityFingerprint: 'approved-authority',
    permissionCount: 28,
    platformAdminCount: 0,
    clientAssignmentCount: 0,
    tenantConstraintCount: 22,
    validTenantConstraintCount: 22,
    ...overrides,
  };
}

class MemoryRepository implements DomainDriftRepairRepository {
  state: RepairSnapshot;
  triggerState = trigger();
  writes: string[] = [];
  deletedTimestampParameters: string[] = [];
  updatedTimestampParameters: Array<{ current: string; canonical: string }> = [];
  manifestAssertions = 0;

  constructor(snapshot = incidentSnapshot()) { this.state = structuredClone(snapshot); }

  async loadSnapshot(): Promise<RepairSnapshot> {
    return structuredClone({ ...this.state, triggers: [this.triggerState] });
  }
  async loadTouchLeadsTrigger(): Promise<readonly TriggerSnapshot[]> { return [structuredClone(this.triggerState)]; }
  async disableTouchLeads(): Promise<void> { this.triggerState = trigger('D'); }
  async enableTouchLeads(): Promise<void> { this.triggerState = trigger('O'); }
  async deleteActivity(activity: ActivityFingerprint): Promise<number> {
    this.deletedTimestampParameters.push(activity.createdAt);
    const before = this.state.activities.length;
    this.state = { ...this.state, activities: this.state.activities.filter((row) => row.id !== activity.id) };
    const affected = before - this.state.activities.length;
    if (affected === 1) this.writes.push(`delete:${activity.id}`);
    this.cleanIfComplete();
    return affected;
  }
  async updateLead(repair: LeadRepair, demoOrganizationId: string): Promise<number> {
    this.updatedTimestampParameters.push({
      current: repair.currentUpdatedAt,
      canonical: CANONICAL_SEED_TIMESTAMP,
    });
    let affected = 0;
    const leads = this.state.leads.map((lead) => {
      if (lead.id !== repair.id || lead.organizationId !== demoOrganizationId || lead.stage !== repair.currentStage || lead.updatedAt !== repair.currentUpdatedAt) return lead;
      affected += 1;
      const material = [...lead.material];
      material[5] = repair.canonicalStage;
      return { ...lead, stage: repair.canonicalStage, updatedAt: CANONICAL_SEED_TIMESTAMP, material };
    });
    this.state = { ...this.state, leads };
    if (affected === 1) this.writes.push(`update:${repair.id}:stage+updated_at`);
    this.cleanIfComplete();
    return affected;
  }
  async assertSeedManifest(): Promise<void> {
    this.manifestAssertions += 1;
    assert.equal(this.state.manifestDifferences.length, 0);
  }
  private cleanIfComplete(): void {
    const leadsClean = this.state.leads.every((lead) => {
      const repair = LEAD_REPAIRS.find((item) => item.id === lead.id)!;
      return lead.stage === repair.canonicalStage && lead.updatedAt === CANONICAL_SEED_TIMESTAMP;
    });
    if (this.state.activities.length === 0 && leadsClean) {
      this.state = {
        ...this.state,
        totals: { total: 88, demo: 88, real: 0, nullOwned: 0 },
        nullRowsByTable: Object.fromEntries(DOMAIN_TABLES.map((table) => [table, 0])),
        manifestDifferences: [],
      };
    }
  }
}

test('default CLI mode is dry-run and explicit apply is required', () => {
  assert.deepEqual(parseRepairArgs([]), { apply: false, help: false });
  assert.deepEqual(parseRepairArgs(['--apply']), { apply: true, help: false });
  assert.throws(() => parseRepairArgs(['--apply', '--dry-run']));
});

test('exact incident plans eight deletes and three stage/updated_at updates', () => {
  const plan = buildDomainDriftRepairPlan(incidentSnapshot());
  assert.equal(plan.pendingWrites, 11);
  assert.equal(plan.activitiesToDelete.length, 8);
  assert.equal(plan.leadsToUpdate.length, 3);
});

test('canonical timestamp comparison preserves all six fractional digits', () => {
  assert.equal(CANONICAL_SEED_TIMESTAMP, '2026-07-28T11:10:47.436796Z');
  assert.notEqual(
    CANONICAL_SEED_TIMESTAMP,
    asMicrosecondTimestamp('2026-07-28T11:10:47.436000Z'),
  );
  assert.equal(INCIDENT_ACTIVITIES[0].createdAt, '2026-08-30T23:18:55.676770Z');
  assert.equal(INCIDENT_ACTIVITIES[6].createdAt, '2026-08-30T23:19:10.890670Z');
});

test('JavaScript Date and millisecond-only text cannot enter timestamp fingerprints', () => {
  assert.throws(
    () => asMicrosecondTimestamp(new Date('2026-07-28T11:10:47.436Z')),
    /JavaScript Date values are forbidden/,
  );
  assert.throws(
    () => asMicrosecondTimestamp('2026-07-28T11:10:47.436Z'),
    /exactly six fractional digits/,
  );
});

test('one-microsecond lead or activity mismatch fails closed while exact precision succeeds', () => {
  const exact = incidentSnapshot();
  assert.equal(buildDomainDriftRepairPlan(exact).pendingWrites, 11);

  assert.throws(() => buildDomainDriftRepairPlan({
    ...exact,
    leads: exact.leads.map((lead, index) => index === 0
      ? { ...lead, createdAt: asMicrosecondTimestamp('2026-07-28T11:10:47.436795Z') }
      : lead),
  }), /Lead identity\/tenant\/timestamp mismatch/);

  assert.throws(() => buildDomainDriftRepairPlan({
    ...exact,
    activities: exact.activities.map((activity, index) => index === 0
      ? { ...activity, createdAt: asMicrosecondTimestamp('2026-08-30T23:18:55.676771Z') }
      : activity),
  }), /Activity fingerprint mismatch/);
});

test('dry run performs zero writes', async () => {
  const repository = new MemoryRepository();
  const result = await executeDomainDriftRepair(repository, false);
  assert.equal(result.writes, 0);
  assert.deepEqual(repository.writes, []);
  assert.equal(repository.manifestAssertions, 0);
});

test('apply deletes eight, updates only stage plus updated_at, restores trigger, and verifies manifest', async () => {
  const repository = new MemoryRepository();
  const result = await executeDomainDriftRepair(repository, true);
  assert.equal(result.writes, 11);
  assert.equal(repository.writes.filter((entry) => entry.startsWith('delete:')).length, 8);
  assert.equal(repository.writes.filter((entry) => entry.endsWith(':stage+updated_at')).length, 3);
  assert.deepEqual(repository.triggerState, trigger());
  assert.equal(repository.manifestAssertions, 1);
  assert.equal(result.finalPlan?.pendingWrites, 0);
  assert.deepEqual(
    repository.deletedTimestampParameters,
    INCIDENT_ACTIVITIES.map((activity) => activity.createdAt),
  );
  assert.deepEqual(
    repository.updatedTimestampParameters,
    LEAD_REPAIRS.map((lead) => ({
      current: lead.currentUpdatedAt,
      canonical: CANONICAL_SEED_TIMESTAMP,
    })),
  );
});

test('second run is an idempotent zero-change plan', async () => {
  const repository = new MemoryRepository();
  await executeDomainDriftRepair(repository, true);
  const second = await executeDomainDriftRepair(repository, false);
  assert.equal(second.initialPlan.pendingWrites, 0);
  assert.equal(repository.writes.length, 11);
});

test('ninth NULL activity fails closed', () => {
  const state = incidentSnapshot();
  assert.throws(() => buildDomainDriftRepairPlan({
    ...state,
    totals: { ...state.totals, total: 97, nullOwned: 9 },
    nullRowsByTable: { ...state.nullRowsByTable, activities: 9 },
    activities: [...state.activities, { ...state.activities[0], id: 'ninth' }],
  }), /neither the exact incident nor canonical clean state/);
});

test('altered activity UUID or fingerprint fails closed', () => {
  const state = incidentSnapshot();
  assert.throws(() => buildDomainDriftRepairPlan({
    ...state,
    activities: state.activities.map((row, index) => index === 0 ? { ...row, id: 'forged' } : row),
  }), /fingerprinted activity/);
});

test('unexpected lead stage, extra material drift, or real-tenant row fails closed', () => {
  const state = incidentSnapshot();
  assert.throws(() => buildDomainDriftRepairPlan({ ...state, leads: state.leads.map((lead, index) => index === 0 ? { ...lead, stage: 'won' } : lead) }), /Lead stage/);
  const material = [...state.leads[0].material]; material[1] = 'Changed contact';
  assert.throws(() => buildDomainDriftRepairPlan({ ...state, leads: state.leads.map((lead, index) => index === 0 ? { ...lead, material } : lead) }), /Non-stage material/);
  assert.throws(() => buildDomainDriftRepairPlan({ ...state, totals: { ...state.totals, real: 1 } }), /neither the exact incident/);
});

test('unexpected manifest drift fails closed', () => {
  const state = incidentSnapshot();
  assert.throws(() => buildDomainDriftRepairPlan({
    ...state,
    manifestDifferences: [...state.manifestDifferences, { direction: 'live_only', tableName: 'clients', stableKey: 'Unexpected' }],
  }), /exactly 14/);
});

test('disabled, rebound, or structurally changed touch trigger fails closed', () => {
  const state = incidentSnapshot();
  assert.throws(() => buildDomainDriftRepairPlan({ ...state, triggers: [trigger('D')] }), /approved ordinary/);
  assert.throws(() => buildDomainDriftRepairPlan({ ...state, triggers: [{ ...trigger(), functionName: 'other' }] }), /approved ordinary/);
  assert.throws(() => buildDomainDriftRepairPlan({ ...state, triggers: [{ ...trigger(), type: 17 }] }), /approved ordinary/);
});

test('restoration mismatch fails before manifest verification', async () => {
  const repository = new MemoryRepository();
  repository.enableTouchLeads = async () => { repository.triggerState = { ...trigger(), definition: 'changed' }; };
  await assert.rejects(() => executeDomainDriftRepair(repository, true), /catalog state was not restored exactly/);
  assert.equal(repository.manifestAssertions, 0);
});
