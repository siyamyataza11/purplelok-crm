import { useDashboardData, computeMetrics } from '@/hooks/useDashboardData';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatNumber, timeAgo, formatDate, isOverdue, daysUntil } from '@/lib/utils';
import {
  DollarSign,
  TrendingUp,
  AlertCircle,
  Briefcase,
  Clock,
  CheckCircle2,
  FileText,
  Target,
  Globe,
  Printer,
  Palette,
  Star,
  Activity,
  Calendar,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function Dashboard() {
  const d = useDashboardData();
  const m = computeMetrics(d);

  if (d.loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-muted rounded-lg animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const metrics = [
    { label: 'Monthly Revenue', value: formatCurrency(m.monthlyRevenue), sub: 'This month', icon: <TrendingUp size={18} />, accent: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Outstanding', value: formatCurrency(m.outstandingPayments), sub: 'Awaiting payment', icon: <AlertCircle size={18} />, accent: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'Active Projects', value: formatNumber(m.activeProjects), sub: 'In progress', icon: <Briefcase size={18} />, accent: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Tasks Due Today', value: formatNumber(m.tasksDueToday), sub: 'Needs attention', icon: <Zap size={18} />, accent: 'text-orange-600', bg: 'bg-orange-50' },
  ];

  // Cash flow: last 6 months from payments
  const months: { label: string; value: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const monthLabel = date.toLocaleString('en-ZA', { month: 'short' });
    const value = d.payments
      .filter((p) => {
        const pd = new Date(p.paid_at);
        return pd.getMonth() === date.getMonth() && pd.getFullYear() === date.getFullYear();
      })
      .reduce((sum, p) => sum + p.amount, 0);
    months.push({ label: monthLabel, value });
  }
  const maxCash = Math.max(...months.map((m) => m.value), 1);

  // Top clients by total invoice value
  const clientTotals = d.clients
    .map((c) => ({
      client: c,
      total: d.invoices.filter((i) => i.client_id === c.id).reduce((sum, i) => sum + i.total, 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // Upcoming meetings
  const upcoming = d.meetings
    .filter((m) => m.start_at && new Date(m.start_at) > new Date() && m.status === 'scheduled')
    .slice(0, 5);

  // Project health distribution
  const healthCounts = {
    on_track: d.projects.filter((p) => p.health === 'on_track' && p.status !== 'completed').length,
    at_risk: d.projects.filter((p) => p.health === 'at_risk' && p.status !== 'completed').length,
    delayed: d.projects.filter((p) => p.health === 'delayed' && p.status !== 'completed').length,
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-tertiary mt-0.5">Welcome back to your command center</p>
        </div>
        <Badge variant="purple" dot>Live</Badge>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map((metric) => (
          <Card key={metric.label} hover className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', metric.bg, metric.accent)}>
                {metric.icon}
              </div>
            </div>
            <p className="text-xs text-tertiary mb-1">{metric.label}</p>
            <p className="text-xl font-bold tracking-tight">{metric.value}</p>
            <p className="text-xs text-tertiary mt-1">{metric.sub}</p>
          </Card>
        ))}
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
            <Calendar size={18} />
          </div>
          <div>
            <p className="text-xs text-tertiary">Upcoming Meetings</p>
            <p className="text-lg font-bold">{m.upcomingMeetings}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center text-green-600">
            <Star size={18} />
          </div>
          <div>
            <p className="text-xs text-tertiary">Client Satisfaction</p>
            <p className="text-lg font-bold">{m.avgSatisfaction.toFixed(1)}/5</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
            <Target size={18} />
          </div>
          <div>
            <p className="text-xs text-tertiary">Lead Conversion</p>
            <p className="text-lg font-bold">{m.leadConversion.toFixed(1)}%</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600">
            <Users size={18} />
          </div>
          <div>
            <p className="text-xs text-tertiary">Total Clients</p>
            <p className="text-lg font-bold">{d.clients.length}</p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Cash flow */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Cash Flow Overview</CardTitle>
              <Badge variant="success">Last 6 months</Badge>
            </div>
          </CardHeader>
          <CardBody>
            <div className="flex items-end justify-between gap-3 h-48">
              {months.map((month, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2 group">
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className="w-full rounded-t-lg bg-purple-600 transition-all duration-300 group-hover:opacity-90 relative"
                      style={{ height: `${(month.value / maxCash) * 100}%`, minHeight: '4px' }}
                    >
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium whitespace-nowrap">
                        {formatCurrency(month.value)}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-tertiary">{month.label}</p>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Project Health */}
        <Card>
          <CardHeader>
            <CardTitle>Project Health</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <HealthBar label="On Track" count={healthCounts.on_track} total={d.projects.length} color="bg-green-500" />
            <HealthBar label="At Risk" count={healthCounts.at_risk} total={d.projects.length} color="bg-orange-500" />
            <HealthBar label="Delayed" count={healthCounts.delayed} total={d.projects.length} color="bg-red-500" />
            <div className="pt-3 border-t border-line space-y-2">
              {d.projects.filter((p) => p.status !== 'completed').slice(0, 3).map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <span className="text-secondary truncate">{p.name}</span>
                  <span className={cn(
                    'text-xs',
                    p.health === 'on_track' ? 'text-green-600' : p.health === 'at_risk' ? 'text-orange-600' : 'text-red-600'
                  )}>
                    {p.progress}%
                  </span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity timeline */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Activity</CardTitle>
              <Activity size={16} className="text-tertiary" />
            </div>
          </CardHeader>
          <CardBody>
            {d.activities.length === 0 ? (
              <EmptyState icon={<Activity size={24} />} title="No activity yet" description="Actions across the CRM will appear here" />
            ) : (
              <div className="space-y-3">
                {d.activities.slice(0, 10).map((a) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <Avatar name={a.user?.full_name} src={a.user?.avatar_url} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-primary">
                        <span className="font-medium text-primary">{a.user?.full_name || 'System'}</span> {a.description}
                      </p>
                      <p className="text-xs text-tertiary mt-0.5">{timeAgo(a.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Upcoming meetings */}
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Meetings</CardTitle>
          </CardHeader>
          <CardBody>
            {upcoming.length === 0 ? (
              <EmptyState icon={<Calendar size={24} />} title="No meetings scheduled" />
            ) : (
              <div className="space-y-3">
                {upcoming.map((mtg) => (
                  <div key={mtg.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted">
                    <div className="w-10 h-10 rounded-lg bg-purple-50 flex flex-col items-center justify-center shrink-0">
                      <span className="text-[10px] text-tertiary">{new Date(mtg.start_at ?? '').toLocaleString('en-ZA', { month: 'short' })}</span>
                      <span className="text-sm font-bold text-purple-600">{new Date(mtg.start_at ?? '').getDate()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary truncate">{mtg.title}</p>
                      <p className="text-xs text-tertiary">
                        {new Date(mtg.start_at ?? '').toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                        {mtg.client && ` · ${mtg.client.company_name}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top clients */}
        <Card>
          <CardHeader>
            <CardTitle>Top Clients</CardTitle>
          </CardHeader>
          <CardBody>
            {clientTotals.length === 0 || clientTotals[0].total === 0 ? (
              <EmptyState icon={<Users size={24} />} title="No client data yet" />
            ) : (
              <div className="space-y-3">
                {clientTotals.map(({ client, total }, i) => (
                  <div key={client.id} className="flex items-center gap-3">
                    <span className="text-sm text-tertiary w-5">{i + 1}</span>
                    <Avatar name={client.company_name} src={client.logo_url} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary truncate">{client.company_name}</p>
                      <p className="text-xs text-tertiary">{client.industry || '—'}</p>
                    </div>
                    <p className="text-sm font-semibold text-primary">{formatCurrency(total)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Recent payments */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Payments</CardTitle>
          </CardHeader>
          <CardBody>
            {m.recentPayments.length === 0 ? (
              <EmptyState icon={<DollarSign size={24} />} title="No payments yet" />
            ) : (
              <div className="space-y-3">
                {m.recentPayments.map((p) => {
                  const inv = d.invoices.find((i) => i.id === p.invoice_id);
                  const client = d.clients.find((c) => c.id === p.client_id);
                  return (
                    <div key={p.id} className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center text-green-600">
                        <ArrowUpRight size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-primary truncate">{client?.company_name || 'Unknown'}</p>
                        <p className="text-xs text-tertiary">{inv?.invoice_number} · {timeAgo(p.paid_at)}</p>
                      </div>
                      <p className="text-sm font-semibold text-green-600">{formatCurrency(p.amount)}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function HealthBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-secondary">{label}</span>
        <span className="text-sm font-semibold">{count}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
