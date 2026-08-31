import { useCallback, useState, useEffect } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { useTenantData } from '@/context/TenantDataContext';
import type { PermissionKey } from '@/lib/authorization';
import { readTenantSource } from '@/lib/tenant-domain-workflows';
import type { Client, Invoice, Project, Quote, Task, Activity, Meeting, Payment, Lead } from '@/types';
import { isToday, isThisMonth, isOverdue } from '@/lib/utils';

export interface DashboardData {
  clients: Client[];
  invoices: Invoice[];
  projects: Project[];
  quotes: Quote[];
  tasks: Task[];
  activities: Activity[];
  meetings: Meeting[];
  payments: Payment[];
  leads: Lead[];
  loading: boolean;
  refresh: () => void;
}

export function useDashboardData(): DashboardData {
  const tenant = useTenantData();
  const { hasPermission, hasAllPermissions } = useOrganization();
  const [data, setData] = useState<Omit<DashboardData, 'loading' | 'refresh'>>({
    clients: [],
    invoices: [],
    projects: [],
    quotes: [],
    tasks: [],
    activities: [],
    meetings: [],
    payments: [],
    leads: [],
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setData({
      clients: [], invoices: [], projects: [], quotes: [], tasks: [],
      activities: [], meetings: [], payments: [], leads: [],
    });
    const permitted = <T,>(permission: PermissionKey, request: () => Promise<T[]>) =>
      readTenantSource(hasPermission(permission), request);
    const activitySourcePermissions: PermissionKey[] = [
      'clients.read', 'leads.read', 'quotes.read', 'invoices.read',
      'projects.read', 'tasks.read', 'documents.read', 'tickets.read',
    ];
    const canReadClients = hasPermission('clients.read');
    const canReadProjects = hasPermission('projects.read');
    const invoiceProjection = canReadClients ? '*, client:clients(*)' : '*';
    const projectProjection = canReadClients ? '*, client:clients(*)' : '*';
    const quoteProjection = canReadClients ? '*, client:clients(*)' : '*';
    const taskProjection = canReadClients && canReadProjects
      ? '*, project:projects(*), client:clients(*)'
      : canReadClients
        ? '*, client:clients(*)'
        : canReadProjects
          ? '*, project:projects(*)'
          : '*';
    const meetingProjection = canReadClients ? '*, client:clients(*)' : '*';
    const [
      clients, invoices, projects, quotes, tasks, activities, meetings, payments, leads,
    ] = await Promise.all([
      permitted<Client>('clients.read', () => tenant.table('clients').select<Client>('*', { order: [{ column: 'created_at', ascending: false }] })),
      permitted<Invoice>('invoices.read', () => tenant.table('invoices').select<Invoice>(invoiceProjection, { order: [{ column: 'created_at', ascending: false }] })),
      permitted<Project>('projects.read', () => tenant.table('projects').select<Project>(projectProjection, { order: [{ column: 'created_at', ascending: false }] })),
      permitted<Quote>('quotes.read', () => tenant.table('quotes').select<Quote>(quoteProjection, { order: [{ column: 'created_at', ascending: false }] })),
      permitted<Task>('tasks.read', () => tenant.table('tasks').select<Task>(taskProjection, { order: [{ column: 'created_at', ascending: false }] })),
      hasAllPermissions(activitySourcePermissions)
        ? tenant.table('activities').select<Activity>('*', { order: [{ column: 'created_at', ascending: false }], limit: 20 })
        : Promise.resolve([] as Activity[]),
      permitted<Meeting>('projects.read', () => tenant.table('meetings').select<Meeting>(meetingProjection, { order: [{ column: 'start_at', ascending: true }] })),
      permitted<Payment>('payments.read', () => tenant.table('payments').select<Payment>('*', { order: [{ column: 'paid_at', ascending: false }] })),
      permitted<Lead>('leads.read', () => tenant.table('leads').select<Lead>('*', { order: [{ column: 'created_at', ascending: false }] })),
    ]);

    setData({
      clients, invoices, projects, quotes, tasks, activities, meetings, payments, leads,
    });
    setLoading(false);
  }, [hasAllPermissions, hasPermission, tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...data, loading, refresh: load };
}

export function computeMetrics(d: DashboardData) {
  const todayRevenue = d.payments
    .filter((p) => isToday(p.paid_at))
    .reduce((sum, p) => sum + p.amount, 0);

  const monthlyRevenue = d.payments
    .filter((p) => isThisMonth(p.paid_at))
    .reduce((sum, p) => sum + p.amount, 0);

  const outstandingPayments = d.invoices
    .filter((i) => i.status === 'sent' || i.status === 'partial' || i.status === 'overdue')
    .reduce((sum, i) => sum + (i.balance || 0), 0);

  const activeProjects = d.projects.filter((p) => p.status === 'in_progress').length;
  const projectsDue = d.projects.filter((p) => p.due_date && isOverdue(p.due_date) && p.status !== 'completed').length;
  const projectsCompleted = d.projects.filter((p) => p.status === 'completed').length;
  const openQuotes = d.quotes.filter((q) => q.status === 'draft' || q.status === 'sent').length;
  const acceptedQuotes = d.quotes.filter((q) => q.status === 'accepted').length;
  const tasksDueToday = d.tasks.filter((t) => t.deadline && isToday(t.deadline) && t.status !== 'done').length;
  const upcomingMeetings = d.meetings.filter((m) => m.start_at && new Date(m.start_at) > new Date() && m.status === 'scheduled').length;
  const websiteClients = d.clients.filter((c) => c.tags?.includes('website')).length;
  const printingProjects = d.projects.filter((p) => p.type === 'printing').length;
  const brandingProjects = d.projects.filter((p) => p.type === 'branding').length;
  const avgSatisfaction = d.clients.length > 0
    ? d.clients.reduce((sum, c) => sum + (c.satisfaction_score || 0), 0) / d.clients.length
    : 0;
  const wonLeads = d.leads.filter((l) => l.stage === 'won').length;
  const totalLeads = d.leads.length;
  const leadConversion = totalLeads > 0 ? (wonLeads / totalLeads) * 100 : 0;
  const recentPayments = d.payments.slice(0, 5);

  return {
    todayRevenue,
    monthlyRevenue,
    outstandingPayments,
    activeProjects,
    projectsDue,
    projectsCompleted,
    openQuotes,
    acceptedQuotes,
    tasksDueToday,
    upcomingMeetings,
    websiteClients,
    printingProjects,
    brandingProjects,
    avgSatisfaction,
    leadConversion,
    recentPayments,
  };
}
