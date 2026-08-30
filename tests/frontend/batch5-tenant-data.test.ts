import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
      'src/pages/Clients.tsx': LEGACY_DOMAIN_QUERY_BASELINE['src/pages/Clients.tsx'] + 1,
    },
    LEGACY_DOMAIN_QUERY_BASELINE_TOTAL + 1,
  );
  assert.ok(increased.some((message) => message.includes('Clients.tsx')));
});

test('query guard catches template literals, aliases, dynamic tables, and internal imports', () => {
  const template = inspectTenantSource(
    'src/pages/UnsafeTemplate.tsx',
    "import { supabase } from '@/lib/supabase'; supabase.from(`clients`);",
  );
  assert.equal(template.occurrences.length, 1);
  assert.equal(template.occurrences[0].table, 'clients');

  const alias = inspectTenantSource(
    'src/pages/UnsafeAlias.tsx',
    "import { supabase as client } from '@/lib/supabase'; const db = client; db.from('clients');",
  );
  assert.equal(alias.occurrences.length, 1);

  const dynamic = inspectTenantSource(
    'src/pages/UnsafeDynamic.tsx',
    "import { supabase } from '@/lib/supabase'; const tableName = 'clients'; supabase.from(tableName);",
  );
  assert.ok(dynamic.violations.some((message) => message.includes('dynamic Supabase table')));

  const forbidden = inspectTenantSource(
    'src/pages/UnsafeAuthority.tsx',
    "import { TenantRequestScope } from '@/lib/tenant-data-internal';",
  );
  assert.ok(forbidden.violations.some((message) => message.includes('tenant-authority internals')));
});

test('public tenant module exposes types only and no authority constructor', async () => {
  const publicSource = await readFile('src/lib/tenant-data.ts', 'utf8');
  assert.doesNotMatch(publicSource, /export\s+(?:class|function|const)\s+(?:TenantRequestScope|createTenantDataApi)/);
  assert.doesNotMatch(publicSource, /createTenantDataApi|TenantRequestScope/);

  const contextSource = await readFile('src/context/TenantDataContext.tsx', 'utf8');
  assert.match(contextSource, /currentOrganization\?\.id\s*\?\?\s*null/);
  assert.match(contextSource, /export function useTenantData/);
});

test('checked-in legacy direct-query inventory is exactly 90 with no violations', async () => {
  const result = await scanDomainQueryBaseline(process.cwd());
  assert.equal(result.total, 90);
  assert.equal(Object.values(result.countsByFile).reduce((sum, count) => sum + count, 0), 90);
  assert.deepEqual(result.violations, []);
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
