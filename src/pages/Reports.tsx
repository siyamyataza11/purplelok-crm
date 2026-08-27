import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import type { Invoice, Payment, Project, Client, Lead, Task } from '@/types';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatNumber, isThisMonth, isOverdue } from '@/lib/utils';
import { TrendingUp, DollarSign, Users, Target, Briefcase, CheckCircle2, Clock, AlertCircle, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ReportsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [i, p, pr, c, l, t] = await Promise.all([
        supabase.from('invoices').select('*, client:clients(*)'),
        supabase.from('payments').select('*'),
        supabase.from('projects').select('*'),
        supabase.from('clients').select('*'),
        supabase.from('leads').select('*'),
        supabase.from('tasks').select('*'),
      ]);
      setInvoices((i.data as Invoice[]) ?? []);
      setPayments((p.data as Payment[]) ?? []);
      setProjects((pr.data as Project[]) ?? []);
      setClients((c.data as Client[]) ?? []);
      setLeads((l.data as Lead[]) ?? []);
      setTasks((t.data as Task[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  const metrics = useMemo(() => {
    const monthlyRevenue = payments.filter((p) => isThisMonth(p.paid_at)).reduce((s, p) => s + p.amount, 0);
    const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);
    const outstanding = invoices.filter((i) => ['sent', 'partial', 'overdue'].includes(i.status)).reduce((s, i) => s + i.balance, 0);
    const overdue = invoices.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.balance, 0);
    const wonLeads = leads.filter((l) => l.stage === 'won').length;
    const lostLeads = leads.filter((l) => l.stage === 'lost').length;
    const conversionRate = leads.length > 0 ? (wonLeads / leads.length) * 100 : 0;
    const completedProjects = projects.filter((p) => p.status === 'completed').length;
    const activeProjects = projects.filter((p) => p.status === 'in_progress').length;
    const doneTasks = tasks.filter((t) => t.status === 'done').length;
    const totalTasks = tasks.length;
    const taskCompletion = totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0;

    // Monthly revenue for chart
    const months: { label: string; revenue: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const label = date.toLocaleString('en-ZA', { month: 'short' });
      const revenue = payments.filter((p) => {
        const pd = new Date(p.paid_at);
        return pd.getMonth() === date.getMonth() && pd.getFullYear() === date.getFullYear();
      }).reduce((s, p) => s + p.amount, 0);
      months.push({ label, revenue });
    }

    // Revenue by project type
    const byType: Record<string, number> = {};
    projects.forEach((p) => {
      byType[p.type] = (byType[p.type] || 0) + p.budget;
    });

    // Top clients by revenue
    const clientRevenue = clients.map((c) => ({
      name: c.company_name,
      revenue: invoices.filter((i) => i.client_id === c.id).reduce((s, i) => s + i.total, 0),
    })).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    return { monthlyRevenue, totalRevenue, outstanding, overdue, wonLeads, lostLeads, conversionRate, completedProjects, activeProjects, doneTasks, totalTasks, taskCompletion, months, byType, clientRevenue };
  }, [invoices, payments, projects, clients, leads, tasks]);

  if (loading) {
    return <div className="p-6"><div className="h-8 w-48 bg-white/5 rounded-lg animate-pulse" /></div>;
  }

  const maxRevenue = Math.max(...metrics.months.map((m) => m.revenue), 1);

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports & Analytics</h1>
        <p className="text-sm text-white/40 mt-0.5">Business performance overview</p>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ReportCard icon={<DollarSign size={18} />} label="Total Revenue" value={formatCurrency(metrics.totalRevenue)} accent="text-green-400" bg="bg-green-500/10" />
        <ReportCard icon={<TrendingUp size={18} />} label="This Month" value={formatCurrency(metrics.monthlyRevenue)} accent="text-purple-light" bg="bg-purple/10" />
        <ReportCard icon={<AlertCircle size={18} />} label="Outstanding" value={formatCurrency(metrics.outstanding)} accent="text-orange-400" bg="bg-orange-500/10" />
        <ReportCard icon={<AlertCircle size={18} />} label="Overdue" value={formatCurrency(metrics.overdue)} accent="text-red-400" bg="bg-red-500/10" />
      </div>

      {/* Revenue chart */}
      <Card>
        <CardHeader><CardTitle>Revenue Trend (12 months)</CardTitle></CardHeader>
        <CardBody>
          <div className="flex items-end justify-between gap-2 h-56">
            {metrics.months.map((m, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2 group">
                <div className="w-full flex-1 flex items-end">
                  <div className="w-full rounded-t-lg gradient-purple transition-all duration-300 group-hover:opacity-80 relative" style={{ height: `${(m.revenue / maxRevenue) * 100}%`, minHeight: '4px' }}>
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium whitespace-nowrap">{formatCurrency(m.revenue)}</div>
                  </div>
                </div>
                <p className="text-xs text-white/40">{m.label}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead conversion */}
        <Card>
          <CardHeader><CardTitle>Lead Conversion</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <StatBox label="Won" value={metrics.wonLeads} color="text-green-400" />
              <StatBox label="Lost" value={metrics.lostLeads} color="text-red-400" />
              <StatBox label="Rate" value={`${metrics.conversionRate.toFixed(1)}%`} color="text-purple-light" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2"><span className="text-white/40">Conversion Rate</span><span>{metrics.conversionRate.toFixed(1)}%</span></div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full gradient-purple rounded-full transition-all duration-500" style={{ width: `${metrics.conversionRate}%` }} />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Project stats */}
        <Card>
          <CardHeader><CardTitle>Project Stats</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <StatBox label="Active" value={metrics.activeProjects} color="text-blue-400" />
              <StatBox label="Completed" value={metrics.completedProjects} color="text-green-400" />
              <StatBox label="Total" value={projects.length} color="text-white/60" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2"><span className="text-white/40">Task Completion</span><span>{metrics.taskCompletion.toFixed(1)}%</span></div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${metrics.taskCompletion}%` }} />
              </div>
              <p className="text-xs text-white/30 mt-1">{metrics.doneTasks} of {metrics.totalTasks} tasks done</p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Top clients */}
      <Card>
        <CardHeader><CardTitle>Top Clients by Revenue</CardTitle></CardHeader>
        <CardBody>
          {metrics.clientRevenue.length === 0 || metrics.clientRevenue[0].revenue === 0 ? (
            <p className="text-sm text-white/40 text-center py-4">No revenue data yet</p>
          ) : (
            <div className="space-y-3">
              {metrics.clientRevenue.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm text-white/30 w-6">{i + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm text-white/80">{c.name}</p>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mt-1">
                      <div className="h-full gradient-purple rounded-full" style={{ width: `${(c.revenue / metrics.clientRevenue[0].revenue) * 100}%` }} />
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-white/80">{formatCurrency(c.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function ReportCard({ icon, label, value, accent, bg }: { icon: React.ReactNode; label: string; value: string; accent: string; bg: string }) {
  return (
    <Card className="p-5">
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', bg, accent)}>{icon}</div>
      <p className="text-xs text-white/40">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </Card>
  );
}

function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="text-center p-3 rounded-lg bg-white/5">
      <p className={cn('text-2xl font-bold', color)}>{value}</p>
      <p className="text-xs text-white/40 mt-1">{label}</p>
    </div>
  );
}
