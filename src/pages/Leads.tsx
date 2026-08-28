import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Lead, LeadStage, Profile } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { Plus, Target, GripVertical, Mail, Phone, Calendar, TrendingUp } from 'lucide-react';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { ACTION_PERMISSIONS } from '@/lib/authorization';
import { useOrganization } from '@/context/OrganizationContext';

const STAGES: { id: LeadStage; label: string; color: string; accent: string }[] = [
  { id: 'new_lead', label: 'New Lead', color: 'border-l-blue-500', accent: 'text-blue-600' },
  { id: 'contacted', label: 'Contacted', color: 'border-l-purple-500', accent: 'text-purple-600' },
  { id: 'proposal_sent', label: 'Proposal Sent', color: 'border-l-orange-500', accent: 'text-orange-600' },
  { id: 'negotiating', label: 'Negotiating', color: 'border-l-amber-500', accent: 'text-amber-500' },
  { id: 'won', label: 'Won', color: 'border-l-green-500', accent: 'text-green-600' },
  { id: 'lost', label: 'Lost', color: 'border-l-red-500', accent: 'text-red-600' },
];

export function LeadsPage() {
  const { profile } = useAuth();
  const { hasPermission } = useOrganization();
  const { add } = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<LeadStage | null>(null);

  async function loadLeads() {
    setLoading(true);
    const { data } = await supabase.from('leads').select('*, assigned_to_profile:profiles!leads_assigned_to_fkey(*)').order('created_at', { ascending: false });
    setLeads((data as Lead[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { loadLeads(); }, []);

  const leadsByStage = useMemo(() => {
    const map: Record<LeadStage, Lead[]> = { new_lead: [], contacted: [], proposal_sent: [], negotiating: [], won: [], lost: [] };
    leads.forEach((l) => map[l.stage].push(l));
    return map;
  }, [leads]);

  const totalPipelineValue = leads
    .filter((l) => l.stage !== 'won' && l.stage !== 'lost')
    .reduce((sum, l) => sum + l.estimated_value, 0);

  const wonValue = leads.filter((l) => l.stage === 'won').reduce((sum, l) => sum + l.estimated_value, 0);

  async function handleDrop(stage: LeadStage) {
    if (!hasPermission(ACTION_PERMISSIONS.leadsWrite)) return;
    if (!draggedId) return;
    const lead = leads.find((l) => l.id === draggedId);
    if (!lead || lead.stage === stage) { setDraggedId(null); setDragOverStage(null); return; }
    await supabase.from('leads').update({ stage }).eq('id', draggedId);
    setLeads((prev) => prev.map((l) => (l.id === draggedId ? { ...l, stage } : l)));
    add('success', `Lead moved to ${stage.replace('_', ' ')}`);
    setDraggedId(null);
    setDragOverStage(null);

    await supabase.from('activities').insert({
      user_id: profile?.id,
      type: 'lead_stage_change',
      entity: 'lead',
      entity_id: lead.id,
      description: `moved lead "${lead.company_name}" to ${stage.replace('_', ' ')}`,
    });
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads Pipeline</h1>
          <p className="text-sm text-tertiary mt-0.5">
            Pipeline value: <span className="text-secondary font-medium">{formatCurrency(totalPipelineValue)}</span>
            {' · '}Won: <span className="text-green-600 font-medium">{formatCurrency(wonValue)}</span>
          </p>
        </div>
        <PermissionGate permission={ACTION_PERMISSIONS.leadsWrite}>
          <Button onClick={() => setShowModal(true)}><Plus size={16} /> Add Lead</Button>
        </PermissionGate>
      </div>

      {loading ? (
        <div className="grid grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-64 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {STAGES.map((stage) => (
            <div
              key={stage.id}
              onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.id); }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={() => handleDrop(stage.id)}
              className={cn(
                'rounded-xl border border-line bg-canvas min-h-[300px] transition-colors',
                dragOverStage === stage.id && 'border-purple-500 bg-purple-50/50',
              )}
            >
              <div className={cn('px-4 py-3 border-b border-line border-l-4 rounded-t-xl', stage.color)}>
                <div className="flex items-center justify-between">
                  <p className={cn('text-sm font-semibold', stage.accent)}>{stage.label}</p>
                  <span className="text-xs text-tertiary">{leadsByStage[stage.id].length}</span>
                </div>
                <p className="text-xs text-tertiary mt-0.5">
                  {formatCurrency(leadsByStage[stage.id].reduce((s, l) => s + l.estimated_value, 0))}
                </p>
              </div>
              <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                {leadsByStage[stage.id].length === 0 ? (
                  <p className="text-center text-xs text-tertiary py-8">Drop leads here</p>
                ) : (
                  leadsByStage[stage.id].map((lead) => (
                    <div
                      key={lead.id}
                      draggable={hasPermission(ACTION_PERMISSIONS.leadsWrite)}
                      onDragStart={() => setDraggedId(lead.id)}
                      onDragEnd={() => { setDraggedId(null); setDragOverStage(null); }}
                      className={cn(
                        'card p-3 cursor-grab active:cursor-grabbing hover:border-[#D0D5DD] transition-all group',
                        draggedId === lead.id && 'opacity-40',
                      )}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-medium text-primary truncate flex-1">{lead.company_name}</p>
                        <GripVertical size={14} className="text-tertiary group-hover:text-secondary" />
                      </div>
                      {lead.contact_name && <p className="text-xs text-tertiary mb-2">{lead.contact_name}</p>}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-primary">{formatCurrency(lead.estimated_value)}</span>
                        <div className="flex items-center gap-1">
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full', lead.lead_score >= 70 ? 'bg-green-500' : lead.lead_score >= 40 ? 'bg-orange-500' : 'bg-red-500')} style={{ width: `${lead.lead_score}%` }} />
                          </div>
                          <span className="text-[10px] text-tertiary">{lead.lead_score}</span>
                        </div>
                      </div>
                      {lead.expected_closing_date && (
                        <div className="flex items-center gap-1 text-xs text-tertiary">
                          <Calendar size={11} /> {formatDate(lead.expected_closing_date)}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <LeadModal open={showModal && hasPermission(ACTION_PERMISSIONS.leadsWrite)} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); loadLeads(); }} />
    </div>
  );
}

function LeadModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const { add } = useToast();
  const [form, setForm] = useState<Partial<Lead>>({ stage: 'new_lead', lead_score: 50, estimated_value: 0 });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const { error } = await supabase.from('leads').insert({
        company_name: form.company_name,
        contact_name: form.contact_name,
        email: form.email,
        phone: form.phone,
        source: form.source,
        stage: form.stage || 'new_lead',
        lead_score: form.lead_score || 50,
        estimated_value: form.estimated_value || 0,
        expected_closing_date: form.expected_closing_date,
        notes: form.notes,
        assigned_to: profile?.id,
      });
      if (error) throw error;
      add('success', 'Lead created');
      await supabase.from('activities').insert({
        user_id: profile?.id,
        type: 'lead_created',
        entity: 'lead',
        description: `created lead "${form.company_name}"`,
      });
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
      title="Add Lead"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} disabled={!form.company_name}>Create Lead</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Company Name" value={form.company_name || ''} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Contact Name" value={form.contact_name || ''} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
          <Input label="Source" value={form.source || ''} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Website, referral..." />
          <Input label="Email" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Phone" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Estimated Value" type="number" value={form.estimated_value || 0} onChange={(e) => setForm({ ...form, estimated_value: Number(e.target.value) })} />
          <Input label="Expected Closing Date" type="date" value={form.expected_closing_date || ''} onChange={(e) => setForm({ ...form, expected_closing_date: e.target.value })} />
          <Select label="Stage" value={form.stage || 'new_lead'} onChange={(e) => setForm({ ...form, stage: e.target.value as LeadStage })}>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
          <div className="space-y-1.5">
            <label className="label-text block">Lead Score: {form.lead_score}</label>
            <input type="range" min={0} max={100} value={form.lead_score || 50} onChange={(e) => setForm({ ...form, lead_score: Number(e.target.value) })} className="w-full accent-purple" />
          </div>
        </div>
        <Textarea label="Notes" rows={3} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
    </Modal>
  );
}
