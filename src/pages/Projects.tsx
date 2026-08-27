import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Project, Client, Profile, ProjectMilestone, ProjectStatus, ProjectType, ProjectHealth } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatDate, cn, isOverdue, daysUntil } from '@/lib/utils';
import { Plus, Briefcase, ArrowLeft, GripVertical, Calendar, DollarSign, AlertTriangle, CheckCircle2, Clock, Activity, Users, Target } from 'lucide-react';

type View = 'board' | 'detail';

const STATUS_COLUMNS: { id: ProjectStatus; label: string; color: string }[] = [
  { id: 'planning', label: 'Planning', color: 'border-l-blue-500' },
  { id: 'in_progress', label: 'In Progress', color: 'border-l-purple-500' },
  { id: 'review', label: 'Review', color: 'border-l-orange-500' },
  { id: 'completed', label: 'Completed', color: 'border-l-green-500' },
  { id: 'on_hold', label: 'On Hold', color: 'border-l-gray-400' },
];

const TYPE_LABELS: Record<ProjectType, string> = {
  website: 'Website',
  printing: 'Printing',
  branding: 'Branding',
  email: 'Company Email',
  hosting: 'Hosting',
  other: 'Other',
};

const HEALTH_CONFIG: Record<ProjectHealth, { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  on_track: { label: 'On Track', variant: 'success' },
  at_risk: { label: 'At Risk', variant: 'warning' },
  delayed: { label: 'Delayed', variant: 'danger' },
  completed: { label: 'Completed', variant: 'success' },
};

export function ProjectsPage() {
  const { profile } = useAuth();
  const { add } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('board');
  const [selected, setSelected] = useState<Project | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<ProjectStatus | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');

  async function load() {
    setLoading(true);
    const [pRes, cRes, uRes] = await Promise.all([
      supabase.from('projects').select('*, client:clients(*)').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').order('company_name'),
      supabase.from('profiles').select('*').order('full_name'),
    ]);
    setProjects((pRes.data as Project[]) ?? []);
    setClients((cRes.data as Client[]) ?? []);
    setProfiles((uRes.data as Profile[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => projects.filter((p) => typeFilter === 'all' || p.type === typeFilter), [projects, typeFilter]);

  const byStatus = useMemo(() => {
    const map: Record<ProjectStatus, Project[]> = { planning: [], in_progress: [], review: [], completed: [], on_hold: [], cancelled: [] };
    filtered.forEach((p) => map[p.status].push(p));
    return map;
  }, [filtered]);

  async function handleDrop(status: ProjectStatus) {
    if (!draggedId) return;
    const proj = projects.find((p) => p.id === draggedId);
    if (!proj || proj.status === status) { setDraggedId(null); setDragOverStatus(null); return; }
    const newProgress = status === 'completed' ? 100 : status === 'review' ? 80 : status === 'in_progress' ? 40 : proj.progress;
    const newHealth = status === 'completed' ? 'completed' : proj.health;
    await supabase.from('projects').update({ status, progress: newProgress, health: newHealth }).eq('id', draggedId);
    setProjects((prev) => prev.map((p) => (p.id === draggedId ? { ...p, status, progress: newProgress, health: newHealth } : p)));
    add('success', `Project moved to ${status.replace('_', ' ')}`);
    setDraggedId(null);
    setDragOverStatus(null);
  }

  if (view === 'detail' && selected) {
    return <ProjectDetail project={selected} profiles={profiles} onBack={() => { setView('board'); setSelected(null); }} onUpdated={load} />;
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-tertiary mt-0.5">{projects.length} total projects</p>
        </div>
        <Button onClick={() => setShowModal(true)}><Plus size={16} /> New Project</Button>
      </div>

      <div className="flex gap-3">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-field w-auto">
          <option value="all">All Types</option>
          <option value="website">Website</option>
          <option value="printing">Printing</option>
          <option value="branding">Branding</option>
          <option value="email">Company Email</option>
          <option value="hosting">Hosting</option>
          <option value="other">Other</option>
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-5 gap-4">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-64 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {STATUS_COLUMNS.map((col) => (
            <div
              key={col.id}
              onDragOver={(e) => { e.preventDefault(); setDragOverStatus(col.id); }}
              onDragLeave={() => setDragOverStatus(null)}
              onDrop={() => handleDrop(col.id)}
              className={cn('rounded-xl border border-line bg-canvas min-h-[300px] transition-colors', dragOverStatus === col.id && 'border-purple/50 bg-purple-50/50')}
            >
              <div className={cn('px-4 py-3 border-b border-line border-l-4 rounded-t-xl', col.color)}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-primary">{col.label}</p>
                  <span className="text-xs text-tertiary">{byStatus[col.id].length}</span>
                </div>
              </div>
              <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                {byStatus[col.id].length === 0 ? (
                  <p className="text-center text-xs text-tertiary py-8">Drop projects here</p>
                ) : (
                  byStatus[col.id].map((p) => (
                    <div
                      key={p.id}
                      draggable
                      onDragStart={() => setDraggedId(p.id)}
                      onDragEnd={() => { setDraggedId(null); setDragOverStatus(null); }}
                      onClick={() => { setSelected(p); setView('detail'); }}
                      className={cn('card p-3 cursor-pointer hover:border-[#D0D5DD] transition-all group', draggedId === p.id && 'opacity-40')}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-medium text-primary truncate flex-1">{p.name}</p>
                        <GripVertical size={14} className="text-tertiary group-hover:text-tertiary" />
                      </div>
                      <p className="text-xs text-tertiary mb-2">{p.client?.company_name}</p>
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="purple-soft">{TYPE_LABELS[p.type]}</Badge>
                        <Badge variant={HEALTH_CONFIG[p.health].variant} dot>{HEALTH_CONFIG[p.health].label}</Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs text-tertiary">
                        <span>{p.progress}%</span>
                        {p.due_date && (
                          <span className={cn(isOverdue(p.due_date) && p.status !== 'completed' && 'text-red-600')}>
                            {formatDate(p.due_date)}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-purple-600 rounded-full transition-all" style={{ width: `${p.progress}%` }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ProjectModal open={showModal} onClose={() => setShowModal(false)} clients={clients} profiles={profiles} onSaved={() => { setShowModal(false); load(); }} />
    </div>
  );
}

function ProjectModal({ open, onClose, clients, profiles, onSaved }: { open: boolean; onClose: () => void; clients: Client[]; profiles: Profile[]; onSaved: () => void }) {
  const { profile } = useAuth();
  const { add } = useToast();
  const [form, setForm] = useState<Partial<Project>>({ type: 'website', status: 'planning', progress: 0, health: 'on_track' });
  const [assignedTo, setAssignedTo] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const { error } = await supabase.from('projects').insert({
        name: form.name,
        client_id: form.client_id,
        type: form.type || 'other',
        status: 'planning',
        description: form.description,
        start_date: form.start_date,
        due_date: form.due_date,
        budget: form.budget || 0,
        progress: 0,
        health: 'on_track',
        assigned_to: assignedTo,
        created_by: profile?.id,
      });
      if (error) throw error;
      add('success', 'Project created');
      await supabase.from('activities').insert({ user_id: profile?.id, type: 'project_created', entity: 'project', description: `created project "${form.name}"` });
      onSaved();
    } catch (err) {
      add('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Project" size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={handleSave} loading={saving} disabled={!form.name || !form.client_id}>Create Project</Button></>}>
      <div className="space-y-4">
        <Input label="Project Name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <div className="grid grid-cols-2 gap-4">
          <Select label="Client" value={form.client_id || ''} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">Select a client...</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </Select>
          <Select label="Type" value={form.type || 'website'} onChange={(e) => setForm({ ...form, type: e.target.value as ProjectType })}>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input label="Start Date" type="date" value={form.start_date || ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          <Input label="Due Date" type="date" value={form.due_date || ''} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          <Input label="Budget" type="number" value={form.budget || 0} onChange={(e) => setForm({ ...form, budget: Number(e.target.value) })} />
        </div>
        <Textarea label="Description" rows={3} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div>
          <label className="label-text block mb-2">Assign Team Members</label>
          <div className="grid grid-cols-2 gap-2">
            {profiles.map((p) => (
              <label key={p.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer">
                <input type="checkbox" checked={assignedTo.includes(p.id)} onChange={(e) => setAssignedTo(e.target.checked ? [...assignedTo, p.id] : assignedTo.filter((id) => id !== p.id))} className="w-4 h-4 accent-purple" />
                <span className="text-sm text-secondary">{p.full_name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ProjectDetail({ project, profiles, onBack, onUpdated }: { project: Project; profiles: Profile[]; onBack: () => void; onUpdated: () => void }) {
  const { profile } = useAuth();
  const { add } = useToast();
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([]);
  const [newMilestone, setNewMilestone] = useState('');
  const [progress, setProgress] = useState(project.progress);
  const [health, setHealth] = useState(project.health);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('project_milestones').select('*').eq('project_id', project.id).order('created_at');
      setMilestones((data as ProjectMilestone[]) ?? []);
    }
    load();
  }, [project.id]);

  async function addMilestone() {
    if (!newMilestone.trim()) return;
    const { data, error } = await supabase.from('project_milestones').insert({ project_id: project.id, title: newMilestone }).select('*').single();
    if (error) { add('error', error.message); return; }
    setMilestones((prev) => [...prev, data as ProjectMilestone]);
    setNewMilestone('');
    add('success', 'Milestone added');
  }

  async function toggleMilestone(m: ProjectMilestone) {
    await supabase.from('project_milestones').update({ completed: !m.completed, completed_at: !m.completed ? new Date().toISOString() : null }).eq('id', m.id);
    setMilestones((prev) => prev.map((x) => (x.id === m.id ? { ...x, completed: !x.completed } : x)));
  }

  async function updateProgress() {
    await supabase.from('projects').update({ progress, health }).eq('id', project.id);
    add('success', 'Project updated');
    onUpdated();
  }

  const assignedMembers = profiles.filter((p) => project.assigned_to?.includes(p.id));
  const completedMilestones = milestones.filter((m) => m.completed).length;

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1200px] mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-tertiary hover:text-primary"><ArrowLeft size={16} /> Back to Projects</button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          <p className="text-sm text-tertiary">{project.client?.company_name} · {TYPE_LABELS[project.type]}</p>
        </div>
        <Badge variant={HEALTH_CONFIG[project.health].variant} dot>{HEALTH_CONFIG[project.health].label}</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: progress & milestones */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-6">
            <h3 className="text-sm font-semibold mb-4">Progress & Health</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2"><span className="text-tertiary">Progress</span><span className="font-medium">{progress}%</span></div>
                <input type="range" min={0} max={100} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="w-full accent-purple" />
                <div className="h-2 bg-muted rounded-full overflow-hidden mt-2">
                  <div className="h-full bg-purple-600 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
              <div>
                <label className="label-text block mb-2">Health Status</label>
                <select value={health} onChange={(e) => setHealth(e.target.value as ProjectHealth)} className="input-field">
                  <option value="on_track">On Track</option>
                  <option value="at_risk">At Risk</option>
                  <option value="delayed">Delayed</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <Button onClick={updateProgress} variant="subtle" size="sm">Save Changes</Button>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Milestones</h3>
              <Badge variant="neutral">{completedMilestones}/{milestones.length}</Badge>
            </div>
            <div className="flex gap-2 mb-4">
              <input value={newMilestone} onChange={(e) => setNewMilestone(e.target.value)} placeholder="Add a milestone..." className="input-field" onKeyDown={(e) => e.key === 'Enter' && addMilestone()} />
              <Button onClick={addMilestone}><Plus size={16} /></Button>
            </div>
            {milestones.length === 0 ? (
              <EmptyState icon={<Target size={24} />} title="No milestones yet" />
            ) : (
              <div className="space-y-2">
                {milestones.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted group">
                    <button onClick={() => toggleMilestone(m)} className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors', m.completed ? 'bg-green-500 border-green-500' : 'border-line')}>
                      {m.completed && <CheckCircle2 size={12} className="text-white" />}
                    </button>
                    <span className={cn('text-sm flex-1', m.completed ? 'text-tertiary line-through' : 'text-primary')}>{m.title}</span>
                    {m.due_date && <span className="text-xs text-tertiary">{formatDate(m.due_date)}</span>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {project.description && (
            <Card className="p-6">
              <h3 className="text-sm font-semibold mb-3">Description</h3>
              <p className="text-sm text-secondary whitespace-pre-line">{project.description}</p>
            </Card>
          )}
        </div>

        {/* Right: details */}
        <div className="space-y-4">
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-semibold">Project Details</h3>
            <div className="space-y-3">
              <DetailRow icon={<Calendar size={14} />} label="Start Date" value={formatDate(project.start_date)} />
              <DetailRow icon={<Calendar size={14} />} label="Due Date" value={formatDate(project.due_date)} overdue={project.due_date ? isOverdue(project.due_date) && project.status !== 'completed' : false} />
              <DetailRow icon={<DollarSign size={14} />} label="Budget" value={formatCurrency(project.budget)} />
              <DetailRow icon={<Activity size={14} />} label="Status" value={project.status.replace('_', ' ')} />
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-3">Assigned Team</h3>
            {assignedMembers.length === 0 ? (
              <p className="text-sm text-tertiary">No one assigned</p>
            ) : (
              <div className="space-y-2">
                {assignedMembers.map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-xs font-semibold text-white">{m.full_name?.[0] || '?'}</div>
                    <span className="text-sm text-secondary">{m.full_name}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value, overdue }: { icon: React.ReactNode; label: string; value: string; overdue?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-tertiary">{icon}</div>
      <div className="flex-1">
        <p className="text-xs text-tertiary">{label}</p>
        <p className={cn('text-sm', overdue ? 'text-red-600' : 'text-primary')}>{value}</p>
      </div>
    </div>
  );
}
