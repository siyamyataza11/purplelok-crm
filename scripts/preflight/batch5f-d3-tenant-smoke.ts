import { Client, type QueryResultRow } from 'pg';

const PROJECT_REF = 'vkgvfllqgfleosufzwhc';
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
const OWNER_ID = 'dc62be87-fe6a-4b3f-8a6c-a875ffe36a9c';
const DEMO_ADMIN_ID = '148803f0-322b-408e-9ffc-c9ce486172a6';
const PURPLELOK_ID = '2f02d28b-a8f1-48cd-acbc-f47a5bcd1757';
const DEMO_ID = '9e35e50a-8a9f-4fec-b64e-13388a415e10';
const DOMAIN_TABLES = ['clients', 'client_contacts', 'client_notes', 'leads', 'quotes', 'quote_items', 'invoices', 'invoice_items', 'payments', 'projects', 'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents', 'tickets', 'ticket_messages', 'activities', 'notifications', 'channels', 'messages'] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Batch 5F-D3 smoke failed: ${message}`);
}

interface Claims extends Record<string, unknown> { sub: string; role: 'authenticated'; session_id: string; purplelok_session_state: 'normal_v1' }

async function verifiedClaims(variable: string, expectedUser: string, anonKey: string): Promise<Claims> {
  const token = process.env[variable]?.trim();
  assert(token, `${variable} is required`);
  const response = await fetch(`${PROJECT_URL}/auth/v1/user`, { headers: { apikey: anonKey, authorization: `Bearer ${token}` } });
  assert(response.ok, `${variable} is not accepted by production Auth`);
  const user = await response.json() as { id?: string };
  let claims: Record<string, unknown>;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>; } catch { throw new Error(`Batch 5F-D3 smoke failed: ${variable} payload is malformed`); }
  assert(user.id === expectedUser && claims.sub === expectedUser, `${variable} identity differs`);
  assert(claims.role === 'authenticated' && claims.purplelok_session_state === 'normal_v1', `${variable} is not normal_v1`);
  const authenticationMethods = Array.isArray(claims.amr) ? claims.amr : [];
  assert(authenticationMethods.some((entry) => typeof entry === 'object' && entry !== null && 'method' in entry && entry.method === 'password'), `${variable} is not password-authenticated`);
  assert(typeof claims.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(claims.session_id), `${variable} session_id is invalid`);
  return claims as Claims;
}

async function one<T extends QueryResultRow>(client: Client, sql: string, values: unknown[] = []): Promise<T> {
  const result = await client.query<T>(sql, values);
  assert(result.rowCount === 1, 'singleton query returned unexpected row count');
  return result.rows[0];
}

async function setClaims(client: Client, claims: Claims): Promise<void> {
  await client.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)]);
}

async function expectDenied(client: Client, name: string, sql: string, values: unknown[]): Promise<void> {
  await client.query(`SAVEPOINT ${name}`);
  try {
    await client.query(sql, values);
    throw new Error(`Batch 5F-D3 smoke failed: ${name} unexpectedly succeeded`);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    assert(code === '42501', `${name} failed for an unexpected reason`);
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
  const client = new Client({ connectionString: databaseUrl, application_name: 'batch-5f-d3-rollback-only-tenant-smoke' });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await setClaims(client, ownerClaims);
    assert((await one<{ count: number }>(client, 'select count(*)::integer count from public.clients where organization_id=$1', [DEMO_ID])).count === 0, 'Owner can read Demo clients');
    const inserted = await one<{ id: string }>(client, `insert into public.clients(id,organization_id,company_name,created_by) values(gen_random_uuid(),$1,'BATCH 5F D3 ROLLBACK SMOKE',$2) returning id`, [PURPLELOK_ID, OWNER_ID]);
    assert((await one<{ count: number }>(client, 'select count(*)::integer count from public.clients where id=$1', [inserted.id])).count === 1, 'Owner cannot read own transaction-local client');
    assert((await client.query(`update public.clients set industry='D3 smoke' where id=$1`, [inserted.id])).rowCount === 1, 'Owner cannot update own transaction-local client');
    await expectDenied(client, 'owner_cross_insert', `insert into public.clients(id,organization_id,company_name,created_by) values(gen_random_uuid(),$1,'DENIED',$2)`, [DEMO_ID, OWNER_ID]);

    await setClaims(client, demoClaims);
    let demoRows = 0;
    for (const table of DOMAIN_TABLES) demoRows += (await one<{ count: number }>(client, `select count(*)::integer count from public.${table}`)).count;
    assert(demoRows === 88, 'Demo Admin does not see the exact 88-row Demo dataset');
    const demoClient = await one<{ id: string }>(client, 'select id from public.clients order by id limit 1');
    assert((await one<{ count: number }>(client, 'select count(*)::integer count from public.clients where id=$1', [inserted.id])).count === 0, 'Demo Admin can read the Owner client');
    assert((await client.query(`update public.clients set industry='DENIED' where id=$1`, [inserted.id])).rowCount === 0, 'Demo Admin can update the Owner client');
    assert((await client.query('delete from public.clients where id=$1', [inserted.id])).rowCount === 0, 'Demo Admin can delete the Owner client');
    await expectDenied(client, 'demo_cross_insert', `insert into public.clients(id,organization_id,company_name,created_by) values(gen_random_uuid(),$1,'DENIED',$2)`, [PURPLELOK_ID, DEMO_ADMIN_ID]);

    await setClaims(client, ownerClaims);
    assert((await client.query(`update public.clients set industry='DENIED' where id=$1`, [demoClient.id])).rowCount === 0, 'Owner can update a Demo client');
    assert((await client.query('delete from public.clients where id=$1', [demoClient.id])).rowCount === 0, 'Owner can delete a Demo client');
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ projectRef: PROJECT_REF, mode: 'TRANSACTION-LOCAL WITH ROLLBACK', ownerIsolation: 'PASS', demoIsolation: 'PASS', demoVisibleRows: demoRows, persistentWrites: 0 }, null, 2));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    ownerClaims = {} as Claims; demoClaims = {} as Claims; databaseUrl = '';
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Batch 5F-D3 tenant smoke failed');
  process.exitCode = 1;
});
