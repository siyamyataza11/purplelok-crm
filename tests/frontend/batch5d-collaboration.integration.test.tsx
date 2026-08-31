import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: {
    profile: {
      id: 'user-a', email: 'user-a@example.test', full_name: 'User A', avatar_url: null,
      phone: null, position: null, role: 'staff', active: true,
      created_at: '2026-08-28T00:00:00.000Z', updated_at: '2026-08-28T00:00:00.000Z',
    } as Record<string, unknown> | null,
    signOut: vi.fn(),
  },
  organization: {
    currentOrganization: { id: 'a', name: 'Organization A', slug: 'a', status: 'active' } as Record<string, unknown> | null,
    membership: { job_title: 'Tester' },
    roles: [{ id: 'role-a', name: 'Staff' }],
    permissions: new Set<string>(),
  },
  tenant: null as unknown,
  toast: vi.fn(),
  channels: [] as FakeRealtimeChannel[],
  removeChannel: vi.fn(),
}));

class FakeRealtimeChannel {
  callback: ((payload: { new?: Record<string, unknown> }) => void) | null = null;
  specification: Record<string, unknown> | null = null;

  constructor(readonly name: string) {}

  on(
    _kind: string,
    specification: Record<string, unknown>,
    callback: (payload: { new?: Record<string, unknown> }) => void,
  ) {
    this.specification = specification;
    this.callback = callback;
    return this;
  }

  subscribe() { return this; }
}

vi.mock('@/context/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => state.organization }));
vi.mock('@/context/TenantDataContext', () => ({ useTenantData: () => state.tenant }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ add: state.toast }) }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (name: string) => {
      const channel = new FakeRealtimeChannel(name);
      state.channels.push(channel);
      return channel;
    },
    removeChannel: (channel: FakeRealtimeChannel) => state.removeChannel(channel),
  },
}));

import { Topbar } from '@/components/layout/Topbar';
import { ChatPage } from '@/pages/Chat';

const NOW = '2026-08-28T00:00:00.000Z';
const organization = (id: string) => ({ id, name: `Organization ${id.toUpperCase()}`, slug: id, status: 'active' });
const notification = (id: string, organizationId = 'a', userId = 'user-a') => ({
  id, organization_id: organizationId, user_id: userId, title: `Notification ${id}`,
  body: null, type: 'info', read: false, link: null, created_at: NOW,
});
const channel = (id: string, organizationId = 'a') => ({
  id, organization_id: organizationId, name: `Channel ${id}`, description: null,
  created_by: 'user-a', created_at: NOW,
});
const message = (id: string, channelId: string, organizationId = 'a') => ({
  id, organization_id: organizationId, channel_id: channelId, author_id: 'user-a',
  body: `Message ${id}`, created_at: NOW,
});
const member = (organizationId = 'a', userId = 'user-a') => ({
  organization_id: organizationId, membership_id: `membership-${organizationId}-${userId}`,
  user_id: userId, full_name: `User ${userId}`, email: `${userId}@example.test`,
  job_title: null, avatar_url: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

interface TenantCalls {
  selects: Array<{ table: string; options: Record<string, unknown> }>;
  inserts: Array<{ table: string; payload: Record<string, unknown>; options?: Record<string, unknown> }>;
  assertions: Array<{ table: string; id: string }>;
  activeMembers: string[];
  marked: Array<{ id: string; userId: string }>;
}

interface TenantHandlers {
  select?: (table: string, options: Record<string, unknown>) => Promise<unknown[]>;
  insert?: (table: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown[]>;
  assertRecord?: (table: string, id: string) => Promise<unknown>;
  assertActive?: (userId: string) => Promise<unknown>;
  listMembers?: () => Promise<unknown[]>;
  markRead?: (id: string, userId: string) => Promise<unknown>;
}

function makeTenant(organizationId: string, handlers: TenantHandlers = {}) {
  const calls: TenantCalls = { selects: [], inserts: [], assertions: [], activeMembers: [], marked: [] };
  const defaultChannel = channel(`${organizationId}-channel`, organizationId);
  const api = {
    table: (table: string) => ({
      select: async (_columns = '*', options: Record<string, unknown> = {}) => {
        void _columns;
        calls.selects.push({ table, options });
        if (handlers.select) return handlers.select(table, options);
        if (table === 'channels') return [defaultChannel];
        if (table === 'messages') return [message(`${organizationId}-message`, defaultChannel.id, organizationId)];
        return [];
      },
      insert: async (payload: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.inserts.push({ table, payload, options });
        if (handlers.insert) return handlers.insert(table, payload, options);
        if (table === 'channels') return [channel(`${organizationId}-new-channel`, organizationId)];
        return [];
      },
    }),
    assertTenantRecord: async (table: string, id: string) => {
      calls.assertions.push({ table, id });
      if (handlers.assertRecord) return handlers.assertRecord(table, id);
      return { id, organization_id: organizationId };
    },
    members: {
      listActive: async () => handlers.listMembers?.() ?? [member(organizationId)],
      assertActive: async (userId: string) => {
        calls.activeMembers.push(userId);
        if (handlers.assertActive) return handlers.assertActive(userId);
        return member(organizationId, userId);
      },
    },
    notifications: {
      markRead: async (id: string, userId: string) => {
        calls.marked.push({ id, userId });
        if (handlers.markRead) return handlers.markRead(id, userId);
        return { id, organization_id: organizationId };
      },
    },
  };
  return { api, calls };
}

function renderTopbar() {
  return render(<Topbar
    onToggleSidebar={vi.fn()}
    onNavigate={vi.fn()}
    searchQuery=""
    onSearchChange={vi.fn()}
  />);
}

function openNotifications(container: HTMLElement) {
  const button = container.querySelector('.lucide-bell')?.closest('button');
  if (!button) throw new Error('Notification button was not rendered');
  fireEvent.click(button);
}

function setIdentity(organizationId: string | null, userId: string | null = 'user-a') {
  state.organization.currentOrganization = organizationId ? organization(organizationId) : null;
  state.auth.profile = userId ? {
    id: userId, email: `${userId}@example.test`, full_name: `User ${userId}`, avatar_url: null,
    phone: null, position: null, role: 'staff', active: true, created_at: NOW, updated_at: NOW,
  } : null;
}

beforeEach(() => {
  setIdentity('a');
  state.organization.membership = { job_title: 'Tester' };
  state.organization.roles = [{ id: 'role-a', name: 'Staff' }];
  state.organization.permissions = new Set();
  state.toast.mockReset();
  state.auth.signOut.mockReset();
  state.channels.splice(0);
  state.removeChannel.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

describe('Batch 5D Topbar integration', () => {
  it('renders and scopes notification loading to the active tenant and current user', async () => {
    const own = notification('own');
    const tenant = makeTenant('a', { select: async () => [own] });
    state.tenant = tenant.api;
    const view = renderTopbar();
    await waitFor(() => expect(tenant.calls.selects).toHaveLength(1));
    expect(tenant.calls.selects[0]).toMatchObject({
      table: 'notifications',
      options: { filters: [{ operator: 'eq', column: 'user_id', value: 'user-a' }] },
    });
    openNotifications(view.container);
    expect(await screen.findByText('Notification own')).toBeTruthy();
  });

  it('rejects a foreign notification UUID without optimistic success', async () => {
    const foreign = notification('demo-foreign', 'demo');
    let selects = 0;
    const tenant = makeTenant('a', {
      select: async () => (++selects === 1 ? [foreign] : []),
    });
    state.tenant = tenant.api;
    const view = renderTopbar();
    openNotifications(view.container);
    expect(await screen.findByText('Notification demo-foreign')).toBeTruthy();
    fireEvent.click(screen.getByText('Mark all read'));
    await waitFor(() => expect(tenant.calls.selects).toHaveLength(2));
    expect(tenant.calls.marked).toEqual([]);
    expect(screen.getByText('Mark all read')).toBeTruthy();
  });

  it('marks only the verified active-tenant current-user notification on success', async () => {
    const own = notification('own');
    const tenant = makeTenant('a', { select: async () => [own] });
    state.tenant = tenant.api;
    const view = renderTopbar();
    openNotifications(view.container);
    expect(await screen.findByText('Notification own')).toBeTruthy();
    fireEvent.click(screen.getByText('Mark all read'));
    await waitFor(() => expect(tenant.calls.marked).toEqual([{ id: 'own', userId: 'user-a' }]));
    await waitFor(() => expect(screen.queryByText('Mark all read')).toBeNull());
    const preflight = tenant.calls.selects[1].options.filters as Array<Record<string, unknown>>;
    expect(preflight).toContainEqual({ operator: 'eq', column: 'user_id', value: 'user-a' });
    expect(preflight).toContainEqual({ operator: 'in', column: 'id', values: ['own'] });
  });

  it('clears A immediately and ignores its stale response after switching to B', async () => {
    const tenantA = makeTenant('a', { select: async () => [notification('a')] });
    state.tenant = tenantA.api;
    const view = renderTopbar();
    openNotifications(view.container);
    expect(await screen.findByText('Notification a')).toBeTruthy();

    const pendingA = deferred<unknown[]>();
    const refreshingA = makeTenant('a', { select: () => pendingA.promise });
    state.tenant = refreshingA.api;
    view.rerender(<Topbar onToggleSidebar={vi.fn()} onNavigate={vi.fn()} searchQuery="" onSearchChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No notifications yet')).toBeTruthy());

    const tenantB = makeTenant('b', { select: async () => [notification('b', 'b')] });
    setIdentity('b');
    state.tenant = tenantB.api;
    view.rerender(<Topbar onToggleSidebar={vi.fn()} onNavigate={vi.fn()} searchQuery="" onSearchChange={vi.fn()} />);
    expect(await screen.findByText('Notification b')).toBeTruthy();
    pendingA.resolve([notification('a')]);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('Notification a')).toBeNull();
  });

  it('clears on logout and ignores a late notification response', async () => {
    const initial = makeTenant('a', { select: async () => [notification('loaded')] });
    state.tenant = initial.api;
    const view = renderTopbar();
    openNotifications(view.container);
    expect(await screen.findByText('Notification loaded')).toBeTruthy();

    const pending = deferred<unknown[]>();
    const tenant = makeTenant('a', { select: () => pending.promise });
    state.tenant = tenant.api;
    view.rerender(<Topbar onToggleSidebar={vi.fn()} onNavigate={vi.fn()} searchQuery="" onSearchChange={vi.fn()} />);
    setIdentity(null, null);
    view.rerender(<Topbar onToggleSidebar={vi.fn()} onNavigate={vi.fn()} searchQuery="" onSearchChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No notifications yet')).toBeTruthy());
    pending.resolve([notification('late')]);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('Notification late')).toBeNull();
  });

  it('marks only verified current-user tenant notifications and suppresses stale completion', async () => {
    const own = notification('own');
    let selects = 0;
    const mutation = deferred<unknown>();
    const tenantA = makeTenant('a', {
      select: async () => (++selects === 1 ? [own] : [own]),
      markRead: () => mutation.promise,
    });
    state.tenant = tenantA.api;
    const view = renderTopbar();
    openNotifications(view.container);
    expect(await screen.findByText('Notification own')).toBeTruthy();
    fireEvent.click(screen.getByText('Mark all read'));
    await waitFor(() => expect(tenantA.calls.marked).toEqual([{ id: 'own', userId: 'user-a' }]));

    const tenantB = makeTenant('b', { select: async () => [notification('b', 'b')] });
    setIdentity('b');
    state.tenant = tenantB.api;
    view.rerender(<Topbar onToggleSidebar={vi.fn()} onNavigate={vi.fn()} searchQuery="" onSearchChange={vi.fn()} />);
    mutation.resolve({});
    expect(await screen.findByText('Notification b')).toBeTruthy();
    expect(screen.getByText('Mark all read')).toBeTruthy();
  });
});

describe('Batch 5D Chat integration', () => {
  it('renders without a TDZ ReferenceError and performs the initial tenant channel load', async () => {
    const tenant = makeTenant('a');
    state.tenant = tenant.api;
    render(<ChatPage />);
    expect(await screen.findAllByText('Channel a-channel')).toHaveLength(2);
    expect(tenant.calls.selects[0].table).toBe('channels');
    await waitFor(() => expect(tenant.calls.assertions).toContainEqual({ table: 'channels', id: 'a-channel' }));
  });

  it('rejects a known foreign channel before message load or insert', async () => {
    const foreign = channel('foreign-channel', 'b');
    const tenant = makeTenant('a', {
      select: async (table) => table === 'channels' ? [foreign] : [],
      assertRecord: async (_table, id) => {
        if (id === foreign.id) throw new Error('foreign channel');
        return { id, organization_id: 'a' };
      },
    });
    state.tenant = tenant.api;
    render(<ChatPage />);
    expect(await screen.findAllByText('Channel foreign-channel')).toHaveLength(2);
    await waitFor(() => expect(tenant.calls.assertions.length).toBeGreaterThan(0));
    expect(tenant.calls.selects.filter(({ table }) => table === 'messages')).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText('Message #Channel foreign-channel'), { target: { value: 'forged' } });
    fireEvent.click(screen.getByPlaceholderText('Message #Channel foreign-channel').parentElement!.querySelector('button')!);
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith('error', 'foreign channel'));
    expect(tenant.calls.inserts).toEqual([]);
  });

  it('uses the authenticated profile as sender and leaves tenant injection to the tenant API', async () => {
    const tenant = makeTenant('a');
    state.tenant = tenant.api;
    render(<ChatPage />);
    const input = await screen.findByPlaceholderText('Message #Channel a-channel');
    fireEvent.change(input, { target: { value: 'Hello tenant' } });
    fireEvent.click(input.parentElement!.querySelector('button')!);
    await waitFor(() => expect(tenant.calls.inserts.some(({ table }) => table === 'messages')).toBe(true));
    const insert = tenant.calls.inserts.find(({ table }) => table === 'messages')!;
    expect(insert.payload).toEqual({ channel_id: 'a-channel', author_id: 'user-a', body: 'Hello tenant' });
    expect(insert.payload).not.toHaveProperty('organization_id');
    expect(tenant.calls.activeMembers).toContain('user-a');
  });

  it('creates a channel through active membership with no caller-controlled tenant', async () => {
    const tenant = makeTenant('a');
    state.tenant = tenant.api;
    render(<ChatPage />);
    await screen.findAllByText('Channel a-channel');
    fireEvent.click(screen.getAllByRole('button')[0]);
    const input = screen.getByPlaceholderText('Channel name');
    fireEvent.change(input, { target: { value: 'engineering' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(tenant.calls.inserts.some(({ table }) => table === 'channels')).toBe(true));
    const insert = tenant.calls.inserts.find(({ table }) => table === 'channels')!;
    expect(insert.payload).toEqual({ name: 'engineering', created_by: 'user-a' });
    expect(insert.payload).not.toHaveProperty('organization_id');
  });

  it('blocks both channel and message writes for inactive membership', async () => {
    const tenant = makeTenant('a', { assertActive: async () => { throw new Error('inactive member'); } });
    state.tenant = tenant.api;
    render(<ChatPage />);
    const messageInput = await screen.findByPlaceholderText('Message #Channel a-channel');
    fireEvent.change(messageInput, { target: { value: 'blocked' } });
    fireEvent.click(messageInput.parentElement!.querySelector('button')!);
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith('error', 'inactive member'));
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.change(screen.getByPlaceholderText('Channel name'), { target: { value: 'blocked-channel' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(state.toast).toHaveBeenCalledTimes(2));
    expect(tenant.calls.inserts).toEqual([]);
  });

  it('uses a tenant-specific filtered subscription and independently rejects wrong events', async () => {
    const tenant = makeTenant('a');
    state.tenant = tenant.api;
    render(<ChatPage />);
    await screen.findAllByText('Channel a-channel');
    const subscription = state.channels[0];
    expect(subscription.name).toBe('messages:a');
    expect(subscription.specification).toMatchObject({
      table: 'messages', filter: 'organization_id=eq.a', event: 'INSERT', schema: 'public',
    });
    const before = tenant.calls.selects.filter(({ table }) => table === 'messages').length;
    act(() => subscription.callback?.({ new: { organization_id: 'b', channel_id: 'a-channel' } }));
    act(() => subscription.callback?.({ new: { organization_id: 'a', channel_id: 'other-channel' } }));
    await act(async () => { await Promise.resolve(); });
    expect(tenant.calls.selects.filter(({ table }) => table === 'messages')).toHaveLength(before);
    act(() => subscription.callback?.({ new: { organization_id: 'a', channel_id: 'a-channel' } }));
    await waitFor(() => expect(tenant.calls.selects.filter(({ table }) => table === 'messages')).toHaveLength(before + 1));
  });

  it('switches A to B, removes A subscription, and ignores late A reads and events', async () => {
    const pendingA = deferred<unknown[]>();
    const tenantA = makeTenant('a', {
      select: async (table) => table === 'messages' ? pendingA.promise : [channel('a-channel', 'a')],
    });
    state.tenant = tenantA.api;
    const view = render(<ChatPage />);
    await screen.findAllByText('Channel a-channel');
    await waitFor(() => expect(tenantA.calls.selects.some(({ table }) => table === 'messages')).toBe(true));
    const subscriptionA = state.channels[0];

    const tenantB = makeTenant('b');
    setIdentity('b');
    state.tenant = tenantB.api;
    view.rerender(<ChatPage />);
    expect(await screen.findAllByText('Channel b-channel')).toHaveLength(2);
    expect(screen.queryByText('Channel a-channel')).toBeNull();
    expect(state.removeChannel).toHaveBeenCalledWith(subscriptionA);
    expect(state.channels.some(({ name }) => name === 'messages:b')).toBe(true);

    pendingA.resolve([message('late-a', 'a-channel', 'a')]);
    act(() => subscriptionA.callback?.({ new: { organization_id: 'a', channel_id: 'a-channel' } }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('Message late-a')).toBeNull();
  });

  it('survives rapid A to B to A without accepting the stale B channel response', async () => {
    const tenantA1 = makeTenant('a');
    state.tenant = tenantA1.api;
    const view = render(<ChatPage />);
    await screen.findAllByText('Channel a-channel');

    const pendingB = deferred<unknown[]>();
    const tenantB = makeTenant('b', {
      select: async (table) => table === 'channels' ? pendingB.promise : [],
    });
    setIdentity('b');
    state.tenant = tenantB.api;
    view.rerender(<ChatPage />);

    const tenantA2 = makeTenant('a');
    setIdentity('a');
    state.tenant = tenantA2.api;
    view.rerender(<ChatPage />);
    expect(await screen.findAllByText('Channel a-channel')).toHaveLength(2);
    pendingB.resolve([channel('stale-b', 'b')]);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('Channel stale-b')).toBeNull();
  });

  it('removes the subscription and clears collaboration state on logout', async () => {
    const tenant = makeTenant('a');
    state.tenant = tenant.api;
    const view = render(<ChatPage />);
    await screen.findAllByText('Channel a-channel');
    const subscription = state.channels[0];
    setIdentity(null, null);
    view.rerender(<ChatPage />);
    await waitFor(() => expect(state.removeChannel).toHaveBeenCalledWith(subscription));
    expect(screen.queryByText('Channel a-channel')).toBeNull();
    expect(screen.getByText('Select a channel')).toBeTruthy();
  });

  it('does not contaminate B when an A message or channel write completes late', async () => {
    const pendingMessage = deferred<unknown[]>();
    const pendingChannel = deferred<unknown[]>();
    const tenantA = makeTenant('a', {
      insert: (table) => table === 'messages' ? pendingMessage.promise : pendingChannel.promise,
    });
    state.tenant = tenantA.api;
    const view = render(<ChatPage />);
    const messageInput = await screen.findByPlaceholderText('Message #Channel a-channel');
    fireEvent.change(messageInput, { target: { value: 'A write' } });
    fireEvent.click(messageInput.parentElement!.querySelector('button')!);
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.change(screen.getByPlaceholderText('Channel name'), { target: { value: 'A new' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(tenantA.calls.inserts).toHaveLength(2));

    const tenantB = makeTenant('b');
    setIdentity('b');
    state.tenant = tenantB.api;
    view.rerender(<ChatPage />);
    expect(await screen.findAllByText('Channel b-channel')).toHaveLength(2);
    pendingMessage.resolve([]);
    pendingChannel.resolve([channel('late-a-channel', 'a')]);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('Channel late-a-channel')).toBeNull();
    expect(screen.queryByDisplayValue('A write')).toBeNull();
  });

  it('keeps B channels when the superseded A channel load rejects late', async () => {
    const pendingA = deferred<unknown[]>();
    const tenantA = makeTenant('a', {
      select: (table) => table === 'channels' ? pendingA.promise : Promise.resolve([]),
    });
    state.tenant = tenantA.api;
    const view = render(<ChatPage />);
    await waitFor(() => expect(tenantA.calls.selects.some(({ table }) => table === 'channels')).toBe(true));

    const tenantB = makeTenant('b');
    setIdentity('b');
    state.tenant = tenantB.api;
    view.rerender(<ChatPage />);
    expect(await screen.findAllByText('Channel b-channel')).toHaveLength(2);
    pendingA.reject(new Error('late A channel failure'));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getAllByText('Channel b-channel')).toHaveLength(2);
    expect(screen.getByText('Message b-message')).toBeTruthy();
  });

  it('keeps B messages when the superseded A message load rejects late', async () => {
    const pendingMessagesA = deferred<unknown[]>();
    const tenantA = makeTenant('a', {
      select: (table) => table === 'messages'
        ? pendingMessagesA.promise
        : Promise.resolve([channel('a-channel', 'a')]),
    });
    state.tenant = tenantA.api;
    const view = render(<ChatPage />);
    await screen.findAllByText('Channel a-channel');
    await waitFor(() => expect(tenantA.calls.selects.some(({ table }) => table === 'messages')).toBe(true));

    const tenantB = makeTenant('b');
    setIdentity('b');
    state.tenant = tenantB.api;
    view.rerender(<ChatPage />);
    expect(await screen.findByText('Message b-message')).toBeTruthy();
    pendingMessagesA.reject(new Error('late A message failure'));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Message b-message')).toBeTruthy();
  });

  it('suppresses an A send rejection after switching to B', async () => {
    const pendingSendA = deferred<unknown[]>();
    const tenantA = makeTenant('a', {
      insert: (table) => table === 'messages' ? pendingSendA.promise : Promise.resolve([]),
    });
    state.tenant = tenantA.api;
    const view = render(<ChatPage />);
    const input = await screen.findByPlaceholderText('Message #Channel a-channel');
    fireEvent.change(input, { target: { value: 'A pending send' } });
    fireEvent.click(input.parentElement!.querySelector('button')!);
    await waitFor(() => expect(tenantA.calls.inserts.some(({ table }) => table === 'messages')).toBe(true));

    const tenantB = makeTenant('b');
    setIdentity('b');
    state.tenant = tenantB.api;
    view.rerender(<ChatPage />);
    expect(await screen.findByText('Message b-message')).toBeTruthy();
    pendingSendA.reject(new Error('late A send failure'));
    await act(async () => { await Promise.resolve(); });
    expect(state.toast).not.toHaveBeenCalled();
    expect(screen.getByText('Message b-message')).toBeTruthy();
  });

  it('suppresses an A channel-create rejection after switching to B', async () => {
    const pendingCreateA = deferred<unknown[]>();
    const tenantA = makeTenant('a', {
      insert: (table) => table === 'channels' ? pendingCreateA.promise : Promise.resolve([]),
    });
    state.tenant = tenantA.api;
    const view = render(<ChatPage />);
    await screen.findAllByText('Channel a-channel');
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.change(screen.getByPlaceholderText('Channel name'), { target: { value: 'A pending channel' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(tenantA.calls.inserts.some(({ table }) => table === 'channels')).toBe(true));

    const tenantB = makeTenant('b');
    setIdentity('b');
    state.tenant = tenantB.api;
    view.rerender(<ChatPage />);
    expect(await screen.findAllByText('Channel b-channel')).toHaveLength(2);
    pendingCreateA.reject(new Error('late A channel-create failure'));
    await act(async () => { await Promise.resolve(); });
    expect(state.toast).not.toHaveBeenCalled();
    expect(screen.getAllByText('Channel b-channel')).toHaveLength(2);
  });

  it('suppresses a pending tenant operation rejection after logout', async () => {
    const pendingSend = deferred<unknown[]>();
    const tenantA = makeTenant('a', {
      insert: (table) => table === 'messages' ? pendingSend.promise : Promise.resolve([]),
    });
    state.tenant = tenantA.api;
    const view = render(<ChatPage />);
    const input = await screen.findByPlaceholderText('Message #Channel a-channel');
    fireEvent.change(input, { target: { value: 'pending logout send' } });
    fireEvent.click(input.parentElement!.querySelector('button')!);
    await waitFor(() => expect(tenantA.calls.inserts.some(({ table }) => table === 'messages')).toBe(true));

    setIdentity(null, null);
    view.rerender(<ChatPage />);
    await waitFor(() => expect(screen.getByText('Select a channel')).toBeTruthy());
    pendingSend.reject(new Error('late logged-out failure'));
    await act(async () => { await Promise.resolve(); });
    expect(state.toast).not.toHaveBeenCalled();
    expect(screen.getByText('Select a channel')).toBeTruthy();
  });

  it('rejects an old first-A failure after A to B to a new A generation', async () => {
    const pendingFirstA = deferred<unknown[]>();
    const tenantA1 = makeTenant('a', {
      select: (table) => table === 'channels' ? pendingFirstA.promise : Promise.resolve([]),
    });
    state.tenant = tenantA1.api;
    const view = render(<ChatPage />);
    await waitFor(() => expect(tenantA1.calls.selects.some(({ table }) => table === 'channels')).toBe(true));

    const tenantB = makeTenant('b');
    setIdentity('b');
    state.tenant = tenantB.api;
    view.rerender(<ChatPage />);
    await screen.findAllByText('Channel b-channel');

    const tenantA2 = makeTenant('a');
    setIdentity('a');
    state.tenant = tenantA2.api;
    view.rerender(<ChatPage />);
    expect(await screen.findAllByText('Channel a-channel')).toHaveLength(2);
    expect(await screen.findByText('Message a-message')).toBeTruthy();
    pendingFirstA.reject(new Error('stale first-A failure'));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getAllByText('Channel a-channel')).toHaveLength(2);
    expect(screen.getByText('Message a-message')).toBeTruthy();
  });
});
