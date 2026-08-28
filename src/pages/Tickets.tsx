import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Ticket, TicketMessage, Profile, Client, TicketStatus } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { timeAgo, formatDate, cn, generateNumber } from '@/lib/utils';
import { Plus, LifeBuoy, ArrowLeft, Send, Star, Clock } from 'lucide-react';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { ACTION_PERMISSIONS } from '@/lib/authorization';
import { useOrganization } from '@/context/OrganizationContext';

const PRIORITY_CONFIG = {
  low: { variant: 'neutral' as const, label: 'Low' },
  medium: { variant: 'info' as const, label: 'Medium' },
  high: { variant: 'warning' as const, label: 'High' },
  urgent: { variant: 'danger' as const, label: 'Urgent' },
};

const STATUS_CONFIG = {
  open: { variant: 'info' as const, label: 'Open' },
  in_progress: { variant: 'warning' as const, label: 'In Progress' },
  resolved: { variant: 'success' as const, label: 'Resolved' },
  closed: { variant: 'neutral' as const, label: 'Closed' },
};

export function TicketsPage() {
  const { profile } = useAuth();
  const { add } = useToast();
  const { hasPermission } = useOrganization();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  async function load() {
    setLoading(true);
    const [tRes, cRes, uRes] = await Promise.all([
      supabase.from('tickets').select('*, client:clients(*), assigned_to_profile:profiles!tickets_assigned_to_fkey(*)').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').order('company_name'),
      supabase.from('profiles').select('*').order('full_name'),
    ]);
    setTickets((tRes.data as Ticket[]) ?? []);
    setClients((cRes.data as Client[]) ?? []);
    setProfiles((uRes.data as Profile[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = tickets.filter((t) => statusFilter === 'all' || t.status === statusFilter);

  async function updateStatus(ticket: Ticket, status: TicketStatus) {
    if (!hasPermission(ACTION_PERMISSIONS.ticketsWrite)) return;
    await supabase.from('tickets').update({ status }).eq('id', ticket.id);
    setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, status } : t)));
    if (selected?.id === ticket.id) setSelected({ ...selected, status });
    add('success', `Ticket ${status.replace('_', ' ')}`);
  }

  if (view === 'detail' && selected) {
    return <TicketDetail ticket={selected} profiles={profiles} onBack={() => { setView('list'); setSelected(null); }} onUpdated={load} onUpdateStatus={updateStatus} />;
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Support Desk</h1>
          <p className="text-sm text-tertiary mt-0.5">{tickets.filter((t) => t.status === 'open').length} open tickets</p>
        </div>
        <PermissionGate permission={ACTION_PERMISSIONS.ticketsWrite}>
          <Button onClick={() => setShowModal(true)}><Plus size={16} /> New Ticket</Button>
        </PermissionGate>
      </div>

      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field w-auto">
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<LifeBuoy size={28} />} title="No tickets" action={hasPermission(ACTION_PERMISSIONS.ticketsWrite) ? <Button onClick={() => setShowModal(true)}><Plus size={16} /> New Ticket</Button> : undefined} />
      ) : (
        <Card>
          <div className="divide-y divide-line">
            {filtered.map((t) => (
              <div key={t.id} className="flex items-center justify-between p-4 hover:bg-muted cursor-pointer" onClick={() => { setSelected(t); setView('detail'); }}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600"><LifeBuoy size={16} /></div>
                  <div>
                    <p className="text-sm font-medium text-primary">{t.ticket_number}</p>
                    <p className="text-xs text-tertiary">{t.subject} · {t.client?.company_name || 'Internal'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={PRIORITY_CONFIG[t.priority].variant}>{PRIORITY_CONFIG[t.priority].label}</Badge>
                  <Badge variant={STATUS_CONFIG[t.status].variant} dot>{STATUS_CONFIG[t.status].label}</Badge>
                  <span className="text-xs text-tertiary hidden sm:block">{timeAgo(t.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <TicketModal open={showModal && hasPermission(ACTION_PERMISSIONS.ticketsWrite)} onClose={() => setShowModal(false)} clients={clients} profiles={profiles} onSaved={() => { setShowModal(false); load(); }} />
    </div>
  );
}

function TicketModal({ open, onClose, clients, profiles, onSaved }: { open: boolean; onClose: () => void; clients: Client[]; profiles: Profile[]; onSaved: () => void }) {
  const { profile } = useAuth();
  const { add } = useToast();
  const [form, setForm] = useState<Partial<Ticket>>({ priority: 'medium', status: 'open' });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const ticketNumber = generateNumber('TKT');
      const { error } = await supabase.from('tickets').insert({
        ticket_number: ticketNumber,
        subject: form.subject,
        client_id: form.client_id || null,
        created_by: profile?.id,
        assigned_to: form.assigned_to || null,
        priority: form.priority || 'medium',
        status: 'open',
        description: form.description,
      });
      if (error) throw error;
      add('success', 'Ticket created');
      onSaved();
    } catch (err) {
      add('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Support Ticket"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={handleSave} loading={saving} disabled={!form.subject}>Create Ticket</Button></>}>
      <div className="space-y-4">
        <Input label="Subject" value={form.subject || ''} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
        <Textarea label="Description" rows={4} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-4">
          <Select label="Client" value={form.client_id || ''} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">Internal</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </Select>
          <Select label="Assign To" value={form.assigned_to || ''} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
            <option value="">Unassigned</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </Select>
          <Select label="Priority" value={form.priority || 'medium'} onChange={(e) => setForm({ ...form, priority: e.target.value as Ticket['priority'] })}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </div>
      </div>
    </Modal>
  );
}

function TicketDetail({ ticket, profiles, onBack, onUpdated, onUpdateStatus }: { ticket: Ticket; profiles: Profile[]; onBack: () => void; onUpdated: () => void; onUpdateStatus: (t: Ticket, s: TicketStatus) => void }) {
  const { profile } = useAuth();
  const { add } = useToast();
  const { hasPermission } = useOrganization();
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const [internal, setInternal] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('ticket_messages').select('*, author:profiles(*)').eq('ticket_id', ticket.id).order('created_at');
      setMessages((data as TicketMessage[]) ?? []);
    }
    load();
  }, [ticket.id]);

  async function sendMsg() {
    if (!hasPermission(ACTION_PERMISSIONS.ticketsWrite)) return;
    if (!newMsg.trim()) return;
    const { data, error } = await supabase.from('ticket_messages').insert({
      ticket_id: ticket.id,
      author_id: profile?.id,
      body: newMsg,
      internal,
    }).select('*, author:profiles(*)').single();
    if (error) { add('error', error.message); return; }
    setMessages((prev) => [...prev, data as TicketMessage]);
    setNewMsg('');
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1000px] mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-tertiary hover:text-primary"><ArrowLeft size={16} /> Back to Tickets</button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{ticket.subject}</h1>
          <p className="text-sm text-tertiary">{ticket.ticket_number} · {ticket.client?.company_name || 'Internal'}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant={PRIORITY_CONFIG[ticket.priority].variant}>{PRIORITY_CONFIG[ticket.priority].label}</Badge>
          <Badge variant={STATUS_CONFIG[ticket.status].variant} dot>{STATUS_CONFIG[ticket.status].label}</Badge>
        </div>
      </div>

      {hasPermission(ACTION_PERMISSIONS.ticketsWrite) && <div className="flex gap-2">
        {ticket.status !== 'in_progress' && ticket.status !== 'closed' && (
          <Button variant="subtle" size="sm" onClick={() => onUpdateStatus(ticket, 'in_progress')}>Mark In Progress</Button>
        )}
        {ticket.status !== 'resolved' && ticket.status !== 'closed' && (
          <Button variant="subtle" size="sm" onClick={() => onUpdateStatus(ticket, 'resolved')}>Resolve</Button>
        )}
        {ticket.status !== 'closed' && (
          <Button variant="ghost" size="sm" onClick={() => onUpdateStatus(ticket, 'closed')}>Close Ticket</Button>
        )}
      </div>}

      {ticket.description && (
        <Card className="p-5">
          <p className="text-sm text-secondary whitespace-pre-line">{ticket.description}</p>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-4">Conversation</h3>
        {messages.length === 0 ? (
          <EmptyState icon={<Send size={24} />} title="No messages yet" description="Start the conversation" />
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={cn('flex gap-3', m.internal && 'opacity-60')}>
                <Avatar name={m.author?.full_name} src={m.author?.avatar_url} size="sm" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-primary">{m.author?.full_name || 'Unknown'}</p>
                    {m.internal && <Badge variant="warning">Internal</Badge>}
                    <span className="text-xs text-tertiary">{timeAgo(m.created_at)}</span>
                  </div>
                  <p className="text-sm text-secondary mt-1">{m.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {hasPermission(ACTION_PERMISSIONS.ticketsWrite) && <Card className="p-4">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <Textarea label="" rows={2} value={newMsg} onChange={(e) => setNewMsg(e.target.value)} placeholder="Type a reply..." />
          </div>
          <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer pb-2">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="w-4 h-4 accent-purple" />
            Internal
          </label>
          <Button onClick={sendMsg}><Send size={16} /></Button>
        </div>
      </Card>}
    </div>
  );
}
