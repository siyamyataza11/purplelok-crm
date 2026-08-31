import { useCallback, useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useTenantData } from '@/context/TenantDataContext';
import { ACTION_PERMISSIONS } from '@/lib/authorization';
import { useToast } from '@/components/ui/Toast';
import type { Meeting, Client, MeetingType } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';

const TYPE_CONFIG: Record<MeetingType, { color: string; label: string }> = {
  meeting: { color: 'bg-purple', label: 'Meeting' },
  deadline: { color: 'bg-red-500', label: 'Deadline' },
  call: { color: 'bg-blue-500', label: 'Call' },
  site_visit: { color: 'bg-green-500', label: 'Site Visit' },
  collection: { color: 'bg-orange-500', label: 'Collection' },
  launch: { color: 'bg-purple-light', label: 'Launch' },
  milestone: { color: 'bg-amber-500', label: 'Milestone' },
};

export function CalendarPage() {
  const tenant = useTenantData();
  const { hasPermission } = useOrganization();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showModal, setShowModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMeetings([]); setClients([]);
    const meetingProjection = hasPermission('clients.read') ? '*, client:clients(*)' : '*';
    const [meetingRows, clientRows] = await Promise.all([
      tenant.table('meetings').select<Meeting>(meetingProjection, { order: [{ column: 'start_at' }] }),
      hasPermission('clients.read')
        ? tenant.table('clients').select<Client>('*', { order: [{ column: 'company_name' }] })
        : Promise.resolve([]),
    ]);
    setMeetings(meetingRows); setClients(clientRows);
  }, [hasPermission, tenant]);

  useEffect(() => { void load(); }, [load]);

  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const startOffset = monthStart.getDay();
  const daysInMonth = monthEnd.getDate();

  const days: { date: Date; meetings: Meeting[] }[] = [];
  for (let i = 0; i < startOffset; i++) {
    days.push({ date: new Date(monthStart.getFullYear(), monthStart.getMonth(), -startOffset + i + 1), meetings: [] });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), d);
    const dateStr = date.toISOString().slice(0, 10);
    const dayMeetings = meetings.filter((m) => m.start_at && m.start_at.slice(0, 10) === dateStr);
    days.push({ date, meetings: dayMeetings });
  }

  const today = new Date();
  const isToday = (d: Date) => d.toDateString() === today.toDateString();

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
          <p className="text-sm text-tertiary mt-0.5">Meetings, deadlines, and events</p>
        </div>
        {hasPermission(ACTION_PERMISSIONS.projectsWrite) && <Button onClick={() => { setSelectedDate(new Date().toISOString().slice(0, 10)); setShowModal(true); }}><Plus size={16} /> New Event</Button>}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {currentDate.toLocaleString('en-ZA', { month: 'long', year: 'numeric' })}
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))}><ChevronLeft size={16} /></Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))}><ChevronRight size={16} /></Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="text-center text-xs font-medium text-tertiary py-2">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day, i) => (
            <div
              key={i}
              onClick={() => { setSelectedDate(day.date.toISOString().slice(0, 10)); }}
              className={cn(
                'min-h-[80px] p-2 rounded-lg border cursor-pointer transition-colors hover:bg-muted',
                isToday(day.date) ? 'border-purple-200 bg-purple-50/50' : 'border-line/50',
                day.date.getMonth() !== currentDate.getMonth() && 'opacity-30'
              )}
            >
              <p className={cn('text-xs mb-1', isToday(day.date) ? 'text-purple-600 font-bold' : 'text-tertiary')}>{day.date.getDate()}</p>
              <div className="space-y-1">
                {day.meetings.slice(0, 3).map((m) => (
                  <div
                    key={m.id}
                    className={cn('text-[10px] px-1.5 py-0.5 rounded text-white truncate', TYPE_CONFIG[m.type].color)}
                  >
                    {m.title}
                  </div>
                ))}
                {day.meetings.length > 3 && <p className="text-[10px] text-tertiary">+{day.meetings.length - 3} more</p>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <MeetingModal open={showModal} onClose={() => setShowModal(false)} clients={clients} selectedDate={selectedDate} onSaved={() => { setShowModal(false); load(); }} />
    </div>
  );
}

function MeetingModal({ open, onClose, clients, selectedDate, onSaved }: { open: boolean; onClose: () => void; clients: Client[]; selectedDate: string | null; onSaved: () => void }) {
  const { profile } = useAuth();
  const tenant = useTenantData();
  const { hasPermission } = useOrganization();
  const { add } = useToast();
  const [form, setForm] = useState<Partial<Meeting>>({ type: 'meeting', status: 'scheduled' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedDate) {
      setForm({ type: 'meeting', status: 'scheduled', start_at: `${selectedDate}T09:00`, end_at: `${selectedDate}T10:00` });
    }
  }, [selectedDate, open]);

  async function handleSave() {
    setSaving(true);
    try {
      if (!hasPermission(ACTION_PERMISSIONS.projectsWrite)) throw new Error('Project write permission is required');
      if (form.client_id) await tenant.assertTenantRecord('clients', form.client_id);
      if (profile?.id) await tenant.members.assertActive(profile.id);
      await tenant.table('meetings').insert({
        title: form.title,
        type: form.type || 'meeting',
        client_id: form.client_id || null,
        assigned_to: profile?.id ?? null,
        project_id: null,
        location: form.location,
        start_at: form.start_at,
        end_at: form.end_at,
        notes: form.notes,
        status: 'scheduled',
      });
      add('success', 'Event created');
      onSaved();
    } catch (err) {
      add('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Event"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={handleSave} loading={saving} disabled={!form.title}>Create Event</Button></>}>
      <div className="space-y-4">
        <Input label="Title" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <div className="grid grid-cols-2 gap-4">
          <Select label="Type" value={form.type || 'meeting'} onChange={(e) => setForm({ ...form, type: e.target.value as MeetingType })}>
            {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Select label="Client" value={form.client_id || ''} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">No client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </Select>
          <Input label="Start" type="datetime-local" value={form.start_at || ''} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
          <Input label="End" type="datetime-local" value={form.end_at || ''} onChange={(e) => setForm({ ...form, end_at: e.target.value })} />
        </div>
        <Input label="Location" value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        <Textarea label="Notes" rows={3} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
    </Modal>
  );
}
