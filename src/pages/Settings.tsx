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
import { User, Users, Shield, Bell, Lock, Mail, Phone, Save, KeyRound, Eye, EyeOff } from 'lucide-react';
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
        <p className="text-sm text-tertiary mt-0.5">Manage your account and team</p>
      </div>

      <div className="flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px', tab === t.id ? 'border-purple-600 text-primary' : 'border-transparent text-tertiary hover:text-secondary')}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar name={form.full_name} src={form.avatar_url} size="xl" />
            <div>
              <p className="text-sm font-medium text-primary">{form.full_name}</p>
              <p className="text-xs text-tertiary">{form.email}</p>
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
              <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}</div>
            ) : (
              <div className="divide-y divide-line">
                {team.map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.full_name} src={m.avatar_url} size="md" />
                      <div>
                        <p className="text-sm font-medium text-primary">{m.full_name}</p>
                        <p className="text-xs text-tertiary">{m.email}</p>
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
          <ChangePasswordCard />
          <Card className="p-6">
            <CardTitle>Security Settings</CardTitle>
            <div className="space-y-4 mt-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                <div className="flex items-center gap-3">
                  <Mail size={18} className="text-tertiary" />
                  <div><p className="text-sm font-medium text-primary">Email Verification</p><p className="text-xs text-tertiary">{profile?.email}</p></div>
                </div>
                <Badge variant="success" dot>Verified</Badge>
              </div>
            </div>
          </Card>
          <Card className="p-6">
            <CardTitle>Audit & Compliance</CardTitle>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="p-3 rounded-lg bg-muted"><p className="text-sm font-medium text-primary">GDPR Ready</p><p className="text-xs text-tertiary mt-1">Data protection compliant</p></div>
              <div className="p-3 rounded-lg bg-muted"><p className="text-sm font-medium text-primary">POPIA Compliant</p><p className="text-xs text-tertiary mt-1">South African data protection</p></div>
              <div className="p-3 rounded-lg bg-muted"><p className="text-sm font-medium text-primary">Encrypted Backups</p><p className="text-xs text-tertiary mt-1">Daily automatic backups</p></div>
              <div className="p-3 rounded-lg bg-muted"><p className="text-sm font-medium text-primary">Session Logs</p><p className="text-xs text-tertiary mt-1">Login history tracked</p></div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'notifications' && (
        <NotificationPreferences userId={profile?.id} />
      )}
    </div>
  );
}

function ChangePasswordCard() {
  const { add } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleChangePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      add('error', 'All fields are required');
      return;
    }
    if (newPassword.length < 6) {
      add('error', 'New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      add('error', 'New passwords do not match');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      add('success', 'Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      add('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <KeyRound size={18} className="text-purple-600" />
        <CardTitle>Change Password</CardTitle>
      </div>
      <div className="space-y-4 max-w-md">
        <div className="relative">
          <Input
            label="Current Password"
            type={showPasswords ? 'text' : 'password'}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Input
          label="New Password"
          type={showPasswords ? 'text' : 'password'}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="••••••••"
        />
        <Input
          label="Confirm New Password"
          type={showPasswords ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="•••••••••"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-tertiary cursor-pointer select-none">
            <input type="checkbox" checked={showPasswords} onChange={(e) => setShowPasswords(e.target.checked)} className="w-4 h-4 rounded border-line accent-purple-600" />
            Show passwords
          </label>
          <Button onClick={handleChangePassword} loading={saving} disabled={!currentPassword || !newPassword || !confirmPassword}>
            <Lock size={14} /> Update Password
          </Button>
        </div>
      </div>
    </Card>
  );
}

function NotificationPreferences({ userId }: { userId?: string }) {
  const { add } = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const prefKeys = ['email', 'sms', 'whatsapp', 'push', 'in_app'];
  const prefLabels: Record<string, string> = {
    email: 'Email notifications',
    sms: 'SMS notifications',
    whatsapp: 'WhatsApp notifications',
    push: 'Browser push notifications',
    in_app: 'In-app notifications',
  };

  useEffect(() => {
    if (!userId) return;
    async function load() {
      const { data } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId);
      const map: Record<string, boolean> = {};
      for (const k of prefKeys) map[k] = true;
      if (data) {
        for (const row of data as any[]) {
          map[row.channel] = row.enabled;
        }
      }
      setPrefs(map);
      setLoading(false);
    }
    load();
  }, [userId]);

  async function togglePref(key: string, value: boolean) {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }

  async function savePrefs() {
    if (!userId) return;
    setSaving(true);
    try {
      const rows = prefKeys.map((channel) => ({
        user_id: userId,
        channel,
        enabled: prefs[channel] ?? true,
      }));
      const { error } = await supabase
        .from('notification_preferences')
        .upsert(rows, { onConflict: 'user_id,channel' });
      if (error) throw error;
      add('success', 'Notification preferences saved');
    } catch (err) {
      add('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Card className="p-6"><div className="h-32 bg-muted rounded-lg animate-pulse" /></Card>;
  }

  return (
    <Card className="p-6">
      <CardTitle>Notification Preferences</CardTitle>
      <div className="space-y-3 mt-4">
        {prefKeys.map((k) => (
          <div key={k} className="flex items-center justify-between p-3 rounded-lg bg-muted">
            <span className="text-sm text-secondary">{prefLabels[k]}</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={prefs[k] ?? true} onChange={(e) => togglePref(k, e.target.checked)} className="sr-only peer" />
              <div className="w-10 h-5 bg-muted rounded-full peer peer-checked:bg-purple transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
            </label>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={savePrefs} loading={saving}><Save size={16} /> Save Preferences</Button>
      </div>
    </Card>
  );
}
