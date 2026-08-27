import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useDashboardData, computeMetrics } from '@/hooks/useDashboardData';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, isThisMonth, isToday, isOverdue, formatDate, timeAgo } from '@/lib/utils';
import { Sparkles, Send, TrendingUp, AlertCircle, FileText, DollarSign, Users, Briefcase, Zap, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  { icon: <DollarSign size={14} />, text: "How much revenue did we generate this month?" },
  { icon: <AlertCircle size={14} />, text: "Which invoices are overdue?" },
  { icon: <Briefcase size={14} />, text: "What's the status of our active projects?" },
  { icon: <TrendingUp size={14} />, text: "What's our lead conversion rate?" },
  { icon: <Users size={14} />, text: "Who are our top clients?" },
  { icon: <Clock size={14} />, text: "What tasks are due today?" },
];

export function AssistantPage() {
  const { profile } = useAuth();
  const d = useDashboardData();
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: `Hello ${profile?.full_name?.split(' ')[0] || 'there'}! I'm PURPLE AI, your business assistant. I can analyze your CRM data, summarize client histories, draft quotes, flag overdue invoices, predict project timelines, and answer questions about your business performance. What would you like to know?`,
    }]);
  }, [profile?.id]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  function analyzeQuery(query: string): string {
    const q = query.toLowerCase();
    const m = computeMetrics(d);

    // Revenue questions
    if (q.includes('revenue') && (q.includes('month') || q.includes('this month'))) {
      return `This month you've generated **${formatCurrency(m.monthlyRevenue)}** in revenue. Today alone you brought in **${formatCurrency(m.todayRevenue)}**.\n\nYour outstanding payments total **${formatCurrency(m.outstandingPayments)}** across ${d.invoices.filter(i => ['sent','partial','overdue'].includes(i.status)).length} unpaid invoices.\n\n${m.monthlyRevenue > 0 ? 'Revenue is flowing — keep up the momentum!' : 'No revenue recorded yet this month. Time to follow up on outstanding invoices.'}`;
    }

    if (q.includes('revenue') && (q.includes('today') || q.includes('day'))) {
      return `Today's revenue: **${formatCurrency(m.todayRevenue)}** from ${d.payments.filter(p => isToday(p.paid_at)).length} payment(s).`;
    }

    if (q.includes('revenue') || q.includes('money') || q.includes('income')) {
      return `Here's your revenue overview:\n\n• **Today:** ${formatCurrency(m.todayRevenue)}\n• **This Month:** ${formatCurrency(m.monthlyRevenue)}\n• **Outstanding:** ${formatCurrency(m.outstandingPayments)}\n• **Total Collected (all time):** ${formatCurrency(d.payments.reduce((s, p) => s + p.amount, 0))}\n\nThe outstanding balance represents revenue you've earned but haven't collected yet. I'd recommend sending payment reminders for invoices that are past due.`;
    }

    // Overdue invoices
    if (q.includes('overdue') || q.includes('late') || q.includes('unpaid')) {
      const overdue = d.invoices.filter(i => i.status === 'overdue' || (i.due_date && isOverdue(i.due_date) && i.status !== 'paid' && i.status !== 'cancelled'));
      if (overdue.length === 0) return `Good news! You have **no overdue invoices**. All payments are up to date.`;
      const totalOverdue = overdue.reduce((s, i) => s + i.balance, 0);
      const list = overdue.slice(0, 5).map(i => `• **${i.invoice_number}** — ${i.client?.company_name || 'Unknown'} — ${formatCurrency(i.balance)} (due ${formatDate(i.due_date)})`).join('\n');
      return `You have **${overdue.length} overdue invoice(s)** totaling **${formatCurrency(totalOverdue)}**:\n\n${list}${overdue.length > 5 ? `\n...and ${overdue.length - 5} more.` : ''}\n\n**Recommendation:** Send payment reminders immediately. Consider adding late payment terms to future invoices.`;
    }

    // Projects
    if (q.includes('project') && (q.includes('status') || q.includes('active') || q.includes('progress'))) {
      const active = d.projects.filter(p => p.status === 'in_progress');
      if (active.length === 0) return `You currently have no active projects. All projects are either completed, in planning, or on hold.`;
      const list = active.slice(0, 5).map(p => `• **${p.name}** — ${p.client?.company_name} — ${p.progress}% complete — ${p.health.replace('_', ' ')}${p.due_date ? ` (due ${formatDate(p.due_date)})` : ''}`).join('\n');
      return `You have **${m.activeProjects} active project(s)**:\n\n${list}\n\n${m.projectsDue > 0 ? `⚠️ **${m.projectsDue} project(s) are past their due date** and need attention.` : 'All projects are on schedule.'}`;
    }

    if (q.includes('project')) {
      return `You have **${d.projects.length} total projects**:\n\n• Active: ${m.activeProjects}\n• Completed: ${m.projectsCompleted}\n• Overdue: ${m.projectsDue}\n\nYour project health breakdown:\n• On Track: ${d.projects.filter(p => p.health === 'on_track' && p.status !== 'completed').length}\n• At Risk: ${d.projects.filter(p => p.health === 'at_risk' && p.status !== 'completed').length}\n• Delayed: ${d.projects.filter(p => p.health === 'delayed' && p.status !== 'completed').length}`;
    }

    // Lead conversion
    if (q.includes('lead') && (q.includes('conversion') || q.includes('rate'))) {
      return `Your lead conversion rate is **${m.leadConversion.toFixed(1)}%**.\n\n• Total Leads: ${d.leads.length}\n• Won: ${d.leads.filter(l => l.stage === 'won').length}\n• Lost: ${d.leads.filter(l => l.stage === 'lost').length}\n• In Pipeline: ${d.leads.filter(l => !['won','lost'].includes(l.stage)).length}\n\nPipeline value: **${formatCurrency(d.leads.filter(l => !['won','lost'].includes(l.stage)).reduce((s, l) => s + l.estimated_value, 0))}**\n\n${m.leadConversion > 30 ? 'Great conversion rate! Above industry average.' : m.leadConversion > 15 ? 'Decent conversion rate. Focus on nurturing leads in the negotiation stage.' : 'Conversion rate could be improved. Consider following up with leads in the proposal_sent and negotiating stages.'}`;
    }

    if (q.includes('lead') || q.includes('pipeline')) {
      const byStage = {
        new_lead: d.leads.filter(l => l.stage === 'new_lead').length,
        contacted: d.leads.filter(l => l.stage === 'contacted').length,
        proposal_sent: d.leads.filter(l => l.stage === 'proposal_sent').length,
        negotiating: d.leads.filter(l => l.stage === 'negotiating').length,
        won: d.leads.filter(l => l.stage === 'won').length,
        lost: d.leads.filter(l => l.stage === 'lost').length,
      };
      return `Your lead pipeline:\n\n• New Leads: ${byStage.new_lead}\n• Contacted: ${byStage.contacted}\n• Proposal Sent: ${byStage.proposal_sent}\n• Negotiating: ${byStage.negotiating}\n• Won: ${byStage.won}\n• Lost: ${byStage.lost}\n\nTotal pipeline value: **${formatCurrency(d.leads.filter(l => !['won','lost'].includes(l.stage)).reduce((s, l) => s + l.estimated_value, 0))}**\n\nThe negotiating stage has the highest close probability — focus your energy there.`;
    }

    // Top clients
    if (q.includes('top client') || q.includes('best client') || q.includes('biggest client')) {
      const top = d.clients.map(c => ({
        name: c.company_name,
        total: d.invoices.filter(i => i.client_id === c.id).reduce((s, i) => s + i.total, 0),
      })).sort((a, b) => b.total - a.total).slice(0, 5);
      if (top.length === 0 || top[0].total === 0) return `You don't have any client revenue data yet. Create invoices for your clients to see top client rankings.`;
      return `Your top 5 clients by revenue:\n\n${top.map((c, i) => `${i + 1}. **${c.name}** — ${formatCurrency(c.total)}`).join('\n')}\n\nThese clients represent your most valuable relationships. Consider upselling additional services to them.`;
    }

    if (q.includes('client')) {
      return `You have **${d.clients.length} total clients**:\n\n• Active: ${d.clients.filter(c => c.status === 'active').length}\n• Prospects: ${d.clients.filter(c => c.status === 'prospect').length}\n• Inactive: ${d.clients.filter(c => c.status === 'inactive').length}\n\nAverage satisfaction score: **${m.avgSatisfaction.toFixed(1)}/5**\n\n${m.avgSatisfaction >= 4 ? 'Clients are generally happy with your service!' : 'Consider reaching out to clients to improve satisfaction.'}`;
    }

    // Tasks due today
    if (q.includes('task') && (q.includes('today') || q.includes('due'))) {
      const dueToday = d.tasks.filter(t => t.deadline && isToday(t.deadline) && t.status !== 'done');
      if (dueToday.length === 0) return `You have **no tasks due today**. Great job staying on top of things!`;
      return `You have **${dueToday.length} task(s) due today**:\n\n${dueToday.slice(0, 5).map(t => `• ${t.title}${t.assigned_to_profile ? ` (assigned to ${t.assigned_to_profile.full_name})` : ''}`).join('\n')}`;
    }

    if (q.includes('task')) {
      const byStatus = {
        todo: d.tasks.filter(t => t.status === 'todo').length,
        in_progress: d.tasks.filter(t => t.status === 'in_progress').length,
        review: d.tasks.filter(t => t.status === 'review').length,
        done: d.tasks.filter(t => t.status === 'done').length,
      };
      return `Task overview:\n\n• To Do: ${byStatus.todo}\n• In Progress: ${byStatus.in_progress}\n• Review: ${byStatus.review}\n• Done: ${byStatus.done}\n\n${m.tasksDueToday > 0 ? `⚠️ ${m.tasksDueToday} task(s) due today!` : 'No urgent tasks right now.'}`;
    }

    // Quotes
    if (q.includes('quote')) {
      return `Quote summary:\n\n• Open Quotes: ${m.openQuotes}\n• Accepted Quotes: ${m.acceptedQuotes}\n• Acceptance Rate: ${d.quotes.length > 0 ? ((m.acceptedQuotes / d.quotes.length) * 100).toFixed(1) : 0}%\n\n${m.openQuotes > 0 ? `You have ${m.openQuotes} quotes waiting for client response. Consider following up.` : 'No pending quotes.'}`;
    }

    // Meetings
    if (q.includes('meeting') || q.includes('upcoming') || q.includes('schedule')) {
      const upcoming = d.meetings.filter(m => m.start_at && new Date(m.start_at) > new Date() && m.status === 'scheduled');
      if (upcoming.length === 0) return `You have no upcoming meetings scheduled.`;
      return `You have **${upcoming.length} upcoming meeting(s)**:\n\n${upcoming.slice(0, 5).map(m => `• ${m.title} — ${formatDate(m.start_at)} at ${new Date(m.start_at ?? '').toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}${m.client ? ` (${m.client.company_name})` : ''}`).join('\n')}`;
    }

    // Risk / flag
    if (q.includes('risk') || q.includes('flag') || q.includes('warning') || q.includes('problem')) {
      const risks: string[] = [];
      const overdueInvoices = d.invoices.filter(i => i.status === 'overdue');
      if (overdueInvoices.length > 0) risks.push(`**${overdueInvoices.length} overdue invoice(s)** totaling ${formatCurrency(overdueInvoices.reduce((s, i) => s + i.balance, 0))}`);
      const delayedProjects = d.projects.filter(p => p.health === 'delayed' && p.status !== 'completed');
      if (delayedProjects.length > 0) risks.push(`**${delayedProjects.length} delayed project(s)**: ${delayedProjects.map(p => p.name).join(', ')}`);
      const overdueTasks = d.tasks.filter(t => t.deadline && isOverdue(t.deadline) && t.status !== 'done');
      if (overdueTasks.length > 0) risks.push(`**${overdueTasks.length} overdue task(s)**`);
      const atRiskProjects = d.projects.filter(p => p.health === 'at_risk' && p.status !== 'completed');
      if (atRiskProjects.length > 0) risks.push(`**${atRiskProjects.length} project(s) at risk**`);

      if (risks.length === 0) return `No major risks detected. Your business is running smoothly!`;
      return `I've identified **${risks.length} area(s) of concern**:\n\n${risks.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n**Recommended actions:**\n• Send payment reminders for overdue invoices\n• Review delayed projects and adjust timelines\n• Reassign or follow up on overdue tasks`;
    }

    // Upselling
    if (q.includes('upsell') || q.includes('opportunity') || q.includes('recommend')) {
      const clientsWithWebsites = d.clients.filter(c => c.tags?.includes('website'));
      const clientsWithoutHosting = d.projects.filter(p => p.type === 'website' && p.status === 'completed').map(p => p.client_id);
      const opportunities: string[] = [];
      if (clientsWithoutHosting.length > 0) opportunities.push(`${clientsWithoutHosting.length} completed website clients who may need hosting/maintenance plans`);
      if (m.openQuotes > 0) opportunities.push(`${m.openQuotes} pending quotes to follow up on`);
      if (d.leads.filter(l => l.stage === 'negotiating').length > 0) opportunities.push(`${d.leads.filter(l => l.stage === 'negotiating').length} leads in negotiation — close them!`);
      if (opportunities.length === 0) return `No obvious upselling opportunities right now. Keep building relationships with your clients!`;
      return `Here are upselling opportunities I've identified:\n\n${opportunities.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\n**Recommendation:** Reach out to completed website clients about ongoing maintenance contracts — this creates recurring revenue.`;
    }

    // Summary
    if (q.includes('summary') || q.includes('overview') || q.includes('how') && q.includes('business')) {
      return `Here's your business summary:\n\n**Revenue**\n• Today: ${formatCurrency(m.todayRevenue)}\n• This Month: ${formatCurrency(m.monthlyRevenue)}\n• Outstanding: ${formatCurrency(m.outstandingPayments)}\n\n**Operations**\n• Active Projects: ${m.activeProjects}\n• Completed Projects: ${m.projectsCompleted}\n• Tasks Due Today: ${m.tasksDueToday}\n• Upcoming Meetings: ${m.upcomingMeetings}\n\n**Sales**\n• Open Quotes: ${m.openQuotes}\n• Accepted Quotes: ${m.acceptedQuotes}\n• Lead Conversion: ${m.leadConversion.toFixed(1)}%\n\n**Clients**\n• Total Clients: ${d.clients.length}\n• Satisfaction: ${m.avgSatisfaction.toFixed(1)}/5\n\n${m.outstandingPayments > 0 ? '⚠️ Focus on collecting outstanding payments to improve cash flow.' : 'Cash flow looks healthy!'}`;
    }

    // Default
    return `I can help you with:\n\n• Revenue analysis (today, this month, outstanding)\n• Overdue invoices and high-risk projects\n• Lead conversion and pipeline status\n• Top clients and upselling opportunities\n• Task and project status\n• Meeting schedules\n• Business summaries and recommendations\n\nTry asking: "How much revenue this month?" or "What's at risk?"`;
  }

  async function handleSend(text?: string) {
    const query = text || input;
    if (!query.trim()) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: query }]);
    setThinking(true);
    // Simulate AI processing
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
    const response = analyzeQuery(query);
    setThinking(false);
    setMessages((prev) => [...prev, { role: 'assistant', content: response }]);
  }

  return (
    <div className="p-6 animate-fade-in max-w-[1000px] mx-auto h-[calc(100vh-4rem)] flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl gradient-purple flex items-center justify-center animate-pulse-glow">
          <Sparkles size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">PURPLE AI</h1>
          <p className="text-sm text-white/40">Your AI business assistant</p>
        </div>
        <Badge variant="purple" dot className="ml-auto">Online</Badge>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}>
            {msg.role === 'assistant' ? (
              <div className="w-8 h-8 rounded-lg gradient-purple flex items-center justify-center shrink-0">
                <Sparkles size={14} className="text-white" />
              </div>
            ) : (
              <Avatar name={profile?.full_name} src={profile?.avatar_url} size="sm" />
            )}
            <div className={cn('max-w-[80%] rounded-2xl px-4 py-3', msg.role === 'assistant' ? 'bg-white/5 border border-ink-border' : 'gradient-purple')}>
              <p className="text-sm text-white/90 whitespace-pre-line">{msg.content}</p>
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg gradient-purple flex items-center justify-center shrink-0">
              <Sparkles size={14} className="text-white animate-pulse" />
            </div>
            <div className="bg-white/5 border border-ink-border rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={msgEndRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.text}
              onClick={() => handleSend(s.text)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 border border-ink-border hover:border-purple/30 hover:bg-purple/5 transition-all text-sm text-white/70 text-left"
            >
              <span className="text-purple-light">{s.icon}</span>
              {s.text}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask PURPLE AI anything about your business..."
          className="input-field flex-1"
        />
        <Button onClick={() => handleSend()} size="icon" disabled={thinking}><Send size={16} /></Button>
      </div>
    </div>
  );
}
