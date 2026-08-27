import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Task, Profile, TaskStatus, TaskPriority, Client, Project } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDate, cn, isToday, isOverdue } from '@/lib/utils';
import { Plus, CheckSquare, Check, Clock, Flag, User } from 'lucide-react';

const STATUS_COLS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'todo', label: 'To Do', color: 'border-l-gray-400' },
  { id: 'in_progress', label: 'In Progress', color: 'border-l-purple-500' },
  { id: 'review', label: 'Review', color: 'border-l-orange-500' },
  { id: 'done', label: 'Done', color: 'border-l-green-500' },
];

const PRIORITY_CONFIG: Record<TaskPriority, { variant: 'neutral' | 'info' | 'warning' | 'danger'; label: string }> = {
  low: { variant: 'neutral', label: 'Low' },
  medium: { variant: 'info', label: 'Medium' },
  high: { variant: 'warning', label: 'High' },
  urgent: { variant: 'danger', label: 'Urgent' },
};

export function TasksPage() {
  const { profile } = useAuth();
  const { add } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState<'all' | 'mine' | 'today' | 'overdue'>('all');

  async function load() {
    setLoading(true);
    const [tRes, uRes, cRes, pRes] = await Promise.all([
      supabase.from('tasks').select('*, assigned_to_profile:profiles!tasks_assigned_to_fkey(*), project:projects(*), client:clients(*)').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('clients').select('*').order('company_name'),
      supabase.from('projects').select('*').order('name'),
    ]);
    setTasks((tRes.data as Task[]) ?? []);
    setProfiles((uRes.data as Profile[]) ?? []);
    setClients((cRes.data as Client[]) ?? []);
    setProjects((pRes.data as Project[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (filter === 'mine') return t.assigned_to === profile?.id;
      if (filter === 'today') return t.deadline && isToday(t.deadline) && t.status !== 'done';
      if (filter === 'overdue') return t.deadline && isOverdue(t.deadline) && t.status !== 'done';
      return true;
    });
  }, [tasks, filter, profile?.id]);

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], review: [], done: [] };
    filtered.forEach((t) => map[t.status].push(t));
    return map;
  }, [filtered]);

  async function moveTask(task: Task, status: TaskStatus) {
    await supabase.from('tasks').update({ status }).eq('id', task.id);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
    add('success', 'Task updated');
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-sm text-tertiary mt-0.5">{tasks.length} total tasks</p>
        </div>
        <Button onClick={() => setShowModal(true)}><Plus size={16} /> New Task</Button>
      </div>

      <div className="flex gap-2">
        {(['all', 'mine', 'today', 'overdue'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn('px-3 py-1.5 rounded-lg text-sm capitalize transition-colors', filter === f ? 'bg-purple-50 text-purple-600' : 'text-tertiary hover:text-primary hover:bg-muted')}>
            {f === 'mine' ? 'My Tasks' : f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-64 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {STATUS_COLS.map((col) => (
            <div key={col.id} className="rounded-xl border border-line bg-canvas min-h-[300px]">
              <div className={cn('px-4 py-3 border-b border-line border-l-4 rounded-t-xl', col.color)}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-primary">{col.label}</p>
                  <span className="text-xs text-tertiary">{byStatus[col.id].length}</span>
                </div>
              </div>
              <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                {byStatus[col.id].length === 0 ? (
                  <p className="text-center text-xs text-tertiary py-8">No tasks</p>
                ) : (
                  byStatus[col.id].map((t) => (
                    <div key={t.id} className="card p-3 group">
                      <div className="flex items-start gap-2 mb-2">
                        <button
                          onClick={() => moveTask(t, t.status === 'done' ? 'todo' : 'done')}
                          className={cn('w-4 h-4 rounded border-2 flex items-center justify-center mt-0.5 shrink-0 transition-colors', t.status === 'done' ? 'bg-green-500 border-green-500' : 'border-line hover:border-purple-600')}
                        >
                          {t.status === 'done' && <Check size={10} className="text-white" />}
                        </button>
                        <p className={cn('text-sm flex-1', t.status === 'done' ? 'text-tertiary line-through' : 'text-primary')}>{t.title}</p>
                      </div>
                      {t.description && <p className="text-xs text-tertiary mb-2 pl-6">{t.description}</p>}
                      <div className="flex items-center justify-between pl-6">
                        <Badge variant={PRIORITY_CONFIG[t.priority].variant}>{PRIORITY_CONFIG[t.priority].label}</Badge>
                        {t.deadline && (
                          <span className={cn('text-xs flex items-center gap-1', isOverdue(t.deadline) && t.status !== 'done' ? 'text-red-600' : 'text-tertiary')}>
                            <Clock size={11} /> {formatDate(t.deadline)}
                          </span>
                        )}
                      </div>
                      {t.assigned_to_profile && (
                        <div className="flex items-center gap-1.5 mt-2 pl-6">
                          <Avatar name={t.assigned_to_profile.full_name} src={t.assigned_to_profile.avatar_url} size="xs" />
                          <span className="text-xs text-tertiary">{t.assigned_to_profile.full_name}</span>
                        </div>
                      )}
                      <div className="flex gap-1 mt-2 pl-6 opacity-0 group-hover:opacity-100 transition-opacity">
                        {t.status !== 'done' && (
                          <button onClick={() => moveTask(t, 'in_progress')} className="text-[10px] px-2 py-0.5 rounded bg-muted text-secondary hover:text-primary">Start</button>
                        )}
                        {t.status === 'in_progress' && <button onClick={() => moveTask(t, 'review')} className="text-[10px] px-2 py-0.5 rounded bg-muted text-secondary hover:text-primary">Review</button>}
                        {t.status === 'review' && <button onClick={() => moveTask(t, 'done')} className="text-[10px] px-2 py-0.5 rounded bg-muted text-secondary hover:text-primary">Complete</button>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <TaskModal open={showModal} onClose={() => setShowModal(false)} profiles={profiles} clients={clients} projects={projects} onSaved={() => { setShowModal(false); load(); }} />
    </div>
  );
}

function TaskModal({ open, onClose, profiles, clients, projects, onSaved }: { open: boolean; onClose: () => void; profiles: Profile[]; clients: Client[]; projects: Project[]; onSaved: () => void }) {
  const { profile } = useAuth();
  const { add } = useToast();
  const [form, setForm] = useState<Partial<Task>>({ priority: 'medium', status: 'todo' });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const { error } = await supabase.from('tasks').insert({
        title: form.title,
        description: form.description,
        project_id: form.project_id || null,
        client_id: form.client_id || null,
        assigned_to: form.assigned_to || null,
        created_by: profile?.id,
        priority: form.priority || 'medium',
        status: 'todo',
        deadline: form.deadline,
      });
      if (error) throw error;
      add('success', 'Task created');
      onSaved();
    } catch (err) {
      add('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Task"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={handleSave} loading={saving} disabled={!form.title}>Create Task</Button></>}>
      <div className="space-y-4">
        <Input label="Title" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <Textarea label="Description" rows={3} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-4">
          <Select label="Assign To" value={form.assigned_to || ''} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
            <option value="">Unassigned</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </Select>
          <Select label="Priority" value={form.priority || 'medium'} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
          <Input label="Deadline" type="date" value={form.deadline || ''} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          <Select label="Project" value={form.project_id || ''} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select label="Client" value={form.client_id || ''} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">No client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </Select>
        </div>
      </div>
    </Modal>
  );
}
