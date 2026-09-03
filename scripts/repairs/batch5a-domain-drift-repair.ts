export class DomainDriftRepairConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainDriftRepairConflictError';
  }
}

declare const microsecondTimestampBrand: unique symbol;
export type MicrosecondTimestamp = string & { readonly [microsecondTimestampBrand]: true };

const MICROSECOND_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function asMicrosecondTimestamp(value: unknown, label = 'timestamp'): MicrosecondTimestamp {
  if (typeof value !== 'string' || !MICROSECOND_TIMESTAMP_PATTERN.test(value)) {
    throw new DomainDriftRepairConflictError(
      `${label} must be canonical UTC text with exactly six fractional digits; JavaScript Date values are forbidden`,
    );
  }
  return value as MicrosecondTimestamp;
}

export const CANONICAL_SEED_TIMESTAMP = asMicrosecondTimestamp(
  '2026-07-28T11:10:47.436796Z',
  'canonical seed timestamp',
);
export const REAL_OWNER_USER_ID = 'dc62be87-fe6a-4b3f-8a6c-a875ffe36a9c';

export const DOMAIN_TABLES = [
  'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
  'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
  'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
  'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
  'messages',
] as const;

export interface ActivityFingerprint {
  readonly id: string;
  readonly userId: string;
  readonly entityId: string;
  readonly description: string;
  readonly createdAt: MicrosecondTimestamp;
}

export const INCIDENT_ACTIVITIES: readonly ActivityFingerprint[] = [
  { id: '01aaea98-f1ef-4b2d-8cc2-427bc3fb2df3', userId: REAL_OWNER_USER_ID, entityId: '90dda8b5-b0e2-4860-984b-8bfeac4f0e04', description: 'moved lead "Pinnacle Properties" to contacted', createdAt: asMicrosecondTimestamp('2026-08-30T23:18:55.676770Z') },
  { id: 'ea2dcfda-4e66-406c-ac91-371e84bb3646', userId: REAL_OWNER_USER_ID, entityId: '90dda8b5-b0e2-4860-984b-8bfeac4f0e04', description: 'moved lead "Pinnacle Properties" to proposal sent', createdAt: asMicrosecondTimestamp('2026-08-30T23:18:57.528237Z') },
  { id: '4425f1ba-75aa-4a76-8793-429bcdd172d7', userId: REAL_OWNER_USER_ID, entityId: '90dda8b5-b0e2-4860-984b-8bfeac4f0e04', description: 'moved lead "Pinnacle Properties" to negotiating', createdAt: asMicrosecondTimestamp('2026-08-30T23:18:59.885458Z') },
  { id: '07fe72ff-6339-4063-ae22-48c345c665e7', userId: REAL_OWNER_USER_ID, entityId: '90dda8b5-b0e2-4860-984b-8bfeac4f0e04', description: 'moved lead "Pinnacle Properties" to proposal sent', createdAt: asMicrosecondTimestamp('2026-08-30T23:19:02.082803Z') },
  { id: 'd79d94f7-3166-470a-918b-426993c15e16', userId: REAL_OWNER_USER_ID, entityId: '90dda8b5-b0e2-4860-984b-8bfeac4f0e04', description: 'moved lead "Pinnacle Properties" to negotiating', createdAt: asMicrosecondTimestamp('2026-08-30T23:19:03.468358Z') },
  { id: '26fa57be-f448-496d-a5da-793d35f1772b', userId: REAL_OWNER_USER_ID, entityId: '714bc429-bd01-4f14-8f41-32b7e0fef7ef', description: 'moved lead "Vertex Architects" to negotiating', createdAt: asMicrosecondTimestamp('2026-08-30T23:19:06.093176Z') },
  { id: 'f6fb002e-f32e-47b6-b79f-f6faa8bf051d', userId: REAL_OWNER_USER_ID, entityId: '90dda8b5-b0e2-4860-984b-8bfeac4f0e04', description: 'moved lead "Pinnacle Properties" to proposal sent', createdAt: asMicrosecondTimestamp('2026-08-30T23:19:10.890670Z') },
  { id: 'ec098549-1f8d-45bd-9df7-62dea6a5892d', userId: REAL_OWNER_USER_ID, entityId: 'de1375a8-0c20-4a16-8480-4b427268fed5', description: 'moved lead "Metro Health Clinic" to new lead', createdAt: asMicrosecondTimestamp('2026-08-30T23:19:12.795277Z') },
] as const;

export interface LeadRepair {
  readonly id: string;
  readonly companyName: string;
  readonly currentStage: string;
  readonly canonicalStage: string;
  readonly currentUpdatedAt: MicrosecondTimestamp;
  readonly canonicalMaterial: readonly unknown[];
}

export const LEAD_REPAIRS: readonly LeadRepair[] = [
  {
    id: 'de1375a8-0c20-4a16-8480-4b427268fed5', companyName: 'Metro Health Clinic',
    currentStage: 'new_lead', canonicalStage: 'negotiating',
    currentUpdatedAt: asMicrosecondTimestamp('2026-08-30T23:19:12.486906Z'),
    canonicalMaterial: ['Metro Health Clinic', 'Dr. Linda Mthembu', 'linda@metrohealth.co.za', '+27 11 444 5555', 'Google Ads', 'negotiating', 85, 95000, '2026-08-05', 'Health clinic — website, SEO, and ongoing maintenance.', '148803f0-322b-408e-9ffc-c9ce486172a6', null],
  },
  {
    id: '90dda8b5-b0e2-4860-984b-8bfeac4f0e04', companyName: 'Pinnacle Properties',
    currentStage: 'proposal_sent', canonicalStage: 'new_lead',
    currentUpdatedAt: asMicrosecondTimestamp('2026-08-30T23:19:10.580572Z'),
    canonicalMaterial: ['Pinnacle Properties', 'John Matthews', 'john@pinnacleprop.co.za', '+27 11 111 2222', 'Referral', 'new_lead', 75, 85000, '2026-08-15', 'Large property group — needs full website redesign and branding.', '148803f0-322b-408e-9ffc-c9ce486172a6', null],
  },
  {
    id: '714bc429-bd01-4f14-8f41-32b7e0fef7ef', companyName: 'Vertex Architects',
    currentStage: 'negotiating', canonicalStage: 'proposal_sent',
    currentUpdatedAt: asMicrosecondTimestamp('2026-08-30T23:19:05.733650Z'),
    canonicalMaterial: ['Vertex Architects', 'Robert Smith', 'robert@vertexarch.co.za', '+27 31 333 4444', 'LinkedIn', 'proposal_sent', 80, 120000, '2026-08-10', 'Architecture firm — branding, website, and printing package.', '148803f0-322b-408e-9ffc-c9ce486172a6', null],
  },
] as const;

export interface TriggerSnapshot {
  readonly tableSchema: string;
  readonly tableName: string;
  readonly tableOid: string;
  readonly triggerOid: string;
  readonly triggerName: string;
  readonly enabled: string;
  readonly internal: boolean;
  readonly type: number;
  readonly functionOid: string;
  readonly functionSchema: string;
  readonly functionName: string;
  readonly definition: string;
  readonly qualification: string | null;
  readonly arguments: string;
  readonly oldTable: string | null;
  readonly newTable: string | null;
}

export interface LeadState {
  readonly id: string;
  readonly companyName: string;
  readonly organizationId: string;
  readonly stage: string;
  readonly createdAt: MicrosecondTimestamp;
  readonly updatedAt: MicrosecondTimestamp;
  readonly material: readonly unknown[];
}

export interface ActivityState extends ActivityFingerprint {
  readonly organizationId: string | null;
  readonly type: string;
  readonly entity: string;
  readonly metadata: unknown;
}

export interface ManifestDifference {
  readonly direction: 'expected_only' | 'live_only';
  readonly tableName: string;
  readonly stableKey: string;
}

export interface RepairSnapshot {
  readonly demoOrganizationId: string;
  readonly realOrganizationId: string;
  readonly totals: { readonly total: number; readonly demo: number; readonly real: number; readonly nullOwned: number };
  readonly nullRowsByTable: Readonly<Record<string, number>>;
  readonly activities: readonly ActivityState[];
  readonly leads: readonly LeadState[];
  readonly manifestDifferences: readonly ManifestDifference[];
  readonly triggers: readonly TriggerSnapshot[];
  readonly authorityFingerprint: string;
  readonly permissionCount: number;
  readonly platformAdminCount: number;
  readonly clientAssignmentCount: number;
  readonly tenantConstraintCount: number;
  readonly validTenantConstraintCount: number;
}

export interface RepairPlan {
  readonly state: 'incident' | 'clean';
  readonly activitiesToDelete: readonly ActivityFingerprint[];
  readonly leadsToUpdate: readonly LeadRepair[];
  readonly pendingWrites: number;
}

function fail(message: string): never {
  throw new DomainDriftRepairConflictError(message);
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
}

function assertTriggerBaseline(triggers: readonly TriggerSnapshot[]): void {
  if (triggers.length !== 1) fail(`Expected exactly one public.leads.touch_leads trigger; found ${triggers.length}`);
  const trigger = triggers[0];
  if (trigger.tableSchema !== 'public' || trigger.tableName !== 'leads' || trigger.triggerName !== 'touch_leads' ||
      trigger.enabled !== 'O' || trigger.internal || trigger.type !== 19 ||
      trigger.functionSchema !== 'public' || trigger.functionName !== 'touch_updated_at') {
    fail('public.leads.touch_leads does not match the approved ordinary BEFORE UPDATE ROW baseline');
  }
}

function assertCommon(snapshot: RepairSnapshot): void {
  assertTriggerBaseline(snapshot.triggers);
  if (snapshot.demoOrganizationId === snapshot.realOrganizationId) fail('Real and Demo organizations resolve to the same ID');
  if (snapshot.permissionCount !== 32 || snapshot.platformAdminCount !== 0 || snapshot.clientAssignmentCount !== 0) {
    fail('RBAC invariants differ from the approved production baseline');
  }
  if (snapshot.tenantConstraintCount !== 22 || snapshot.validTenantConstraintCount !== 22) {
    fail('The 22 validated Batch 3B composite tenant foreign keys are not intact');
  }
}

function assertLead(lead: LeadState, repair: LeadRepair, state: 'incident' | 'clean', demoId: string): void {
  if (lead.id !== repair.id || lead.companyName !== repair.companyName || lead.organizationId !== demoId || lead.createdAt !== CANONICAL_SEED_TIMESTAMP) {
    fail(`Lead identity/tenant/timestamp mismatch for ${repair.companyName}`);
  }
  const expectedMaterial = [...repair.canonicalMaterial];
  if (state === 'incident') expectedMaterial[5] = repair.currentStage;
  if (stable(lead.material) !== stable(expectedMaterial)) fail(`Non-stage material drift exists for ${repair.companyName}`);
  const expectedStage = state === 'incident' ? repair.currentStage : repair.canonicalStage;
  const expectedUpdatedAt = state === 'incident' ? repair.currentUpdatedAt : CANONICAL_SEED_TIMESTAMP;
  if (lead.stage !== expectedStage || lead.updatedAt !== expectedUpdatedAt) fail(`Lead stage/updated_at mismatch for ${repair.companyName}`);
}

function assertIncidentManifest(differences: readonly ManifestDifference[]): void {
  if (differences.length !== 14) fail(`Expected exactly 14 directional manifest differences; found ${differences.length}`);
  const expected = [
    ...INCIDENT_ACTIVITIES.map(() => 'live_only|activities|lead_stage_change'),
    ...LEAD_REPAIRS.flatMap((lead) => [`expected_only|leads|${lead.companyName}`, `live_only|leads|${lead.companyName}`]),
  ].sort();
  const actual = differences.map((row) => `${row.direction}|${row.tableName}|${row.stableKey}`).sort();
  if (stable(actual) !== stable(expected)) fail('Manifest differences are not exactly the eight activities and three lead-stage substitutions');
}

export function buildDomainDriftRepairPlan(snapshot: RepairSnapshot): RepairPlan {
  assertCommon(snapshot);
  const clean = snapshot.totals.total === 88 && snapshot.totals.demo === 88 && snapshot.totals.real === 0 && snapshot.totals.nullOwned === 0;
  const incident = snapshot.totals.total === 96 && snapshot.totals.demo === 88 && snapshot.totals.real === 0 && snapshot.totals.nullOwned === 8;
  if (!clean && !incident) fail(`Domain totals are neither the exact incident nor canonical clean state: ${stable(snapshot.totals)}`);

  for (const table of DOMAIN_TABLES) {
    const expected = incident && table === 'activities' ? 8 : 0;
    if ((snapshot.nullRowsByTable[table] ?? 0) !== expected) fail(`Unexpected NULL-owned row count in ${table}`);
  }
  if (snapshot.leads.length !== 3) fail(`Expected exactly three targeted leads; found ${snapshot.leads.length}`);
  for (const repair of LEAD_REPAIRS) {
    const matches = snapshot.leads.filter((lead) => lead.id === repair.id);
    if (matches.length !== 1) fail(`Expected exactly one lead ${repair.id}; found ${matches.length}`);
    assertLead(matches[0], repair, incident ? 'incident' : 'clean', snapshot.demoOrganizationId);
  }

  if (clean) {
    if (snapshot.activities.length !== 0 || snapshot.manifestDifferences.length !== 0) fail('Canonical totals contain unexpected incident rows or manifest differences');
    return { state: 'clean', activitiesToDelete: [], leadsToUpdate: [], pendingWrites: 0 };
  }

  if (snapshot.activities.length !== 8) fail(`Expected exactly eight NULL-owned activities; found ${snapshot.activities.length}`);
  for (const expected of INCIDENT_ACTIVITIES) {
    const matches = snapshot.activities.filter((row) => row.id === expected.id);
    if (matches.length !== 1) fail(`Expected exactly one fingerprinted activity ${expected.id}; found ${matches.length}`);
    const actual = matches[0];
    if (actual.organizationId !== null || actual.type !== 'lead_stage_change' || actual.entity !== 'lead' || stable(actual.metadata) !== '{}' ||
        stable({ id: actual.id, userId: actual.userId, entityId: actual.entityId, description: actual.description, createdAt: actual.createdAt }) !== stable(expected)) {
      fail(`Activity fingerprint mismatch for ${expected.id}`);
    }
  }
  assertIncidentManifest(snapshot.manifestDifferences);
  return { state: 'incident', activitiesToDelete: INCIDENT_ACTIVITIES, leadsToUpdate: LEAD_REPAIRS, pendingWrites: 11 };
}

export interface DomainDriftRepairRepository {
  loadSnapshot(): Promise<RepairSnapshot>;
  disableTouchLeads(): Promise<void>;
  loadTouchLeadsTrigger(): Promise<readonly TriggerSnapshot[]>;
  deleteActivity(activity: ActivityFingerprint): Promise<number>;
  updateLead(repair: LeadRepair, demoOrganizationId: string): Promise<number>;
  enableTouchLeads(): Promise<void>;
  assertSeedManifest(): Promise<void>;
}

export interface RepairExecution {
  readonly initialPlan: RepairPlan;
  readonly finalPlan: RepairPlan | null;
  readonly writes: number;
}

export async function executeDomainDriftRepair(repository: DomainDriftRepairRepository, apply: boolean): Promise<RepairExecution> {
  const before = await repository.loadSnapshot();
  const initialPlan = buildDomainDriftRepairPlan(before);
  if (!apply || initialPlan.pendingWrites === 0) return { initialPlan, finalPlan: apply ? initialPlan : null, writes: 0 };

  const triggerSnapshot = stable(before.triggers);
  await repository.disableTouchLeads();
  const disabled = await repository.loadTouchLeadsTrigger();
  if (disabled.length !== 1 || disabled[0].enabled !== 'D' || stable([{ ...disabled[0], enabled: 'O' }]) !== triggerSnapshot) {
    fail('touch_leads suppression changed more than its enabled state');
  }

  let writes = 0;
  for (const activity of initialPlan.activitiesToDelete) {
    if (await repository.deleteActivity(activity) !== 1) fail(`Delete affected other than one row for ${activity.id}`);
    writes += 1;
  }
  for (const lead of initialPlan.leadsToUpdate) {
    if (await repository.updateLead(lead, before.demoOrganizationId) !== 1) fail(`Update affected other than one row for ${lead.id}`);
    writes += 1;
  }

  await repository.enableTouchLeads();
  const restored = await repository.loadTouchLeadsTrigger();
  if (stable(restored) !== triggerSnapshot) fail('touch_leads catalog state was not restored exactly');

  const after = await repository.loadSnapshot();
  const finalPlan = buildDomainDriftRepairPlan(after);
  if (finalPlan.pendingWrites !== 0) fail('Final planner still reports pending repair changes');
  if (after.authorityFingerprint !== before.authorityFingerprint) fail('Protected tenant/RBAC/profile authority state changed');
  if (stable(after.triggers) !== triggerSnapshot) fail('Final touch_leads catalog differs from its transaction-local snapshot');
  await repository.assertSeedManifest();
  return { initialPlan, finalPlan, writes };
}
