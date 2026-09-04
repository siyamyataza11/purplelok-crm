import type { TenantDataApi } from '@/lib/tenant-data';
import type { LeadStage, Notification } from '@/types';

export async function readTenantSource<T>(
  canRead: boolean,
  reader: () => Promise<T[]>,
): Promise<T[]> {
  return canRead ? reader() : [];
}

export function buildProjectProgressUpdate(
  progress: number,
  health: string,
  canManage: boolean,
): { progress: number; health?: string } {
  return canManage ? { progress, health } : { progress };
}

export function isTenantRealtimeMessage(
  payload: { new?: Record<string, unknown> },
  organizationId: string,
  channelId?: string | null,
): boolean {
  const next = payload.new;
  return Boolean(
    next
    && next.organization_id === organizationId
    && (channelId == null || next.channel_id === channelId),
  );
}

/**
 * Mark only notifications that were actually loaded for this user/tenant.
 * The preflight select is deliberately exact: a forged or stale ID aborts
 * before any update is attempted.
 */
export async function markTenantNotificationsRead(
  tenant: TenantDataApi,
  userId: string,
  notifications: readonly Notification[],
): Promise<void> {
  const ids = [...new Set(notifications.filter((notification) => !notification.read).map(({ id }) => id))];
  if (ids.length === 0) return;

  const owned = await tenant.table('notifications').select<Notification>('*', {
    filters: [
      { operator: 'in', column: 'id', values: ids },
      { operator: 'eq', column: 'user_id', value: userId },
    ],
  });
  const ownedIds = new Set(owned.map(({ id }) => id));
  if (ownedIds.size !== ids.length || ids.some((id) => !ownedIds.has(id))) {
    throw new Error('Notification ownership changed; no notifications were marked read');
  }

  for (const id of ids) await tenant.notifications.markRead(id, userId);
}

interface MoveLeadInput {
  canWrite: boolean;
  leadId: string;
  stage: LeadStage;
  changeStage: (leadId: string, stage: LeadStage) => Promise<unknown>;
}

/**
 * The database workflow changes the stage and emits its activity atomically.
 */
export async function moveLeadWithActivity(input: MoveLeadInput): Promise<void> {
  if (!input.canWrite) throw new Error('Lead write permission is required');

  await input.changeStage(input.leadId, input.stage);
}
