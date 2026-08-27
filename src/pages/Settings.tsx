import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth, ROLE_LABELS } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Profile } from '@/types';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { User, Users, Shield, Bell, Lock, Mail, Phone, Save } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const { add } = useToast();
  const [tab, setTab] = useState<'profile' | 'team' | 'security' | 'notifications'>('profile');
  const [form, setForm] = useState<Partial<Profile>>({});
  const [saving, setSaving] = useState(false);
  const [team, setTeam] = useState<Profile[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(true);

  useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);

  async function loadTeam() {
    setLoadingTeam(true);
    const { data } = await supabase.from('profiles').select('*').order('created_at');
    setTeam((data as Profile[]) ?? []);
    setLoadingTeam(false);
  }

  useEffect(() => { loadTeam(); }, []);

  async function saveProfile() {
    setSaving(true);
    try {
      const { error } = await supabase.from('profiles').update({
        full_name: form.full_name,
        phone: form.phone,
        position: form.position,
        avatar_url: form.avatar_url,
      }).eq('id', profile?.id);
      if (error) throw error;
      add('success', 'Profile updated');
      refreshProfile();
    } catch (err) {
      add('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function updateRole(member: Profile, role: Profile['role']) {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', member.id);
    if (error) { add('error', error.message); return; }
    setTeam((prev) => prev.map((m) => (m.id === member.id ? { ...m, role } : m)));
    add('success', `${member.full_name}'s role updated`);
  }

  async function toggleActive(member: Profile) {
    const { error } = await supabase.from('profiles').update({ active: !member.active }).eq('id', member.id);
    if (error) { add('error', error.message); return; }
    setTeam((prev) => prev.map((m) => (m.id === member.id ? { ...m, active: !m.active } : m)));
  }

  const tabs = [
    { id: 'profile' as const, label: 'Profile', icon: <User size={15} /> },
    { id: 'team' as const, label: 'Team & Roles', icon: <Users size={15} /> },
    { id: 'security' as const, label: 'Security', icon: <Shield size={15} /> },
    { id: 'notifications' as const, label: 'Notifications', icon: <Bell size={15} /> },
  ];

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1000px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-white/40 mt-0.5">Manage your account and team</p>
      </div>

      <div className="flex gap-1 border-b border-ink-border">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px', tab === t.id ? 'border-purple-light text-white' : 'border-transparent text-white/40 hover:text-white/70')}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar name={form.full_name} src={form.avatar_url} size="xl" />
            <div>
              <p className="text-sm font-medium text-white">{form.full_name}</p>
              <p className="text-xs text-white/40">{form.email}</p>
              <Badge variant="purple" className="mt-1">{profile ? ROLE_LABELS[profile.role] : ''}</Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Full Name" value={form.full_name || ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} icon={<User size={16} />} />
            <Input label="Position" value={form.position || ''} onChange={(e) => setForm({ ...form, position: e.target.value })} />
            <Input label="Phone" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} icon={<Phone size={16} />} />
            <Input label="Avatar URL" value={form.avatar_url || ''} onChange={(e) => setForm({ ...form, avatar_url: e.target.value })} />
          </div>
          <Button onClick={saveProfile} loading={saving}><Save size={16} /> Save Changes</Button>
        </Card>
      )}

      {tab === 'team' && (
        <Card>
          <CardHeader><CardTitle>Team Members</CardTitle></CardHeader>
          <CardBody>
            {loadingTeam ? (
              <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-white/5 rounded-lg animate-pulse" />)}</div>
            ) : (
              <div className="divide-y divide-ink-border">
                {team.map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.full_name} src={m.avatar_url} size="md" />
                      <div>
                        <p className="text-sm font-medium text-white">{m.full_name}</p>
                        <p className="text-xs text-white/40">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={m.active ? 'success' : 'neutral'} dot>{m.active ? 'Active' : 'Inactive'}</Badge>
                      <select value={m.role} onChange={(e) => updateRole(m, e.target.value as Profile['role'])} className="input-field w-auto text-sm">
                        {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <Button variant="ghost" size="sm" onClick={() => toggleActive(m)}>{m.active ? 'Deactivate' : 'Activate'}</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'security' && (
        <div className="space-y-4">
          <Card className="p-6">
            <CardTitle>Security Settings</CardTitle>
            <div className="space-y-4 mt-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                <div className="flex items-center gap-3">
                  <Lock size={18} className="text-white/40" />
                  <div><p className="text-sm font-medium text-white">Password</p><p className="text-xs text-white/40">Last changed recently</p></div>
                </div>
                <Button variant="outline" size="sm">Change Password</Button>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                <div className="flex items-center gap-3">
                  <Shield size={18} className="text-white/40" />
                  <div><p className="text-sm font-medium text-white">Two-Factor Authentication</p><p className="text-xs text-white/40">Add an extra layer of security</p></div>
                </div>
                <Button variant="outline" size="sm">Enable 2FA</Button>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                <div className="flex items-center gap-3">
                  <Mail size={18} className="text-white/40" />
                  <div><p className="text-sm font-medium text-white">Email Verification</p><p className="text-xs text-white/40">{profile?.email}</p></div>
                </div>
                <Badge variant="success" dot>Verified</Badge>
              </div>
            </div>
          </Card>
          <Card className="p-6">
            <CardTitle>Audit & Compliance</CardTitle>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="p-3 rounded-lg bg-white/5"><p className="text-sm font-medium text-white">GDPR Ready</p><p className="text-xs text-white/40 mt-1">Data protection compliant</p></div>
              <div className="p-3 rounded-lg bg-white/5"><p className="text-sm font-medium text-white">POPIA Compliant</p><p className="text-xs text-white/40 mt-1">South African data protection</p></div>
              <div className="p-3 rounded-lg bg-white/5"><p className="text-sm font-medium text-white">Encrypted Backups</p><p className="text-xs text-white/40 mt-1">Daily automatic backups</p></div>
              <div className="p-3 rounded-lg bg-white/5"><p className="text-sm font-medium text-white">Session Logs</p><p className="text-xs text-white/40 mt-1">Login history tracked</p></div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'notifications' && (
        <Card className="p-6">
          <CardTitle>Notification Preferences</CardTitle>
          <div className="space-y-3 mt-4">
            {['Email notifications', 'SMS notifications', 'WhatsApp notifications', 'Browser push notifications', 'In-app notifications'].map((n, i) => (
              <div key={n} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                <span className="text-sm text-white/70">{n}</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked={i < 3} className="sr-only peer" />
                  <div className="w-10 h-5 bg-white/10 rounded-full peer peer-checked:bg-purple transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
                </label>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
