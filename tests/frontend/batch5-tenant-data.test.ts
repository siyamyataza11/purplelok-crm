import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  createTenantDataApi,
  TenantContextUnavailableError,
  TenantDataIntegrityError,
  TenantRequestScope,
  TenantScopeChangedError,
  type TenantDatabaseClient,
  type TenantDomainTable,
  type TenantQueryBuilder,
} from '../../src/lib/tenant-data-internal.ts';
import {
  findDomainQueryBaselineViolations,
  inspectTenantSource,
  LEGACY_DOMAIN_QUERY_BASELINE,
  LEGACY_DOMAIN_QUERY_BASELINE_TOTAL,
  scanDomainQueryBaseline,
} from '../../scripts/check-domain-query-baseline.ts';
import {
  buildProjectProgressUpdate,
  isTenantRealtimeMessage,
  markTenantNotificationsRead,
  moveLeadWithActivity,
  readTenantSource,
} from '../../src/lib/tenant-domain-workflows.ts';

interface Operation {
  method: string;
  args: unknown[];
}

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

class FakeBuilder implements TenantQueryBuilder {
  readonly operations: Operation[] = [];
  signal: AbortSignal | null = null;
  private readonly result: Promise<QueryResult>;

  constructor(result: Promise<QueryResult>) {
    this.result = result;
  }

  select(...args: unknown[]): TenantQueryBuilder { return this.record('select', args); }
  insert(...args: unknown[]): TenantQueryBuilder { return this.record('insert', args); }
  update(...args: unknown[]): TenantQueryBuilder { return this.record('update', args); }
  delete(...args: unknown[]): TenantQueryBuilder { return this.record('delete', args); }
  eq(...args: unknown[]): TenantQueryBuilder { return this.record('eq', args); }
  in(...args: unknown[]): TenantQueryBuilder { return this.record('in', args); }
  order(...args: unknown[]): TenantQueryBuilder { return this.record('order', args); }
  limit(...args: unknown[]): TenantQueryBuilder { return this.record('limit', args); }

  abortSignal(signal: AbortSignal): TenantQueryBuilder {
    this.signal = signal;
    return this.record('abortSignal', [signal]);
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.result.then(onfulfilled, onrejected);
  }

  private record(method: string, args: unknown[]): TenantQueryBuilder {
    this.operations.push({ method, args });
    return this;
  }
}

class FakeDatabase implements TenantDatabaseClient {
  readonly builders: Array<{ source: string; builder: FakeBuilder }> = [];
  private readonly results: Promise<QueryResult>[] = [];

  enqueue(data: unknown, error: { message: string } | null = null): void {
    this.results.push(Promise.resolve({ data, error }));
  }

  enqueuePromise(result: Promise<QueryResult>): void {
    this.results.push(result);
  }

  from(table: string): TenantQueryBuilder {
    return this.create(`table:${table}`);
  }

  rpc(functionName: string, args: Record<string, unknown>): TenantQueryBuilder {
    const builder = this.create(`rpc:${functionName}`);
    builder.operations.push({ method: 'rpcArgs', args: [args] });
    return builder;
  }

  last(): FakeBuilder {
    const last = this.builders.at(-1);
    assert.ok(last);
    return last.builder;
  }

  private create(source: string): FakeBuilder {
    const result = this.results.shift() ?? Promise.resolve({ data: null, error: null });
    const builder = new FakeBuilder(result);
    this.builders.push({ source, builder });
    return builder;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

function eqOperations(builder: FakeBuilder): unknown[][] {
  return builder.operations.filter(({ method }) => method === 'eq').map(({ args }) => args);
}

test('tenant wrapper rejects an unresolved organization', async () => {
  const api = createTenantDataApi(new FakeDatabase(), new TenantRequestScope(null));
  await assert.rejects(() => api.table('clients').select(), TenantContextUnavailableError);
});

test('profiles cannot be queried through the tenant table allowlist', () => {
  const api = createTenantDataApi(new FakeDatabase(), new TenantRequestScope('org-a'));
  assert.throws(() => api.table('profiles' as TenantDomainTable), TenantDataIntegrityError);
});

test('RBAC tables cannot be queried through the tenant table allowlist', () => {
  const api = createTenantDataApi(new FakeDatabase(), new TenantRequestScope('org-a'));
  assert.throws(() => api.table('organization_roles' as TenantDomainTable), TenantDataIntegrityError);
});

test('root SELECT adds tenant predicate while retaining explicit query options', async () => {
  const database = new FakeDatabase();
  database.enqueue([{ id: 'client-a', organization_id: 'org-a' }]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await api.table('clients').select('id, organization_id, client_contacts(id)', {
    filters: [{ operator: 'eq', column: 'status', value: 'active' }],
    order: [{ column: 'created_at', ascending: false }],
    limit: 10,
  });
  assert.deepEqual(eqOperations(database.last()), [
    ['organization_id', 'org-a'],
    ['status', 'active'],
  ]);
  assert.ok(database.last().operations.some(({ method }) => method === 'limit'));
});

test('child SELECT always adds its tenant predicate', async () => {
  const database = new FakeDatabase();
  database.enqueue([{ id: 'note-a', organization_id: 'org-a' }]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await api.table('client_notes').select('id, organization_id', {
    filters: [{ operator: 'in', column: 'client_id', values: ['client-a'] }],
  });
  assert.deepEqual(eqOperations(database.last())[0], ['organization_id', 'org-a']);
  assert.ok(database.last().operations.some(({ method }) => method === 'in'));
});

test('insert rejects caller-controlled organization_id before querying', async () => {
  const database = new FakeDatabase();
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(
    () => api.table('clients').insert({ company_name: 'Forged', organization_id: 'org-b' } as never),
    TenantDataIntegrityError,
  );
  assert.equal(database.builders.length, 0);
});

test('insert injects the initiating organization ID last', async () => {
  const database = new FakeDatabase();
  database.enqueue(null);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await api.table('clients').insert({ company_name: 'Scoped' });
  const insert = database.last().operations.find(({ method }) => method === 'insert');
  assert.deepEqual(insert?.args[0], [{ company_name: 'Scoped', organization_id: 'org-a' }]);
});

test('multi-insert injects the same initiating tenant into every row', async () => {
  const database = new FakeDatabase();
  database.enqueue(null);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await api.table('tasks').insert([{ title: 'One' }, { title: 'Two' }]);
  const insert = database.last().operations.find(({ method }) => method === 'insert');
  assert.deepEqual(insert?.args[0], [
    { title: 'One', organization_id: 'org-a' },
    { title: 'Two', organization_id: 'org-a' },
  ]);
});

test('update rejects caller-controlled organization_id before querying', async () => {
  const database = new FakeDatabase();
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(
    () => api.table('projects').updateById('project-a', { organization_id: 'org-b' } as never),
    TenantDataIntegrityError,
  );
  assert.equal(database.builders.length, 0);
});

test('own-tenant update returns exactly one identity row and succeeds', async () => {
  const database = new FakeDatabase();
  database.enqueue([{ id: 'project-a', organization_id: 'org-a' }]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  assert.deepEqual(
    await api.table('projects').updateById('project-a', { name: 'Updated' }),
    { id: 'project-a', organization_id: 'org-a' },
  );
  assert.deepEqual(eqOperations(database.last()), [
    ['id', 'project-a'],
    ['organization_id', 'org-a'],
  ]);
  assert.deepEqual(
    database.last().operations.find(({ method }) => method === 'select')?.args,
    ['id, organization_id'],
  );
});

test('own-tenant delete returns exactly one identity row and succeeds', async () => {
  const database = new FakeDatabase();
  database.enqueue([{ id: 'note-a', organization_id: 'org-a' }]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  assert.deepEqual(
    await api.table('client_notes').deleteById('note-a'),
    { id: 'note-a', organization_id: 'org-a' },
  );
  assert.deepEqual(eqOperations(database.last()), [
    ['id', 'note-a'],
    ['organization_id', 'org-a'],
  ]);
  assert.deepEqual(
    database.last().operations.find(({ method }) => method === 'select')?.args,
    ['id, organization_id'],
  );
});

test('forged foreign delete UUID returns zero rows and fails closed', async () => {
  const database = new FakeDatabase();
  database.enqueue([]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(
    () => api.table('tickets').deleteById('record-from-org-b'),
    TenantDataIntegrityError,
  );
  assert.ok(eqOperations(database.last()).some(
    ([column, value]) => column === 'organization_id' && value === 'org-a',
  ));
});

test('forged foreign update UUID returns zero rows and fails closed', async () => {
  const database = new FakeDatabase();
  database.enqueue([]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(
    () => api.table('projects').updateById('project-from-org-b', { name: 'Forged' }),
    TenantDataIntegrityError,
  );
});

test('update returning multiple rows fails closed', async () => {
  const database = new FakeDatabase();
  database.enqueue([
    { id: 'project-a', organization_id: 'org-a' },
    { id: 'project-a', organization_id: 'org-a' },
  ]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(
    () => api.table('projects').updateById('project-a', { name: 'Ambiguous' }),
    TenantDataIntegrityError,
  );
});

test('update returning a wrong organization fails closed', async () => {
  const database = new FakeDatabase();
  database.enqueue([{ id: 'project-a', organization_id: 'org-b' }]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(
    () => api.table('projects').updateById('project-a', { name: 'Wrong tenant' }),
    TenantDataIntegrityError,
  );
});

test('delete returning multiple rows fails closed', async () => {
  const database = new FakeDatabase();
  database.enqueue([
    { id: 'note-a', organization_id: 'org-a' },
    { id: 'note-a', organization_id: 'org-a' },
  ]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(
    () => api.table('client_notes').deleteById('note-a'),
    TenantDataIntegrityError,
  );
});

test('delete returning a wrong organization fails closed', async () => {
  const database = new FakeDatabase();
  database.enqueue([{ id: 'note-a', organization_id: 'org-b' }]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(
    () => api.table('client_notes').deleteById('note-a'),
    TenantDataIntegrityError,
  );
});

test('returned row from a mismatched organization fails closed', async () => {
  const database = new FakeDatabase();
  database.enqueue([{ id: 'client-b', organization_id: 'org-b' }]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(() => api.table('clients').select(), TenantDataIntegrityError);
});

test('old-tenant read response is rejected after a generation change', async () => {
  const database = new FakeDatabase();
  const pending = deferred<QueryResult>();
  database.enqueuePromise(pending.promise);
  const scope = new TenantRequestScope('org-a');
  const api = createTenantDataApi(database, scope);
  const read = api.table('clients').select();
  scope.switchOrganization('org-b');
  pending.resolve({ data: [{ id: 'client-a', organization_id: 'org-a' }], error: null });
  await assert.rejects(() => read, TenantScopeChangedError);
});

test('organization switch aborts the outstanding read signal', async () => {
  const database = new FakeDatabase();
  const pending = deferred<QueryResult>();
  database.enqueuePromise(pending.promise);
  const scope = new TenantRequestScope('org-a');
  const api = createTenantDataApi(database, scope);
  const read = api.table('clients').select();
  const signal = database.last().signal;
  assert.ok(signal);
  scope.switchOrganization('org-b');
  assert.equal(signal.aborted, true);
  pending.resolve({ data: [], error: null });
  await assert.rejects(() => read, TenantScopeChangedError);
});

test('mutation keeps initiating tenant scope and suppresses stale completion', async () => {
  const database = new FakeDatabase();
  const pending = deferred<QueryResult>();
  database.enqueuePromise(pending.promise);
  const scope = new TenantRequestScope('org-a');
  const api = createTenantDataApi(database, scope);
  const mutation = api.table('projects').updateById('project-a', { name: 'Scoped' });
  scope.switchOrganization('org-b');
  assert.deepEqual(eqOperations(database.last()), [
    ['id', 'project-a'],
    ['organization_id', 'org-a'],
  ]);
  pending.resolve({ data: [{ id: 'project-a', organization_id: 'org-a' }], error: null });
  await assert.rejects(() => mutation, TenantScopeChangedError);
});

test('direct-domain query guard detects new files and per-file increases', () => {
  const addedFile = findDomainQueryBaselineViolations(
    { ...LEGACY_DOMAIN_QUERY_BASELINE, 'src/pages/NewUnsafe.tsx': 1 },
    LEGACY_DOMAIN_QUERY_BASELINE_TOTAL + 1,
  );
  assert.ok(addedFile.some((message) => message.includes('NewUnsafe.tsx')));

  const increased = findDomainQueryBaselineViolations(
    {
      ...LEGACY_DOMAIN_QUERY_BASELINE,
      'src/components/layout/Topbar.tsx': LEGACY_DOMAIN_QUERY_BASELINE['src/components/layout/Topbar.tsx'] + 1,
    },
    LEGACY_DOMAIN_QUERY_BASELINE_TOTAL + 1,
  );
  assert.ok(increased.some((message) => message.includes('Topbar.tsx')));
});

test('AST query guard catches every confirmed raw-domain bypass', () => {
  const fixtures: Record<string, string> = {
    clientAliasChain: "import { supabase } from '@/lib/supabase'; const db = supabase; const db2 = db; db2.from('clients');",
    assignedClientAlias: "import { supabase } from '@/lib/supabase'; let db; db = supabase; db.from('clients');",
    extractedFromAliasChain: "import { supabase } from '@/lib/supabase'; const from = supabase.from; const query = from; query('clients');",
    destructuredFromDeclaration: "import { supabase } from '@/lib/supabase'; const { from: rawFrom } = supabase; const query = rawFrom; query('clients');",
    assignedFromAlias: "import { supabase } from '@/lib/supabase'; let run; run = supabase.from; run('clients');",
    destructuredFromAlias: "import { supabase } from '@/lib/supabase'; let from; ({ from } = supabase); from('clients');",
    rawClientParameter: "import { supabase } from '@/lib/supabase'; function load(db) { return db.from('clients'); } load(supabase);",
    extractedFromParameter: "import { supabase } from '@/lib/supabase'; const load = (from) => from('clients'); load(supabase.from);",
    objectLiteralFromProperty: "import { supabase } from '@/lib/supabase'; const holder = { query: supabase.from }; holder.query('clients');",
    objectLiteralClientProperty: "import { supabase } from '@/lib/supabase'; const holder = { db: supabase }; holder.db.from('clients');",
    aliasedObjectLiteralFrom: "import { supabase } from '@/lib/supabase'; const q = supabase.from; const holder = { query: q }; holder.query('clients');",
    aliasedObjectLiteralClient: "import { supabase } from '@/lib/supabase'; const db = supabase; const holder = { client: db }; holder.client.from('clients');",
    shorthandObjectLiteralFrom: "import { supabase } from '@/lib/supabase'; const query = supabase.from; const holder = { query }; holder.query('clients');",
    shorthandObjectLiteralClient: "import { supabase } from '@/lib/supabase'; const db = supabase; const holder = { db }; holder.db.from('clients');",
    stringNamedObjectLiteralFrom: "import { supabase } from '@/lib/supabase'; const holder = { 'query': supabase.from }; holder['query']('clients');",
    computedObjectLiteralFrom: "import { supabase } from '@/lib/supabase'; const key = 'query'; const holder = { [key]: supabase.from }; holder.query('clients');",
    nestedObjectLiteralFrom: "import { supabase } from '@/lib/supabase'; const holder = { api: { query: supabase.from } }; holder.api.query('clients');",
    factoryObjectLiteralClient: "import { supabase } from '@/lib/supabase'; function getSupabase() { return supabase; } const holder = { db: getSupabase() }; holder.db.from('clients');",
    rawClientProperty: "import { supabase } from '@/lib/supabase'; const holder = {}; holder.db = supabase; holder.db.from('clients');",
    extractedFromProperty: "import { supabase } from '@/lib/supabase'; const holder = {}; holder.query = supabase.from; holder.query('clients');",
    wrapperClient: "import { supabase } from '@/lib/supabase'; function getSupabase() { return supabase; } let db; db = getSupabase(); db.from('clients');",
    constantAliasChain: "import { supabase } from '@/lib/supabase'; const table = 'clients'; const t2 = table; supabase.from(t2);",
    renamedImport: "import { supabase as renamed } from '@/lib/supabase'; renamed.from('clients');",
    bracketAccess: 'import { supabase } from \'@/lib/supabase\'; supabase["from"]("clients");',
    templateLiteral: "import { supabase } from '@/lib/supabase'; const table = `clients`; supabase.from(table);",
    dynamicGenericHelper: "import { supabase } from '@/lib/supabase'; function query(table) { return supabase.from(table); } query('clients');",
    boundParameter: "import { supabase } from '@/lib/supabase'; function load(query) { return query('clients'); } load(supabase.from.bind(supabase));",
  };
  for (const [name, source] of Object.entries(fixtures)) {
    const result = inspectTenantSource(`src/pages/Unsafe-${name}.tsx`, source);
    assert.ok(
      result.occurrences.some(({ table }) => table === 'clients') || result.violations.length > 0,
      `${name} must be rejected`,
    );
  }

  const forbidden = inspectTenantSource(
    'src/pages/UnsafeAuthority.tsx',
    "import { TenantRequestScope } from '@/lib/tenant-data-internal';",
  );
  assert.ok(forbidden.violations.some((message) => message.includes('tenant-authority internals')));
});

test('AST query guard permits only the narrow internal builder and non-domain access', () => {
  const internal = inspectTenantSource(
    'src/lib/tenant-data-internal.ts',
    "const table: string = input; database.from(table);",
  );
  assert.deepEqual(internal, { occurrences: [], violations: [] });

  const nonDomain = inspectTenantSource(
    'src/context/AuthContext.tsx',
    "import { supabase } from '@/lib/supabase'; supabase.from('profiles');",
  );
  assert.deepEqual(nonDomain, { occurrences: [], violations: [] });
});

test('direct-query guard command exits non-zero for an object-literal extracted-from query', async () => {
  const repository = await mkdtemp(path.join(tmpdir(), 'purplelok-query-guard-'));
  try {
    await mkdir(path.join(repository, 'src', 'pages'), { recursive: true });
    await writeFile(
      path.join(repository, 'src', 'pages', 'Unsafe.tsx'),
      "import { supabase } from '@/lib/supabase'; const holder = { query: supabase.from }; holder.query('clients');\n",
      'utf8',
    );
    const script = path.resolve('scripts/check-domain-query-baseline.ts');
    const result = spawnSync(process.execPath, ['--experimental-strip-types', script], {
      cwd: repository,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Unsafe\.tsx/);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test('public tenant module exposes types only and no authority constructor', async () => {
  const publicSource = await readFile('src/lib/tenant-data.ts', 'utf8');
  assert.doesNotMatch(publicSource, /export\s+(?:class|function|const)\s+(?:TenantRequestScope|createTenantDataApi)/);
  assert.doesNotMatch(publicSource, /createTenantDataApi|TenantRequestScope/);

  const contextSource = await readFile('src/context/TenantDataContext.tsx', 'utf8');
  assert.match(contextSource, /currentOrganization\?\.id\s*\?\?\s*null/);
  assert.match(contextSource, /export function useTenantData/);
});

test('checked-in direct-query inventory reaches zero after Batch 5D', async () => {
  const result = await scanDomainQueryBaseline(process.cwd());
  assert.equal(result.total, 0);
  assert.deepEqual(result.occurrences, []);
  assert.deepEqual(result.violations, []);
});

test('realtime events require the active tenant and channel', () => {
  assert.equal(isTenantRealtimeMessage({ new: { organization_id: 'org-a', channel_id: 'channel-a' } }, 'org-a', 'channel-a'), true);
  assert.equal(isTenantRealtimeMessage({ new: { organization_id: 'org-b', channel_id: 'channel-a' } }, 'org-a', 'channel-a'), false);
  assert.equal(isTenantRealtimeMessage({ new: { organization_id: 'org-a', channel_id: 'channel-b' } }, 'org-a', 'channel-a'), false);
});

test('notification mark-all-read preflights user and tenant ownership', async () => {
  const database = new FakeDatabase();
  database.enqueue([
    { id: 'notification-a', organization_id: 'org-a', user_id: 'user-a', read: false },
  ]);
  database.enqueue([{ id: 'notification-a', organization_id: 'org-a', user_id: 'user-a' }]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await markTenantNotificationsRead(api, 'user-a', [
    { id: 'notification-a', organization_id: 'org-a', user_id: 'user-a', read: false } as never,
  ]);
  assert.equal(database.builders.length, 2);
  assert.deepEqual(database.builders[0].source, 'table:notifications');
  assert.deepEqual(eqOperations(database.builders[0].builder), [
    ['organization_id', 'org-a'],
    ['user_id', 'user-a'],
  ]);
  assert.ok(database.builders[0].builder.operations.some(({ method, args }) =>
    method === 'in' && args[0] === 'id' && args[1] instanceof Array
      && args[1][0] === 'notification-a'));
});

test('notification mark-all-read rejects an unexpected notification owner before update', async () => {
  const database = new FakeDatabase();
  database.enqueue([]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(() => markTenantNotificationsRead(api, 'user-a', [
    { id: 'foreign-notification', organization_id: 'org-a', user_id: 'user-a', read: false } as never,
  ]));
  assert.equal(database.builders.length, 1);
});

test('member directory RPC is scoped to the initiating organization', async () => {
  const database = new FakeDatabase();
  database.enqueue([{
    organization_id: 'org-a', membership_id: 'member-a', user_id: 'user-a',
    full_name: 'User A', email: 'a@example.test', job_title: null, avatar_url: null,
  }]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  const rows = await api.members.listActive();
  assert.equal(rows.length, 1);
  assert.equal(database.builders[0].source, 'rpc:get_organization_member_directory');
  assert.deepEqual(database.last().operations[0].args[0], { target_organization_id: 'org-a' });
});

test('member verification accepts exactly one active directory member', async () => {
  const database = new FakeDatabase();
  database.enqueue([{
    organization_id: 'org-a', membership_id: 'member-a', user_id: 'user-a',
    full_name: 'User A', email: 'a@example.test', job_title: 'Designer', avatar_url: null,
  }]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  assert.equal((await api.members.assertActive('user-a')).membership_id, 'member-a');
});

test('assertTenantRecord accepts only approved parents and ID plus tenant scope', async () => {
  const database = new FakeDatabase();
  database.enqueue([{ id: 'project-a', organization_id: 'org-a' }]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  assert.equal((await api.assertTenantRecord('projects', 'project-a')).id, 'project-a');
  assert.deepEqual(eqOperations(database.last()), [
    ['organization_id', 'org-a'],
    ['id', 'project-a'],
  ]);
  await assert.rejects(
    () => api.assertTenantRecord('project_milestones' as never, 'milestone-a'),
    TenantDataIntegrityError,
  );
});

test('PURPLELOK cannot read a Demo row even when permissive RLS returns it', async () => {
  const database = new FakeDatabase();
  database.enqueue([{ id: 'demo-client', organization_id: 'purplelok-demo' }]);
  const api = createTenantDataApi(database, new TenantRequestScope('purplelok'));
  await assert.rejects(() => api.table('clients').select(), TenantDataIntegrityError);
});

test('Demo cannot read a PURPLELOK lead even when permissive RLS returns it', async () => {
  const database = new FakeDatabase();
  database.enqueue([{ id: 'real-lead', organization_id: 'purplelok' }]);
  const api = createTenantDataApi(database, new TenantRequestScope('purplelok-demo'));
  await assert.rejects(() => api.table('leads').select(), TenantDataIntegrityError);
});

test('cross-tenant lead drag fails closed and creates no activity', async () => {
  const database = new FakeDatabase();
  database.enqueue([]);
  const api = createTenantDataApi(database, new TenantRequestScope('purplelok'));
  await assert.rejects(() => moveLeadWithActivity({
    tenant: api,
    canWrite: true,
    leadId: 'demo-lead',
    companyName: 'Demo lead',
    stage: 'contacted',
    userId: 'real-owner',
  }), TenantDataIntegrityError);
  assert.deepEqual(database.builders.map(({ source }) => source), ['table:leads']);
});

test('successful lead drag writes tenant-owned activity only after exact update', async () => {
  const database = new FakeDatabase();
  database.enqueue([{ id: 'lead-a', organization_id: 'org-a' }]);
  database.enqueue(null);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await moveLeadWithActivity({
    tenant: api,
    canWrite: true,
    leadId: 'lead-a',
    companyName: 'Scoped lead',
    stage: 'won',
    userId: 'user-a',
  });
  assert.deepEqual(database.builders.map(({ source }) => source), ['table:leads', 'table:activities']);
  const insert = database.builders[1].builder.operations.find(({ method }) => method === 'insert');
  assert.equal((insert?.args[0] as Array<Record<string, unknown>>)[0].organization_id, 'org-a');
});

test('lead drag requires leads.write before any query', async () => {
  const database = new FakeDatabase();
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(() => moveLeadWithActivity({
    tenant: api,
    canWrite: false,
    leadId: 'lead-a',
    companyName: 'Lead',
    stage: 'won',
    userId: 'user-a',
  }), /Lead write permission/);
  assert.equal(database.builders.length, 0);
});

test('all migrated create targets inject a non-null active tenant', async () => {
  const tables: TenantDomainTable[] = [
    'clients', 'leads', 'quotes', 'quote_items', 'invoices', 'invoice_items',
    'payments', 'projects', 'project_milestones', 'tasks', 'meetings',
    'documents', 'tickets', 'ticket_messages', 'activities', 'client_notes',
  ];
  const database = new FakeDatabase();
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  for (const table of tables) {
    database.enqueue(null);
    await api.table(table).insert({ marker: table });
    const insert = database.last().operations.find(({ method }) => method === 'insert');
    assert.equal((insert?.args[0] as Array<Record<string, unknown>>)[0].organization_id, 'org-a');
  }
});

test('cross-tenant parent UUID is rejected before a child write', async () => {
  const database = new FakeDatabase();
  database.enqueue([]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(() => api.assertTenantRecord('clients', 'client-b'), TenantDataIntegrityError);
  assert.equal(database.builders.length, 1);
});

test('cross-tenant or inactive assignee is rejected', async () => {
  const database = new FakeDatabase();
  database.enqueue([]);
  const api = createTenantDataApi(database, new TenantRequestScope('org-a'));
  await assert.rejects(() => api.members.assertActive('user-b'), TenantDataIntegrityError);
});

test('unauthorized dashboard/report source is never invoked', async () => {
  let calls = 0;
  assert.deepEqual(await readTenantSource(false, async () => {
    calls += 1;
    return ['secret'];
  }), []);
  assert.equal(calls, 0);
  assert.deepEqual(await readTenantSource(true, async () => {
    calls += 1;
    return ['allowed'];
  }), ['allowed']);
  assert.equal(calls, 1);
});

test('projects.write payload cannot carry management fields', () => {
  assert.deepEqual(buildProjectProgressUpdate(50, 'at_risk', false), { progress: 50 });
  assert.deepEqual(buildProjectProgressUpdate(50, 'at_risk', true), {
    progress: 50,
    health: 'at_risk',
  });
});

test('migrated source files contain no direct domain Supabase calls', async () => {
  const result = await scanDomainQueryBaseline(process.cwd());
  const migratedTables = new Set([
    'clients', 'client_contacts', 'client_notes', 'leads', 'quotes', 'quote_items',
    'invoices', 'invoice_items', 'payments', 'projects', 'project_milestones',
    'tasks', 'task_comments', 'meetings', 'documents', 'tickets',
    'ticket_messages', 'activities',
  ]);
  assert.deepEqual(result.occurrences.filter(({ table }) => migratedTables.has(table)), []);
});
