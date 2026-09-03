export const PERMISSION_KEYS = [
  'members.read',
  'members.manage',
  'roles.read',
  'roles.manage',
  'clients.read',
  'clients.write',
  'leads.read',
  'leads.write',
  'projects.read',
  'projects.write',
  'projects.manage',
  'tasks.read',
  'tasks.write',
  'quotes.read',
  'quotes.write',
  'quotes.approve',
  'invoices.read',
  'invoices.write',
  'invoices.approve',
  'payments.read',
  'payments.record',
  'documents.read',
  'documents.write',
  'tickets.read',
  'tickets.write',
  'reports.read',
  'settings.read',
  'settings.manage',
  'activities.read',
  'collaboration.read',
  'collaboration.write',
  'collaboration.manage',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

const PERMISSION_KEY_SET = new Set<string>(PERMISSION_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEY_SET.has(value);
}

export type AppPage =
  | 'dashboard'
  | 'clients'
  | 'leads'
  | 'quotes'
  | 'invoices'
  | 'projects'
  | 'tasks'
  | 'calendar'
  | 'tickets'
  | 'documents'
  | 'chat'
  | 'reports'
  | 'assistant'
  | 'settings';

// null means that an active organization membership is sufficient in Batch 4.
export const PAGE_PERMISSIONS: Record<AppPage, PermissionKey | null> = {
  dashboard: null,
  clients: 'clients.read',
  leads: 'leads.read',
  quotes: 'quotes.read',
  invoices: 'invoices.read',
  projects: 'projects.read',
  tasks: 'tasks.read',
  calendar: 'projects.read',
  tickets: 'tickets.read',
  documents: 'documents.read',
  chat: null,
  reports: 'reports.read',
  assistant: 'reports.read',
  settings: 'settings.read',
};

export const ACTION_PERMISSIONS = {
  clientsWrite: 'clients.write',
  leadsWrite: 'leads.write',
  quotesWrite: 'quotes.write',
  quotesApprove: 'quotes.approve',
  invoicesWrite: 'invoices.write',
  invoicesApprove: 'invoices.approve',
  paymentsRead: 'payments.read',
  paymentsRecord: 'payments.record',
  projectsWrite: 'projects.write',
  projectsManage: 'projects.manage',
  tasksWrite: 'tasks.write',
  documentsWrite: 'documents.write',
  ticketsWrite: 'tickets.write',
  reportsRead: 'reports.read',
  settingsManage: 'settings.manage',
  membersRead: 'members.read',
  membersManage: 'members.manage',
  rolesRead: 'roles.read',
  rolesManage: 'roles.manage',
} as const satisfies Record<string, PermissionKey>;

export function hasPermission(
  permissions: ReadonlySet<PermissionKey>,
  permission: PermissionKey,
): boolean {
  return permissions.has(permission);
}

export function hasAnyPermission(
  permissions: ReadonlySet<PermissionKey>,
  required: readonly PermissionKey[],
): boolean {
  return required.some((permission) => permissions.has(permission));
}

export function hasAllPermissions(
  permissions: ReadonlySet<PermissionKey>,
  required: readonly PermissionKey[],
): boolean {
  return required.every((permission) => permissions.has(permission));
}

export function canAccessPage(
  page: AppPage,
  permissions: ReadonlySet<PermissionKey>,
): boolean {
  const required = PAGE_PERMISSIONS[page];
  return required === null || permissions.has(required);
}

export function authorizedPages(
  pages: readonly AppPage[],
  permissions: ReadonlySet<PermissionKey>,
): AppPage[] {
  return pages.filter((page) => canAccessPage(page, permissions));
}
