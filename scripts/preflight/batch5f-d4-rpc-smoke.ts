import { randomUUID } from 'node:crypto';
import { Client, type QueryResultRow } from 'pg';

const PROJECT_REF = 'vkgvfllqgfleosufzwhc';
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
const OWNER_ID = 'dc62be87-fe6a-4b3f-8a6c-a875ffe36a9c';
const DEMO_ADMIN_ID = '148803f0-322b-408e-9ffc-c9ce486172a6';
const PURPLELOK_ID = '2f02d28b-a8f1-48cd-acbc-f47a5bcd1757';
const DEMO_ID = '9e35e50a-8a9f-4fec-b64e-13388a415e10';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Batch 5F-D4 smoke failed: ${message}`);
}

interface Claims extends Record<string, unknown> { sub: string; role: 'authenticated'; session_id: string; purplelok_session_state: 'normal_v1' }

async function verifiedClaims(variable: string, expectedUser: string, anonKey: string): Promise<Claims> {
  const token = process.env[variable]?.trim();
  assert(token, `${variable} is required`);
  const response = await fetch(`${PROJECT_URL}/auth/v1/user`, { headers: { apikey: anonKey, authorization: `Bearer ${token}` } });
  assert(response.ok, `${variable} is not accepted by production Auth`);
  const user = await response.json() as { id?: string };
  let claims: Record<string, unknown>;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>; } catch { throw new Error(`Batch 5F-D4 smoke failed: ${variable} payload is malformed`); }
  assert(user.id === expectedUser && claims.sub === expectedUser, `${variable} identity differs`);
  assert(claims.role === 'authenticated' && claims.purplelok_session_state === 'normal_v1', `${variable} is not normal_v1`);
  const methods = Array.isArray(claims.amr) ? claims.amr : [];
  assert(methods.some((entry) => typeof entry === 'object' && entry !== null && 'method' in entry && entry.method === 'password'), `${variable} is not password-authenticated`);
  assert(typeof claims.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(claims.session_id), `${variable} session_id is invalid`);
  return claims as Claims;
}

async function one<T extends QueryResultRow>(client: Client, sql: string, values: unknown[] = []): Promise<T> {
  const result = await client.query<T>(sql, values);
  assert(result.rowCount === 1, 'singleton query returned unexpected row count');
  return result.rows[0];
}

async function actor(client: Client, claims: Claims): Promise<void> {
  await client.query(`select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)`, [claims.sub, JSON.stringify(claims)]);
}

let savepointCounter = 0;
async function denied(client: Client, sql: string, values: unknown[], expectedCode = '42501'): Promise<void> {
  const savepoint = `d4_denied_${savepointCounter += 1}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(sql, values);
    throw new Error('operation unexpectedly succeeded');
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    assert(code === expectedCode, `denial returned ${code || 'no SQLSTATE'} instead of ${expectedCode}`);
  }
}

async function main(): Promise<void> {
  let databaseUrl = process.env.SUPABASE_PROD_DIRECT_DB_URL?.trim() ?? '';
  const anonKey = process.env.SUPABASE_PROD_ANON_KEY?.trim() ?? '';
  assert(databaseUrl && anonKey, 'database URL and anon key are required');
  const parsed = new URL(databaseUrl);
  assert(['postgres:', 'postgresql:'].includes(parsed.protocol) && parsed.hostname === `db.${PROJECT_REF}.supabase.co` && decodeURIComponent(parsed.username) === 'postgres' && Number(parsed.port || 5432) === 5432 && !parsed.hostname.includes('pooler'), 'database target is not production direct port 5432');
  let ownerClaims = await verifiedClaims('PURPLELOK_OWNER_ACCESS_TOKEN', OWNER_ID, anonKey);
  let demoClaims = await verifiedClaims('PURPLELOK_DEMO_ADMIN_ACCESS_TOKEN', DEMO_ADMIN_ID, anonKey);
  const client = new Client({ connectionString: databaseUrl, application_name: 'batch-5f-d4-rollback-only-rpc-smoke' });
  const suffix = randomUUID().slice(0, 8);
  const ids = { client: randomUUID(), quote: randomUUID(), invoice: randomUUID(), lead: randomUUID() };
  try {
    await client.connect();
    await client.query('BEGIN');
    const demo = await one<{ quote_id: string; invoice_id: string; lead_id: string; lead_stage: string; rows: number }>(client, `select
      (select id from public.quotes where organization_id=$1 order by id limit 1) quote_id,
      (select id from public.invoices where organization_id=$1 order by id limit 1) invoice_id,
      (select id from public.leads where organization_id=$1 order by id limit 1) lead_id,
      (select stage from public.leads where organization_id=$1 order by id limit 1) lead_stage,
      (select count(*)::integer from public.activities where organization_id=$1) rows`, [DEMO_ID]);
    assert(demo.quote_id && demo.invoice_id && demo.lead_id, 'canonical Demo workflow records are absent');
    await client.query(`insert into public.clients(id,organization_id,company_name,created_by) values($1,$2,$3,$4)`, [ids.client, PURPLELOK_ID, `D4 rollback ${suffix}`, OWNER_ID]);
    await client.query(`insert into public.quotes(id,organization_id,quote_number,client_id,title,status,subtotal,vat,total,created_by) values($1,$2,$3,$4,'D4 rollback quote','draft',100,15,115,$5)`, [ids.quote, PURPLELOK_ID, `D4-RB-Q-${suffix}`, ids.client, OWNER_ID]);
    await client.query(`insert into public.quote_items(organization_id,quote_id,description,quantity,unit_price,total) values($1,$2,'D4 line',2,50,100)`, [PURPLELOK_ID, ids.quote]);
    await client.query(`insert into public.invoices(id,organization_id,invoice_number,client_id,title,status,total,amount_paid,balance,created_by) values($1,$2,$3,$4,'D4 rollback payment','sent',100,0,100,$5)`, [ids.invoice, PURPLELOK_ID, `D4-RB-I-${suffix}`, ids.client, OWNER_ID]);
    await client.query(`insert into public.leads(id,organization_id,company_name,stage) values($1,$2,'D4 rollback lead','new_lead')`, [ids.lead, PURPLELOK_ID]);

    await client.query('SET LOCAL ROLE authenticated');
    await actor(client, ownerClaims);
    await client.query('select * from public.send_quote($1)', [ids.quote]);
    await client.query('select * from public.approve_quote($1)', [ids.quote]);
    await client.query('select * from public.convert_quote_to_invoice($1,$2,current_date,current_date+14)', [ids.quote, `D4-RB-C-${suffix}`]);
    await client.query('select * from public.convert_quote_to_project($1)', [ids.quote]);
    await client.query('select * from public.change_lead_stage($1,$2)', [ids.lead, 'contacted']);
    await client.query('select * from public.record_payment($1,40,$2,$3)', [ids.invoice, 'eft', `D4-RB-P-${suffix}`]);
    assert((await one<{ count: number }>(client, `select count(*)::integer count from public.activities where organization_id=$1 and entity_id=any($2::uuid[])`, [PURPLELOK_ID, [ids.quote, ids.lead, ids.invoice]])).count === 6, 'successful workflows did not create the canonical activity set');
    await denied(client, 'select * from public.send_quote($1)', [ids.quote], '22023');
    const invoiceCount = (await one<{ count: number }>(client, 'select count(*)::integer count from public.invoices where quote_id=$1', [ids.quote])).count;
    await denied(client, 'select * from public.convert_quote_to_invoice($1,$2,current_date,current_date+14)', [ids.quote, `D4-RB-DUP-${suffix}`], '22023');
    assert((await one<{ count: number }>(client, 'select count(*)::integer count from public.invoices where quote_id=$1', [ids.quote])).count === invoiceCount, 'failed duplicate conversion left a side effect');

    for (const [sql, value] of [
      ['select * from public.send_quote($1)', demo.quote_id], ['select * from public.approve_quote($1)', demo.quote_id],
      [`select * from public.convert_quote_to_invoice($1,'D4-DENIED',current_date,current_date+14)`, demo.quote_id],
      ['select * from public.convert_quote_to_project($1)', demo.quote_id], ['select * from public.change_lead_stage($1,$2)', demo.lead_id],
      [`select * from public.record_payment($1,1,'eft','D4-DENIED')`, demo.invoice_id],
    ] as const) await denied(client, sql, sql.includes('$2') ? [value, demo.lead_stage === 'contacted' ? 'new_lead' : 'contacted'] : [value]);
    assert((await one<{ count: number }>(client, 'select count(*)::integer count from public.activities where organization_id=$1', [DEMO_ID])).count === demo.rows, 'cross-tenant RPC created a Demo side effect');

    await client.query('RESET ROLE');
    await client.query('SAVEPOINT d4_missing_permission');
    await client.query(`delete from public.organization_role_permissions mapping using public.organization_roles role where mapping.organization_id=$1 and mapping.organization_role_id=role.id and role.organization_id=$1 and role.key='owner' and mapping.permission_key='payments.record'`, [PURPLELOK_ID]);
    await client.query('SET LOCAL ROLE authenticated');
    await actor(client, ownerClaims);
    await denied(client, `select * from public.record_payment($1,1,'eft',$2)`, [ids.invoice, `D4-RB-NO-PERM-${suffix}`]);
    await client.query('RESET ROLE');
    await client.query('ROLLBACK TO SAVEPOINT d4_missing_permission');

    await client.query('SET LOCAL ROLE authenticated');
    await actor(client, demoClaims);
    const nextDemoStage = demo.lead_stage === 'contacted' ? 'new_lead' : 'contacted';
    await client.query('select * from public.change_lead_stage($1,$2)', [demo.lead_id, nextDemoStage]);
    await denied(client, 'select * from public.change_lead_stage($1,$2)', [ids.lead, 'negotiating']);

    await client.query('ROLLBACK');
    console.log(JSON.stringify({ projectRef: PROJECT_REF, mode: 'TRANSACTION-LOCAL WITH UNCONDITIONAL ROLLBACK', authorizedRpcExecution: 'PASS', crossTenantDenial: 'PASS', missingPermissionDenial: 'PASS', invalidStateDenial: 'PASS', atomicity: 'PASS', persistentWrites: 0 }, null, 2));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    ownerClaims = {} as Claims; demoClaims = {} as Claims; databaseUrl = '';
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Batch 5F-D4 RPC smoke failed');
  process.exitCode = 1;
});
