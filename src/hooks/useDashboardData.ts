import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
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

  async function load() {
    setLoading(true);
    const [
      clientsRes,
      invoicesRes,
      projectsRes,
      quotesRes,
      tasksRes,
      activitiesRes,
      meetingsRes,
      paymentsRes,
      leadsRes,
    ] = await Promise.all([
      supabase.from('clients').select('*').order('created_at', { ascending: false }),
      supabase.from('invoices').select('*, client:clients(*)').order('created_at', { ascending: false }),
      supabase.from('projects').select('*, client:clients(*)').order('created_at', { ascending: false }),
      supabase.from('quotes').select('*, client:clients(*)').order('created_at', { ascending: false }),
      supabase.from('tasks').select('*, assigned_to_profile:profiles!tasks_assigned_to_fkey(*), project:projects(*), client:clients(*)').order('created_at', { ascending: false }),
      supabase.from('activities').select('*, user:profiles(*)').order('created_at', { ascending: false }).limit(20),
      supabase.from('meetings').select('*, client:clients(*)').order('start_at', { ascending: true }),
      supabase.from('payments').select('*').order('paid_at', { ascending: false }),
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
    ]);

    setData({
      clients: (clientsRes.data as Client[]) ?? [],
      invoices: (invoicesRes.data as Invoice[]) ?? [],
      projects: (projectsRes.data as Project[]) ?? [],
      quotes: (quotesRes.data as Quote[]) ?? [],
      tasks: (tasksRes.data as Task[]) ?? [],
      activities: (activitiesRes.data as Activity[]) ?? [],
      meetings: (meetingsRes.data as Meeting[]) ?? [],
      payments: (paymentsRes.data as Payment[]) ?? [],
      leads: (leadsRes.data as Lead[]) ?? [],
    });
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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
