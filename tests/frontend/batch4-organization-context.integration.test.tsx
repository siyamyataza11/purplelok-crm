import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testDependencies = vi.hoisted(() => ({
  client: null as FakeSupabase | null,
  auth: {
    user: { id: 'user-a' },
    session: { access_token: 'test-session' },
    profile: {
      id: 'user-a',
      email: 'user-a@example.test',
      full_name: 'User A',
      avatar_url: null,
      phone: null,
      position: null,
      role: 'staff',
      active: true,
      created_at: '2026-08-28T00:00:00.000Z',
      updated_at: '2026-08-28T00:00:00.000Z',
    },
    loading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    refreshProfile: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (!testDependencies.client) throw new Error('Fake Supabase client is not configured');
      return testDependencies.client.from(table);
    },
  },
}));

vi.mock('@/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => testDependencies.auth,
}));

import App from '@/App';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { Sidebar } from '@/components/layout/Sidebar';
import { ToastProvider } from '@/components/ui/Toast';
import { OrganizationProvider, useOrganization } from '@/context/OrganizationContext';
import { PERMISSION_KEYS, type PermissionKey } from '@/lib/authorization';
import { ProjectsPage } from '@/pages/Projects';

const NOW = '2026-08-28T00:00:00.000Z';

type QueryResult = { data: unknown; error: { message: string } | null };
type Filter = { kind: 'eq' | 'in'; column: string; value: unknown };
type Operation = 'select' | 'insert' | 'update';

interface RecordedQuery {
  table: string;
  operation: Operation;
  payload?: unknown;
  filters: Filter[];
  signal?: AbortSignal;
}

class FakeQuery implements PromiseLike<QueryResult> {
  private operation: Operation = 'select';
  private payload?: unknown;
  private readonly filters: Filter[] = [];
  private signal?: AbortSignal;
  private result?: Promise<QueryResult>;

  constructor(private readonly client: FakeSupabase, private readonly table: string) {}

  select() { return this; }
  insert(payload: unknown) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload: unknown) { this.operation = 'update'; this.payload = payload; return this; }
  eq(column: string, value: unknown) { this.filters.push({ kind: 'eq', column, value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ kind: 'in', column, value }); return this; }
  order() { return this; }
  limit() { return this; }
  single() { return this; }
  maybeSingle() { return this; }

  abortSignal(signal: AbortSignal) {
    this.signal = signal;
    return this.execute();
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute() {
    if (!this.result) {
      const query: RecordedQuery = {
        table: this.table,
        operation: this.operation,
        payload: this.payload,
        filters: [...this.filters],
        signal: this.signal,
      };
      this.client.requests.push(query);
      this.result = Promise.resolve(this.client.handler(query));
    }
    return this.result;
  }
}

class FakeSupabase {
  readonly requests: RecordedQuery[] = [];
  handler: (query: RecordedQuery) => QueryResult | Promise<QueryResult>;

  constructor(handler: (query: RecordedQuery) => QueryResult | Promise<QueryResult>) {
    this.handler = handler;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

function ok(data: unknown): QueryResult {
  return { data, error: null };
}

function failure(message: string): QueryResult {
  return { data: null, error: { message } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function eq(query: RecordedQuery, column: string) {
  return query.filters.find((filter) => filter.kind === 'eq' && filter.column === column)?.value;
}

const organization = (id: string) => ({
  id,
  name: `Organization ${id.toUpperCase()}`,
  slug: `organization-${id}`,
  status: 'active',
  created_at: NOW,
  updated_at: NOW,
});

const membership = (userId: string, organizationId: string) => ({
  id: `membership-${userId}-${organizationId}`,
  organization_id: organizationId,
  user_id: userId,
  job_title: 'Tester',
  status: 'active',
  created_at: NOW,
  updated_at: NOW,
});

const role = (organizationId: string) => ({
  id: `role-${organizationId}`,
  organization_id: organizationId,
  name: 'Staff',
  key: 'staff',
  is_system: true,
  created_at: NOW,
  updated_at: NOW,
});

type Dataset = {
  membershipsByUser: Record<string, ReturnType<typeof membership>[]>;
  permissionsByOrganization: Record<string, PermissionKey[]>;
};

function datasetHandler(
  data: Dataset,
  override?: (query: RecordedQuery) => QueryResult | Promise<QueryResult> | undefined,
) {
  return (query: RecordedQuery): QueryResult | Promise<QueryResult> => {
    const overridden = override?.(query);
    if (overridden) return overridden;

    if (query.operation !== 'select') return ok(null);

    switch (query.table) {
      case 'organization_members':
        return ok(data.membershipsByUser[String(eq(query, 'user_id'))] ?? []);
      case 'organizations': {
        const ids = query.filters.find((filter) => filter.kind === 'in' && filter.column === 'id')?.value as string[];
        return ok((ids ?? []).map(organization));
      }
      case 'organization_member_roles': {
        const organizationId = String(eq(query, 'organization_id'));
        return ok([{ organization_role_id: `role-${organizationId}` }]);
      }
      case 'organization_roles': {
        const organizationId = String(eq(query, 'organization_id'));
        return ok([role(organizationId)]);
      }
      case 'organization_role_permissions': {
        const organizationId = String(eq(query, 'organization_id'));
        return ok((data.permissionsByOrganization[organizationId] ?? []).map((permission) => ({
          organization_role_id: `role-${organizationId}`,
          permission_key: permission,
        })));
      }
      case 'permissions':
        return ok(PERMISSION_KEYS.map((key) => ({ key })));
      case 'projects':
      case 'clients':
      case 'profiles':
      case 'project_milestones':
        return ok([]);
      default:
        return ok([]);
    }
  };
}

function baseDataset(permissions: PermissionKey[] = ['clients.read']): Dataset {
  return {
    membershipsByUser: { 'user-a': [membership('user-a', 'a')] },
    permissionsByOrganization: { a: permissions },
  };
}

let observedContext: ReturnType<typeof useOrganization> | null = null;

function ContextProbe() {
  observedContext = useOrganization();
  return (
    <div>
      <span data-testid="organization">{observedContext.currentOrganization?.id ?? 'none'}</span>
      <span data-testid="loading">{String(observedContext.isOrganizationLoading)}</span>
      <span data-testid="error">{observedContext.organizationError?.code ?? 'none'}</span>
      <span data-testid="permissions">{[...observedContext.permissions].sort().join(',')}</span>
    </div>
  );
}

function renderProvider(children: ReactNode = <ContextProbe />) {
  return render(<OrganizationProvider>{children}</OrganizationProvider>);
}

async function expectReady(organizationId = 'a') {
  await waitFor(() => expect(screen.getByTestId('organization').textContent).toBe(organizationId));
  expect(screen.getByTestId('loading').textContent).toBe('false');
  expect(screen.getByTestId('error').textContent).toBe('none');
}

beforeEach(() => {
  observedContext = null;
  testDependencies.auth.user = { id: 'user-a' };
  testDependencies.auth.session = { access_token: 'test-session' };
  testDependencies.auth.loading = false;
  testDependencies.auth.profile = {
    ...testDependencies.auth.profile,
    id: 'user-a',
    email: 'user-a@example.test',
    full_name: 'User A',
  };
  testDependencies.auth.signOut.mockReset();
});

describe('Batch 4 organization authorization integration', () => {
  it('boots through memberships, organizations, assignments, roles, permissions, and CRM readiness', async () => {
    const client = new FakeSupabase(datasetHandler(baseDataset(['clients.read', 'projects.read'])));
    testDependencies.client = client;
    renderProvider();
    await expectReady();

    expect(client.requests.map(({ table }) => table)).toEqual([
      'organization_members',
      'organizations',
      'organization_member_roles',
      'organization_roles',
      'organization_role_permissions',
      'permissions',
    ]);
    expect(screen.getByTestId('permissions').textContent).toBe('clients.read,projects.read');
  });

  it('fails closed when the membership query fails', async () => {
    testDependencies.client = new FakeSupabase(datasetHandler(baseDataset(), (query) =>
      query.table === 'organization_members' ? failure('membership query failed') : undefined));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('authorization_error'));
    expect(screen.getByTestId('organization').textContent).toBe('none');
  });

  it('fails closed when the organization query fails', async () => {
    testDependencies.client = new FakeSupabase(datasetHandler(baseDataset(), (query) =>
      query.table === 'organizations' ? failure('organization query failed') : undefined));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('authorization_error'));
    expect(observedContext?.permissions.size).toBe(0);
  });

  it('fails closed when the role-assignment query fails', async () => {
    testDependencies.client = new FakeSupabase(datasetHandler(baseDataset(), (query) =>
      query.table === 'organization_member_roles' ? failure('assignment query failed') : undefined));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('authorization_error'));
    expect(observedContext?.roles).toEqual([]);
  });

  it('fails closed when the permission catalogue query fails', async () => {
    testDependencies.client = new FakeSupabase(datasetHandler(baseDataset(), (query) =>
      query.table === 'permissions' ? failure('permission query failed') : undefined));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('authorization_error'));
    expect(observedContext?.permissions.size).toBe(0);
  });

  it('clears the actual resolved state while switching organizations', async () => {
    const pendingB = deferred<QueryResult>();
    const data: Dataset = {
      membershipsByUser: { 'user-a': [membership('user-a', 'a'), membership('user-a', 'b')] },
      permissionsByOrganization: { a: ['clients.read'], b: ['invoices.read'] },
    };
    let delayB = false;
    testDependencies.client = new FakeSupabase(datasetHandler(data, (query) =>
      delayB && query.table === 'organization_role_permissions' && eq(query, 'organization_id') === 'b'
        ? pendingB.promise
        : undefined));
    window.localStorage.setItem('purplelok.activeOrganization.v1:user-a', 'a');
    renderProvider();
    await expectReady('a');

    delayB = true;
    let switchPromise!: Promise<void>;
    act(() => { switchPromise = observedContext!.setActiveOrganization('b'); });
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('true'));
    expect(screen.getByTestId('organization').textContent).toBe('none');
    expect(observedContext?.permissions.size).toBe(0);

    pendingB.resolve(ok([{ organization_role_id: 'role-b', permission_key: 'invoices.read' }]));
    await act(async () => { await switchPromise; });
    await expectReady('b');
  });

  it('does not retain stale target authority after a failed organization switch', async () => {
    const data: Dataset = {
      membershipsByUser: { 'user-a': [membership('user-a', 'a'), membership('user-a', 'b')] },
      permissionsByOrganization: { a: ['clients.read'], b: ['invoices.read'] },
    };
    let failB = false;
    testDependencies.client = new FakeSupabase(datasetHandler(data, (query) =>
      failB && query.table === 'organization_member_roles' && eq(query, 'organization_id') === 'b'
        ? failure('B assignments unavailable')
        : undefined));
    window.localStorage.setItem('purplelok.activeOrganization.v1:user-a', 'a');
    renderProvider();
    await expectReady('a');

    failB = true;
    await act(async () => { await observedContext!.setActiveOrganization('b'); });
    expect(screen.getByTestId('organization').textContent).toBe('none');
    expect(screen.getByTestId('error').textContent).toBe('authorization_error');
    expect(observedContext?.permissions.size).toBe(0);
  });

  it('prevents stale B responses from overwriting a rapid A to B to A switch', async () => {
    const pendingB = deferred<QueryResult>();
    const data: Dataset = {
      membershipsByUser: { 'user-a': [membership('user-a', 'a'), membership('user-a', 'b')] },
      permissionsByOrganization: { a: ['clients.read'], b: ['invoices.read'] },
    };
    let delayB = false;
    testDependencies.client = new FakeSupabase(datasetHandler(data, (query) =>
      delayB && query.table === 'organization_role_permissions' && eq(query, 'organization_id') === 'b'
        ? pendingB.promise
        : undefined));
    window.localStorage.setItem('purplelok.activeOrganization.v1:user-a', 'a');
    renderProvider();
    await expectReady('a');

    delayB = true;
    let switchToB!: Promise<void>;
    act(() => { switchToB = observedContext!.setActiveOrganization('b'); });
    await waitFor(() => expect(screen.getByTestId('organization').textContent).toBe('none'));
    await act(async () => { await observedContext!.setActiveOrganization('a'); });
    await expectReady('a');
    pendingB.resolve(ok([{ organization_role_id: 'role-b', permission_key: 'invoices.read' }]));
    await act(async () => { await switchToB; });
    expect(screen.getByTestId('organization').textContent).toBe('a');
    expect(screen.getByTestId('permissions').textContent).toBe('clients.read');
  });

  it('clears a previous user immediately when logout occurs during authorization queries', async () => {
    const pendingMemberships = deferred<QueryResult>();
    testDependencies.client = new FakeSupabase(datasetHandler(baseDataset(), (query) =>
      query.table === 'organization_members' && eq(query, 'user_id') === 'user-a'
        ? pendingMemberships.promise
        : undefined));
    const view = renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('true'));

    testDependencies.auth.user = null as never;
    testDependencies.auth.session = null as never;
    view.rerender(<OrganizationProvider><ContextProbe /></OrganizationProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    pendingMemberships.resolve(ok([membership('user-a', 'a')]));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('organization').textContent).toBe('none');
  });

  it('does not leak the previous context when a different user logs in immediately', async () => {
    const pendingUserA = deferred<QueryResult>();
    const data: Dataset = {
      membershipsByUser: {
        'user-a': [membership('user-a', 'a')],
        'user-b': [membership('user-b', 'b')],
      },
      permissionsByOrganization: { a: ['clients.read'], b: ['invoices.read'] },
    };
    testDependencies.client = new FakeSupabase(datasetHandler(data, (query) =>
      query.table === 'organization_members' && eq(query, 'user_id') === 'user-a'
        ? pendingUserA.promise
        : undefined));
    const view = renderProvider();

    testDependencies.auth.user = { id: 'user-b' };
    testDependencies.auth.session = { access_token: 'user-b-session' };
    view.rerender(<OrganizationProvider><ContextProbe /></OrganizationProvider>);
    await expectReady('b');
    pendingUserA.resolve(ok([membership('user-a', 'a')]));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('organization').textContent).toBe('b');
    expect(screen.getByTestId('permissions').textContent).toBe('invoices.read');
  });

  it('rejects a forged localStorage organization after fresh membership validation', async () => {
    const data: Dataset = {
      membershipsByUser: { 'user-a': [membership('user-a', 'a'), membership('user-a', 'b')] },
      permissionsByOrganization: { a: ['clients.read'], b: ['invoices.read'] },
    };
    testDependencies.client = new FakeSupabase(datasetHandler(data));
    window.localStorage.setItem('purplelok.activeOrganization.v1:user-a', 'forged');
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('selection_required'));
    expect(window.localStorage.getItem('purplelok.activeOrganization.v1:user-a')).toBeNull();
    expect(screen.getByTestId('organization').textContent).toBe('none');
  });

  it('accepts a valid localStorage preference only after server revalidation', async () => {
    const data: Dataset = {
      membershipsByUser: { 'user-a': [membership('user-a', 'a'), membership('user-a', 'b')] },
      permissionsByOrganization: { a: ['clients.read'], b: ['invoices.read'] },
    };
    testDependencies.client = new FakeSupabase(datasetHandler(data));
    window.localStorage.setItem('purplelok.activeOrganization.v1:user-a', 'b');
    renderProvider();
    await expectReady('b');
    expect(screen.getByTestId('permissions').textContent).toBe('invoices.read');
  });

  it('removes Organization A permissions when Organization B becomes active', async () => {
    const data: Dataset = {
      membershipsByUser: { 'user-a': [membership('user-a', 'a'), membership('user-a', 'b')] },
      permissionsByOrganization: { a: ['clients.read'], b: ['invoices.read'] },
    };
    testDependencies.client = new FakeSupabase(datasetHandler(data));
    window.localStorage.setItem('purplelok.activeOrganization.v1:user-a', 'a');
    renderProvider();
    await expectReady('a');
    await act(async () => { await observedContext!.setActiveOrganization('b'); });
    await expectReady('b');
    expect(observedContext?.hasPermission('clients.read')).toBe(false);
    expect(observedContext?.hasPermission('invoices.read')).toBe(true);
  });

  it('keeps the actual App shell hidden until organization context resolution', async () => {
    const pendingMemberships = deferred<QueryResult>();
    testDependencies.client = new FakeSupabase(datasetHandler(baseDataset(), (query) =>
      query.table === 'organization_members' ? pendingMemberships.promise : undefined));
    render(<App />);
    expect(await screen.findByText('Verifying organization access...')).toBeTruthy();
    expect(screen.queryByText('Dashboard')).toBeNull();

    pendingMemberships.resolve(ok([membership('user-a', 'a')]));
    await waitFor(() => expect(screen.queryByText('Dashboard')).not.toBeNull());
  });

  it('filters unauthorized modules from the actual Sidebar', async () => {
    testDependencies.client = new FakeSupabase(datasetHandler(baseDataset(['clients.read'])));
    renderProvider(<><ContextProbe /><Sidebar current="dashboard" onNavigate={() => undefined} collapsed={false} /></>);
    await expectReady();
    expect(screen.queryByText('Clients')).not.toBeNull();
    expect(screen.queryByText('Invoices')).toBeNull();
    expect(screen.queryByText('Reports')).toBeNull();
  });

  it('blocks unauthorized children in the actual PermissionGate', async () => {
    testDependencies.client = new FakeSupabase(datasetHandler(baseDataset(['clients.read'])));
    renderProvider(<><ContextProbe /><PermissionGate permission="invoices.write" fallback={<span>blocked</span>}><span>allowed</span></PermissionGate></>);
    await expectReady();
    expect(screen.queryByText('allowed')).toBeNull();
    expect(screen.queryByText('blocked')).not.toBeNull();
  });

  it('projects.write without projects.manage cannot assign team members or submit assigned_to', async () => {
    const client = projectClient(['projects.read', 'projects.write']);
    testDependencies.client = client;
    renderProjectPage();
    await openProjectModal();
    expect(screen.queryByText('Assign Team Members')).toBeNull();
    await createProject();
    const payload = findMutation(client, 'insert');
    expect(payload).not.toHaveProperty('assigned_to');
    expect(payload).not.toHaveProperty('health');
    expect(payload).not.toHaveProperty('status');
  });

  it('projects.write without projects.manage cannot submit health changes', async () => {
    const client = projectClient(['projects.read', 'projects.write'], [sampleProject()]);
    testDependencies.client = client;
    renderProjectPage();
    fireEvent.click(await screen.findByText('Managed Project'));
    const health = screen.getByText('Health Status').parentElement!.querySelector('select')!;
    expect(health.disabled).toBe(true);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '55' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(client.requests.some((query) => query.table === 'projects' && query.operation === 'update')).toBe(true));
    expect(findMutation(client, 'update')).toEqual({ progress: 55 });
  });

  it('projects.manage enables assignment and health management with enforced payloads', async () => {
    const client = projectClient(['projects.read', 'projects.write', 'projects.manage'], [sampleProject()]);
    testDependencies.client = client;
    renderProjectPage();
    await openProjectModal();
    expect(screen.queryByText('Assign Team Members')).not.toBeNull();
    fireEvent.click(screen.getByLabelText('Team Member'));
    await createProject();
    expect(findMutation(client, 'insert')).toHaveProperty('assigned_to', ['team-user']);

    fireEvent.click(await screen.findByText('Managed Project'));
    const health = screen.getByText('Health Status').parentElement!.querySelector('select')!;
    expect(health.disabled).toBe(false);
    fireEvent.change(health, { target: { value: 'delayed' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(client.requests.filter((query) => query.table === 'projects' && query.operation === 'update').length).toBe(1));
    expect(findMutation(client, 'update')).toEqual({ progress: 10, health: 'delayed' });
  });
});

function sampleProject() {
  return {
    id: 'project-1',
    name: 'Managed Project',
    client_id: 'client-1',
    type: 'website',
    status: 'planning',
    description: null,
    start_date: null,
    due_date: null,
    budget: 1000,
    progress: 10,
    health: 'on_track',
    assigned_to: [],
    created_by: 'user-a',
    created_at: NOW,
    updated_at: NOW,
    client: { company_name: 'Client One' },
  };
}

function projectClient(permissions: PermissionKey[], projects: ReturnType<typeof sampleProject>[] = []) {
  const data = baseDataset(permissions);
  return new FakeSupabase(datasetHandler(data, (query) => {
    if (query.operation !== 'select') return ok(null);
    if (query.table === 'projects') return ok(projects);
    if (query.table === 'clients') return ok([{
      id: 'client-1',
      company_name: 'Client One',
    }]);
    if (query.table === 'profiles') return ok([{
      id: 'team-user',
      full_name: 'Team Member',
    }]);
    if (query.table === 'project_milestones') return ok([]);
    return undefined;
  }));
}

function renderProjectPage() {
  return render(
    <OrganizationProvider>
      <ToastProvider>
        <ProjectsPage />
      </ToastProvider>
    </OrganizationProvider>,
  );
}

async function openProjectModal() {
  fireEvent.click(await screen.findByText('New Project'));
  await screen.findByText('Create Project');
}

async function createProject() {
  const projectName = screen.getByText('Project Name').parentElement!.querySelector('input')!;
  const client = screen.getByText('Client').parentElement!.querySelector('select')!;
  fireEvent.change(projectName, { target: { value: 'New Project' } });
  fireEvent.change(client, { target: { value: 'client-1' } });
  fireEvent.click(screen.getByText('Create Project'));
  await waitFor(() => expect(screen.queryByText('Project created')).not.toBeNull());
}

function findMutation(client: FakeSupabase, operation: 'insert' | 'update') {
  const query = client.requests.find((request) => request.table === 'projects' && request.operation === operation);
  if (!query) throw new Error(`No projects ${operation} request was recorded`);
  return query.payload as Record<string, unknown>;
}
