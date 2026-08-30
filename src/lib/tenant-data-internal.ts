/**
 * Batch 5A application-level tenant isolation.
 *
 * This layer always scopes domain operations to the organization resolved by
 * OrganizationContext. Capability guards remain the workflow authorization
 * layer; tenant-aware RLS will become the authoritative database boundary in a
 * later Batch 5 migration.
 *
 * Temporary capability semantics for later conversions:
 * - Calendar: projects.read / projects.write.
 * - Chat: active organization membership only until dedicated capabilities.
 * - Activities: side effects of already-authorized workflows only.
 * - Reports/AI: reports.read plus every relevant source read capability.
 * Client access remains disabled until client-specific row scope exists.
 */

export const TENANT_DOMAIN_TABLES = [
  'clients',
  'client_contacts',
  'client_notes',
  'leads',
  'quotes',
  'quote_items',
  'invoices',
  'invoice_items',
  'payments',
  'projects',
  'project_milestones',
  'tasks',
  'task_comments',
  'meetings',
  'documents',
  'tickets',
  'ticket_messages',
  'activities',
  'notifications',
  'channels',
  'messages',
] as const;

export type TenantDomainTable = (typeof TENANT_DOMAIN_TABLES)[number];

export const TENANT_PARENT_TABLES = [
  'clients',
  'quotes',
  'invoices',
  'projects',
  'tasks',
  'tickets',
  'channels',
  'documents',
] as const satisfies readonly TenantDomainTable[];

export type TenantParentTable = (typeof TENANT_PARENT_TABLES)[number];

export interface TenantOwnedRecord {
  id: string;
  organization_id: string;
}

export type TenantMutationInput<T extends object> =
  Omit<T, 'organization_id'> & { organization_id?: never };

type InferredTenantMutationInput<T extends object> =
  T & { organization_id?: never };

export interface OrganizationMemberDirectoryEntry {
  organization_id: string;
  membership_id: string;
  user_id: string;
  full_name: string;
  email: string;
  job_title: string | null;
  avatar_url: string | null;
}

export type TenantFilter =
  | { operator: 'eq'; column: string; value: unknown }
  | { operator: 'in'; column: string; values: readonly unknown[] };

export interface TenantOrder {
  column: string;
  ascending?: boolean;
  nullsFirst?: boolean;
}

export interface TenantSelectOptions {
  filters?: readonly TenantFilter[];
  order?: readonly TenantOrder[];
  limit?: number;
}

export interface TenantReturningOptions {
  returning?: string;
}

export type TenantMutationResult = TenantOwnedRecord;

interface DatabaseError {
  message: string;
  code?: string;
}

interface DatabaseResult {
  data: unknown;
  error: DatabaseError | null;
}

export interface TenantQueryBuilder extends PromiseLike<DatabaseResult> {
  select(columns?: string): TenantQueryBuilder;
  insert(values: Record<string, unknown> | readonly Record<string, unknown>[]): TenantQueryBuilder;
  update(values: Record<string, unknown>): TenantQueryBuilder;
  delete(): TenantQueryBuilder;
  eq(column: string, value: unknown): TenantQueryBuilder;
  in(column: string, values: readonly unknown[]): TenantQueryBuilder;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): TenantQueryBuilder;
  limit(count: number): TenantQueryBuilder;
  abortSignal(signal: AbortSignal): TenantQueryBuilder;
}

export interface TenantDatabaseClient {
  from(table: string): TenantQueryBuilder;
  rpc(functionName: string, args: Record<string, unknown>): TenantQueryBuilder;
}

export class TenantContextUnavailableError extends Error {
  constructor() {
    super('Tenant data access requires a resolved active organization');
    this.name = 'TenantContextUnavailableError';
  }
}

export class TenantScopeChangedError extends Error {
  constructor() {
    super('Tenant request became stale after the active organization changed');
    this.name = 'TenantScopeChangedError';
  }
}

export class TenantDataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantDataIntegrityError';
  }
}

interface TenantRequestToken {
  organizationId: string;
  generation: number;
  signal?: AbortSignal;
}

export class TenantRequestScope {
  private organizationId: string | null;
  private generation = 0;
  private readController = new AbortController();

  constructor(organizationId: string | null) {
    this.organizationId = normalizeOrganizationId(organizationId);
  }

  captureRead(): TenantRequestToken {
    return {
      organizationId: this.requireOrganizationId(),
      generation: this.generation,
      signal: this.readController.signal,
    };
  }

  captureMutation(): TenantRequestToken {
    return {
      organizationId: this.requireOrganizationId(),
      generation: this.generation,
    };
  }

  switchOrganization(organizationId: string | null): void {
    this.readController.abort();
    this.generation += 1;
    this.organizationId = normalizeOrganizationId(organizationId);
    this.readController = new AbortController();
  }

  dispose(): void {
    this.readController.abort();
    this.generation += 1;
    this.organizationId = null;
  }

  assertCurrent(token: TenantRequestToken): void {
    if (
      token.generation !== this.generation
      || token.organizationId !== this.organizationId
      || token.signal?.aborted
    ) {
      throw new TenantScopeChangedError();
    }
  }

  private requireOrganizationId(): string {
    if (!this.organizationId) throw new TenantContextUnavailableError();
    return this.organizationId;
  }
}

function normalizeOrganizationId(organizationId: string | null): string | null {
  const normalized = organizationId?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function assertAllowedTable(table: string): asserts table is TenantDomainTable {
  if (!(TENANT_DOMAIN_TABLES as readonly string[]).includes(table)) {
    throw new TenantDataIntegrityError(`Table ${table} is not in the tenant-domain allowlist`);
  }
}

function assertAllowedParentTable(table: string): asserts table is TenantParentTable {
  if (!(TENANT_PARENT_TABLES as readonly string[]).includes(table)) {
    throw new TenantDataIntegrityError(`Table ${table} is not an approved tenant parent`);
  }
}

function assertIdentifier(id: string): void {
  if (!id.trim()) throw new TenantDataIntegrityError('A non-empty record ID is required');
}

function assertNoOrganizationId(payload: object): void {
  if (Object.prototype.hasOwnProperty.call(payload, 'organization_id')) {
    throw new TenantDataIntegrityError('organization_id is controlled by the tenant data layer');
  }
}

function assertFilter(filter: TenantFilter): void {
  if (!filter.column.trim()) throw new TenantDataIntegrityError('Filter column cannot be empty');
  if (filter.column === 'organization_id') {
    throw new TenantDataIntegrityError('The tenant predicate cannot be supplied or overridden');
  }
  if (filter.operator === 'in' && filter.values.length === 0) {
    throw new TenantDataIntegrityError('An in filter requires at least one value');
  }
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new TenantDataIntegrityError('Limit must be a positive integer');
  }
}

function tenantProjection(columns: string): string {
  const projection = columns.trim();
  if (!projection) throw new TenantDataIntegrityError('Select projection cannot be empty');
  return projection === '*' ? '*' : `organization_id, ${projection}`;
}

function applySelectOptions(
  query: TenantQueryBuilder,
  options: TenantSelectOptions,
): TenantQueryBuilder {
  let scopedQuery = query;
  for (const filter of options.filters ?? []) {
    assertFilter(filter);
    scopedQuery = filter.operator === 'eq'
      ? scopedQuery.eq(filter.column, filter.value)
      : scopedQuery.in(filter.column, filter.values);
  }
  for (const order of options.order ?? []) {
    if (!order.column.trim()) throw new TenantDataIntegrityError('Order column cannot be empty');
    scopedQuery = scopedQuery.order(order.column, {
      ascending: order.ascending,
      nullsFirst: order.nullsFirst,
    });
  }
  if (options.limit !== undefined) {
    assertLimit(options.limit);
    scopedQuery = scopedQuery.limit(options.limit);
  }
  return scopedQuery;
}

function rowsFromResult(result: DatabaseResult): Record<string, unknown>[] {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) return [];
  if (!Array.isArray(result.data)) {
    throw new TenantDataIntegrityError('Tenant query returned an unexpected result shape');
  }
  return result.data.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new TenantDataIntegrityError('Tenant query returned a non-record row');
    }
    return row as Record<string, unknown>;
  });
}

function assertTenantRows(
  rows: readonly Record<string, unknown>[],
  organizationId: string,
): void {
  for (const row of rows) {
    if (row.organization_id !== organizationId) {
      throw new TenantDataIntegrityError('Tenant query returned a row from another organization');
    }
  }
}

async function executeRead(
  scope: TenantRequestScope,
  token: TenantRequestToken,
  query: TenantQueryBuilder,
): Promise<Record<string, unknown>[]> {
  const result = await query.abortSignal(token.signal as AbortSignal);
  scope.assertCurrent(token);
  const rows = rowsFromResult(result);
  assertTenantRows(rows, token.organizationId);
  return rows;
}

async function executeMutation(
  scope: TenantRequestScope,
  token: TenantRequestToken,
  query: TenantQueryBuilder,
): Promise<Record<string, unknown>[]> {
  const result = await query;
  scope.assertCurrent(token);
  const rows = rowsFromResult(result);
  if (rows.length > 0) assertTenantRows(rows, token.organizationId);
  return rows;
}

async function executeExactlyOneIdMutation(
  scope: TenantRequestScope,
  token: TenantRequestToken,
  query: TenantQueryBuilder,
  requestedId: string,
): Promise<TenantMutationResult> {
  const result = await query;
  scope.assertCurrent(token);
  const rows = rowsFromResult(result);
  if (rows.length !== 1) {
    throw new TenantDataIntegrityError(
      `Tenant ID mutation expected exactly one affected row; received ${rows.length}`,
    );
  }

  const row = rows[0];
  if (row.id !== requestedId || row.organization_id !== token.organizationId) {
    throw new TenantDataIntegrityError(
      'Tenant ID mutation returned an unexpected record identity or organization',
    );
  }

  return row as unknown as TenantMutationResult;
}

export interface TenantTableApi {
  select<T extends TenantOwnedRecord = TenantOwnedRecord>(
    columns?: string,
    options?: TenantSelectOptions,
  ): Promise<T[]>;
  insert<TInput extends object, TResult extends TenantOwnedRecord = TenantOwnedRecord>(
    payload: InferredTenantMutationInput<TInput> | readonly InferredTenantMutationInput<TInput>[],
    options?: TenantReturningOptions,
  ): Promise<TResult[]>;
  updateById<TInput extends object>(
    id: string,
    payload: InferredTenantMutationInput<TInput>,
  ): Promise<TenantMutationResult>;
  deleteById(id: string): Promise<TenantMutationResult>;
}

export interface TenantMemberDirectoryApi {
  listActive(): Promise<OrganizationMemberDirectoryEntry[]>;
  assertActive(userId: string): Promise<OrganizationMemberDirectoryEntry>;
}

export interface TenantDataApi {
  table(table: TenantDomainTable): TenantTableApi;
  assertTenantRecord<T extends TenantOwnedRecord = TenantOwnedRecord>(
    table: TenantParentTable,
    id: string,
    columns?: string,
  ): Promise<T>;
  members: TenantMemberDirectoryApi;
}

export function createTenantDataApi(
  database: TenantDatabaseClient,
  scope: TenantRequestScope,
): TenantDataApi {
  const table = (requestedTable: TenantDomainTable): TenantTableApi => {
    assertAllowedTable(requestedTable);

    return {
      async select<T extends TenantOwnedRecord = TenantOwnedRecord>(
        columns = '*',
        options: TenantSelectOptions = {},
      ): Promise<T[]> {
        const token = scope.captureRead();
        let query = database
          .from(requestedTable)
          .select(tenantProjection(columns))
          .eq('organization_id', token.organizationId);
        query = applySelectOptions(query, options);
        const rows = await executeRead(scope, token, query);
        return rows as unknown as T[];
      },

      async insert<TInput extends object, TResult extends TenantOwnedRecord = TenantOwnedRecord>(
        payload: InferredTenantMutationInput<TInput> | readonly InferredTenantMutationInput<TInput>[],
        options: TenantReturningOptions = {},
      ): Promise<TResult[]> {
        const token = scope.captureMutation();
        const sourceRows = Array.isArray(payload) ? payload : [payload];
        if (sourceRows.length === 0) {
          throw new TenantDataIntegrityError('Insert requires at least one row');
        }
        const rows = sourceRows.map((row) => {
          assertNoOrganizationId(row);
          return { ...row, organization_id: token.organizationId };
        });
        let query = database.from(requestedTable).insert(rows);
        if (options.returning) query = query.select(tenantProjection(options.returning));
        const result = await executeMutation(scope, token, query);
        return result as unknown as TResult[];
      },

      async updateById<TInput extends object>(
        id: string,
        payload: InferredTenantMutationInput<TInput>,
      ): Promise<TenantMutationResult> {
        assertIdentifier(id);
        assertNoOrganizationId(payload);
        const token = scope.captureMutation();
        const query = database
          .from(requestedTable)
          .update(payload as Record<string, unknown>)
          .eq('id', id)
          .eq('organization_id', token.organizationId)
          .select('id, organization_id');
        return executeExactlyOneIdMutation(scope, token, query, id);
      },

      async deleteById(
        id: string,
      ): Promise<TenantMutationResult> {
        assertIdentifier(id);
        const token = scope.captureMutation();
        const query = database
          .from(requestedTable)
          .delete()
          .eq('id', id)
          .eq('organization_id', token.organizationId)
          .select('id, organization_id');
        return executeExactlyOneIdMutation(scope, token, query, id);
      },
    };
  };

  const listActiveMembers = async (): Promise<OrganizationMemberDirectoryEntry[]> => {
    const token = scope.captureRead();
    const query = database.rpc('get_organization_member_directory', {
      target_organization_id: token.organizationId,
    });
    const rows = await executeRead(scope, token, query);
    return rows as unknown as OrganizationMemberDirectoryEntry[];
  };

  return {
    table,
    async assertTenantRecord<T extends TenantOwnedRecord = TenantOwnedRecord>(
      parentTable: TenantParentTable,
      id: string,
      columns = 'id, organization_id',
    ): Promise<T> {
      assertAllowedParentTable(parentTable);
      assertIdentifier(id);
      const rows = await table(parentTable).select<T>(columns, {
        filters: [{ operator: 'eq', column: 'id', value: id }],
        limit: 2,
      });
      if (rows.length !== 1) {
        throw new TenantDataIntegrityError('Tenant parent record does not exist or is ambiguous');
      }
      return rows[0];
    },
    members: {
      listActive: listActiveMembers,
      async assertActive(userId: string): Promise<OrganizationMemberDirectoryEntry> {
        assertIdentifier(userId);
        const matches = (await listActiveMembers()).filter((member) => member.user_id === userId);
        if (matches.length !== 1) {
          throw new TenantDataIntegrityError('Assignee is not one active member of this organization');
        }
        return matches[0];
      },
    },
  };
}
