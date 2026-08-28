import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Client, ClientNote, Profile, Invoice, Quote, Project, Task } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatDate, timeAgo, cn } from '@/lib/utils';
import {
  Plus,
  Search,
  Star,
  Users,
  Mail,
  Phone,
  MapPin,
  Building2,
  Globe,
  Tag,
  Trash2,
  Edit3,
  ArrowLeft,
  FileText,
  Receipt,
  Briefcase,
  CheckSquare,
  StickyNote,
  ExternalLink,
} from 'lucide-react';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { ACTION_PERMISSIONS } from '@/lib/authorization';
import { useOrganization } from '@/context/OrganizationContext';

type View = 'list' | 'detail';

export function ClientsPage({ initialQuery = '' }: { initialQuery?: string }) {
  const { profile } = useAuth();
  const { add } = useToast();
  const { hasPermission } = useOrganization();
  const [view, setView] = useState<View>('list');
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialQuery);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  async function loadClients() {
    setLoading(true);
    const { data } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
    setClients((data as Client[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadClients();
  }, []);

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      const matchesSearch =
        !search ||
        c.company_name.toLowerCase().includes(search.toLowerCase()) ||
        c.contact_person?.toLowerCase().includes(search.toLowerCase()) ||
        c.email?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [clients, search, statusFilter]);

  async function toggleFavorite(c: Client) {
    if (!hasPermission(ACTION_PERMISSIONS.clientsWrite)) return;
    await supabase.from('clients').update({ favorite: !c.favorite }).eq('id', c.id);
    setClients((prev) => prev.map((x) => (x.id === c.id ? { ...x, favorite: !x.favorite } : x)));
  }

  if (view === 'detail' && selectedClient) {
    return (
      <ClientDetail
        client={selectedClient}
        onBack={() => {
          setView('list');
          setSelectedClient(null);
        }}
        onUpdated={() => loadClients()}
      />
    );
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
          <p className="text-sm text-tertiary mt-0.5">{clients.length} total clients</p>
        </div>
        <PermissionGate permission={ACTION_PERMISSIONS.clientsWrite}>
          <Button onClick={() => { setEditing(null); setShowModal(true); }}>
            <Plus size={16} /> Add Client
          </Button>
        </PermissionGate>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="input-field pl-10"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field w-auto"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="prospect">Prospect</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="No clients found"
          description="Add your first client to get started"
          action={hasPermission(ACTION_PERMISSIONS.clientsWrite) ? <Button onClick={() => { setEditing(null); setShowModal(true); }}><Plus size={16} /> Add Client</Button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <Card key={c.id} hover className="p-5 group" onClick={() => { setSelectedClient(c); setView('detail'); }}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Avatar name={c.company_name} src={c.logo_url} size="md" />
                  <div>
                    <p className="font-semibold text-primary">{c.company_name}</p>
                    <p className="text-xs text-tertiary">{c.industry || '—'}</p>
                  </div>
                </div>
                {hasPermission(ACTION_PERMISSIONS.clientsWrite) && <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(c); }}
                  className="text-tertiary hover:text-amber-500 transition-colors"
                >
                  <Star size={16} fill={c.favorite ? 'currentColor' : 'none'} className={c.favorite ? 'text-amber-500' : ''} />
                </button>}
              </div>
              <div className="space-y-1.5 text-sm">
                {c.contact_person && (
                  <div className="flex items-center gap-2 text-secondary">
                    <Users size={13} /> {c.contact_person}
                  </div>
                )}
                {c.email && (
                  <div className="flex items-center gap-2 text-secondary truncate">
                    <Mail size={13} /> {c.email}
                  </div>
                )}
                {c.phone && (
                  <div className="flex items-center gap-2 text-secondary">
                    <Phone size={13} /> {c.phone}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-line">
                <Badge variant={c.status === 'active' ? 'success' : c.status === 'prospect' ? 'info' : 'neutral'} dot>
                  {c.status}
                </Badge>
                {c.tags.length > 0 && (
                  <div className="flex gap-1">
                    {c.tags.slice(0, 2).map((t) => (
                      <span key={t} className="text-xs text-tertiary">#{t}</span>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ClientModal
        open={showModal && hasPermission(ACTION_PERMISSIONS.clientsWrite)}
        onClose={() => setShowModal(false)}
        client={editing}
        onSaved={() => {
          setShowModal(false);
          loadClients();
        }}
      />
    </div>
  );
}

function ClientModal({
  open,
  onClose,
  client,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  client: Client | null;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const { add } = useToast();
  const [form, setForm] = useState<Partial<Client>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (client) {
      setForm(client);
    } else {
      setForm({ status: 'active', tags: [], satisfaction_score: 5, social_media: {} });
    }
  }, [client, open]);

  async function handleSave() {
    setSaving(true);
    try {
      if (client) {
        const { error } = await supabase.from('clients').update({
          company_name: form.company_name,
          contact_person: form.contact_person,
          email: form.email,
          phone: form.phone,
          whatsapp: form.whatsapp,
          physical_address: form.physical_address,
          postal_address: form.postal_address,
          company_registration: form.company_registration,
          vat_number: form.vat_number,
          industry: form.industry,
          website: form.website,
          status: form.status,
          notes: form.notes,
          tags: form.tags,
        }).eq('id', client.id);
        if (error) throw error;
        add('success', 'Client updated');
      } else {
        const { error } = await supabase.from('clients').insert({
          company_name: form.company_name,
          contact_person: form.contact_person,
          email: form.email,
          phone: form.phone,
          whatsapp: form.whatsapp,
          physical_address: form.physical_address,
          postal_address: form.postal_address,
          company_registration: form.company_registration,
          vat_number: form.vat_number,
          industry: form.industry,
          website: form.website,
          status: form.status || 'active',
          notes: form.notes,
          tags: form.tags || [],
          satisfaction_score: 5,
          created_by: profile?.id,
        });
        if (error) throw error;
        add('success', 'Client created');

        // Log activity
        await supabase.from('activities').insert({
          user_id: profile?.id,
          type: 'client_created',
          entity: 'client',
          description: `created client "${form.company_name}"`,
        });
      }
      onSaved();
    } catch (err) {
      add('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={client ? 'Edit Client' : 'Add Client'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} disabled={!form.company_name}>
            {client ? 'Save Changes' : 'Create Client'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Company Name" value={form.company_name || ''} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required />
          <Input label="Contact Person" value={form.contact_person || ''} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
          <Input label="Email" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Phone" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="WhatsApp" value={form.whatsapp || ''} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
          <Input label="Industry" value={form.industry || ''} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
          <Input label="Website" value={form.website || ''} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          <Select label="Status" value={form.status || 'active'} onChange={(e) => setForm({ ...form, status: e.target.value as Client['status'] })}>
            <option value="active">Active</option>
            <option value="prospect">Prospect</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </Select>
          <Input label="Company Reg. No." value={form.company_registration || ''} onChange={(e) => setForm({ ...form, company_registration: e.target.value })} />
          <Input label="VAT Number" value={form.vat_number || ''} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} />
        </div>
        <Input label="Physical Address" value={form.physical_address || ''} onChange={(e) => setForm({ ...form, physical_address: e.target.value })} />
        <Input label="Postal Address" value={form.postal_address || ''} onChange={(e) => setForm({ ...form, postal_address: e.target.value })} />
        <Input
          label="Tags (comma separated)"
          value={(form.tags || []).join(', ')}
          onChange={(e) => setForm({ ...form, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
        />
        <Textarea label="Notes" rows={3} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
    </Modal>
  );
}

function ClientDetail({ client, onBack, onUpdated }: { client: Client; onBack: () => void; onUpdated: () => void }) {
  const { profile } = useAuth();
  const { add } = useToast();
  const { hasPermission } = useOrganization();
  const [tab, setTab] = useState<'overview' | 'notes' | 'invoices' | 'quotes' | 'projects' | 'tasks'>('overview');
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    async function load() {
      const [notesRes, invRes, qRes, pRes, tRes] = await Promise.all([
        supabase.from('client_notes').select('*, author:profiles(*)').eq('client_id', client.id).order('created_at', { ascending: false }),
        supabase.from('invoices').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
        supabase.from('quotes').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
        supabase.from('projects').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
        supabase.from('tasks').select('*, assigned_to_profile:profiles!tasks_assigned_to_fkey(*)').eq('client_id', client.id).order('created_at', { ascending: false }),
      ]);
      setNotes((notesRes.data as ClientNote[]) ?? []);
      setInvoices((invRes.data as Invoice[]) ?? []);
      setQuotes((qRes.data as Quote[]) ?? []);
      setProjects((pRes.data as Project[]) ?? []);
      setTasks((tRes.data as Task[]) ?? []);
    }
    load();
  }, [client.id]);

  async function addNote() {
    if (!hasPermission(ACTION_PERMISSIONS.clientsWrite)) return;
    if (!newNote.trim()) return;
    const { data, error } = await supabase.from('client_notes').insert({
      client_id: client.id,
      author_id: profile?.id,
      body: newNote,
    }).select('*, author:profiles(*)').single();
    if (error) { add('error', error.message); return; }
    setNotes((prev) => [data as ClientNote, ...prev]);
    setNewNote('');
    add('success', 'Note added');
  }

  async function deleteNote(id: string) {
    if (!hasPermission(ACTION_PERMISSIONS.clientsWrite)) return;
    await supabase.from('client_notes').delete().eq('id', id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <Building2 size={14} /> },
    { id: 'notes', label: 'Notes', icon: <StickyNote size={14} /> },
    { id: 'invoices', label: 'Invoices', icon: <Receipt size={14} /> },
    { id: 'quotes', label: 'Quotes', icon: <FileText size={14} /> },
    { id: 'projects', label: 'Projects', icon: <Briefcase size={14} /> },
    { id: 'tasks', label: 'Tasks', icon: <CheckSquare size={14} /> },
  ] as const;

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1400px] mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-tertiary hover:text-primary transition-colors">
        <ArrowLeft size={16} /> Back to Clients
      </button>

      {/* Header */}
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={client.company_name} src={client.logo_url} size="xl" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{client.company_name}</h1>
              <div className="flex items-center gap-3 mt-1">
                <Badge variant={client.status === 'active' ? 'success' : 'neutral'} dot>{client.status}</Badge>
                {client.industry && <span className="text-sm text-tertiary">{client.industry}</span>}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              tab === t.id ? 'border-purple-600 text-primary' : 'border-transparent text-tertiary hover:text-secondary'
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-5 space-y-3">
            <h3 className="text-sm font-semibold text-primary mb-3">Contact Information</h3>
            <InfoRow icon={<Users size={14} />} label="Contact Person" value={client.contact_person} />
            <InfoRow icon={<Mail size={14} />} label="Email" value={client.email} />
            <InfoRow icon={<Phone size={14} />} label="Phone" value={client.phone} />
            <InfoRow icon={<Phone size={14} />} label="WhatsApp" value={client.whatsapp} />
            <InfoRow icon={<MapPin size={14} />} label="Physical Address" value={client.physical_address} />
            <InfoRow icon={<MapPin size={14} />} label="Postal Address" value={client.postal_address} />
          </Card>
          <Card className="p-5 space-y-3">
            <h3 className="text-sm font-semibold text-primary mb-3">Company Details</h3>
            <InfoRow icon={<Building2 size={14} />} label="Reg. Number" value={client.company_registration} />
            <InfoRow icon={<Building2 size={14} />} label="VAT Number" value={client.vat_number} />
            <InfoRow icon={<Globe size={14} />} label="Website" value={client.website} link />
            <InfoRow icon={<Tag size={14} />} label="Tags" value={client.tags.join(', ')} />
            <InfoRow icon={<Star size={14} />} label="Satisfaction" value={`${client.satisfaction_score}/5`} />
          </Card>
        </div>
      )}

      {tab === 'notes' && (
        <Card className="p-5">
          {hasPermission(ACTION_PERMISSIONS.clientsWrite) && <div className="flex gap-3 mb-5">
            <input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note..."
              className="input-field"
              onKeyDown={(e) => e.key === 'Enter' && addNote()}
            />
            <Button onClick={addNote}><Plus size={16} /> Add</Button>
          </div>}
          {notes.length === 0 ? (
            <EmptyState icon={<StickyNote size={24} />} title="No notes yet" />
          ) : (
            <div className="space-y-3">
              {notes.map((n) => (
                <div key={n.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted group">
                  <Avatar name={n.author?.full_name} size="sm" />
                  <div className="flex-1">
                    <p className="text-sm text-primary">{n.body}</p>
                    <p className="text-xs text-tertiary mt-1">{n.author?.full_name} · {timeAgo(n.created_at)}</p>
                  </div>
                  {hasPermission(ACTION_PERMISSIONS.clientsWrite) && <button onClick={() => deleteNote(n.id)} className="text-tertiary hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 size={14} />
                  </button>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'invoices' && (
        <Card>
          {invoices.length === 0 ? (
            <EmptyState icon={<Receipt size={24} />} title="No invoices for this client" />
          ) : (
            <div className="divide-y divide-line">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between p-4 hover:bg-muted">
                  <div>
                    <p className="text-sm font-medium text-primary">{inv.invoice_number}</p>
                    <p className="text-xs text-tertiary">{inv.title} · Due {formatDate(inv.due_date)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : 'warning'}>{inv.status}</Badge>
                    <p className="text-sm font-semibold">{formatCurrency(inv.total)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'quotes' && (
        <Card>
          {quotes.length === 0 ? (
            <EmptyState icon={<FileText size={24} />} title="No quotes for this client" />
          ) : (
            <div className="divide-y divide-line">
              {quotes.map((q) => (
                <div key={q.id} className="flex items-center justify-between p-4 hover:bg-muted">
                  <div>
                    <p className="text-sm font-medium text-primary">{q.quote_number}</p>
                    <p className="text-xs text-tertiary">{q.title}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={q.status === 'accepted' ? 'success' : q.status === 'sent' ? 'info' : 'neutral'}>{q.status}</Badge>
                    <p className="text-sm font-semibold">{formatCurrency(q.total)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'projects' && (
        <Card>
          {projects.length === 0 ? (
            <EmptyState icon={<Briefcase size={24} />} title="No projects for this client" />
          ) : (
            <div className="divide-y divide-line">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-4 hover:bg-muted">
                  <div>
                    <p className="text-sm font-medium text-primary">{p.name}</p>
                    <p className="text-xs text-tertiary">{p.type} · {p.status}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={p.status === 'completed' ? 'success' : p.status === 'in_progress' ? 'info' : 'neutral'}>{p.status}</Badge>
                    <span className="text-sm text-secondary">{p.progress}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'tasks' && (
        <Card>
          {tasks.length === 0 ? (
            <EmptyState icon={<CheckSquare size={24} />} title="No tasks for this client" />
          ) : (
            <div className="divide-y divide-line">
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-4 hover:bg-muted">
                  <div>
                    <p className="text-sm font-medium text-primary">{t.title}</p>
                    <p className="text-xs text-tertiary">Due {formatDate(t.deadline)} · {t.assigned_to_profile?.full_name || 'Unassigned'}</p>
                  </div>
                  <Badge variant={t.status === 'done' ? 'success' : t.priority === 'urgent' ? 'danger' : 'neutral'}>{t.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function InfoRow({ icon, label, value, link }: { icon: React.ReactNode; label: string; value: string | null | undefined; link?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div className="text-tertiary mt-0.5">{icon}</div>
      <div className="flex-1">
        <p className="text-xs text-tertiary">{label}</p>
        {value ? (
          link && value ? (
            <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noopener noreferrer" className="text-sm text-purple-600 hover:underline flex items-center gap-1">
              {value} <ExternalLink size={11} />
            </a>
          ) : (
            <p className="text-sm text-primary">{value}</p>
          )
        ) : (
          <p className="text-sm text-tertiary">—</p>
        )}
      </div>
    </div>
  );
}
