import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useToast } from '@/components/ui/Toast';
import type { Profile } from '@/types';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { User, Users, Shield, Bell, Lock, Mail, Phone, Save } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const { membership, roles, hasPermission } = useOrganization();
  const { add } = useToast();
  const [tab, setTab] = useState<'profile' | 'team' | 'security' | 'notifications'>('profile');
  const [form, setForm] = useState<Partial<Profile>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);

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

  const tabs = [
    { id: 'profile' as const, label: 'Profile', icon: <User size={15} /> },
    ...(hasPermission('members.read')
      ? [{ id: 'team' as const, label: 'Team & Roles', icon: <Users size={15} /> }]
      : []),
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
              {membership?.job_title && <p className="text-xs text-secondary mt-1">{membership.job_title}</p>}
              <div className="flex flex-wrap gap-1 mt-1">
                {roles.map((role) => <Badge key={role.id} variant="purple">{role.name}</Badge>)}
              </div>
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
            <div className="rounded-lg bg-muted p-5">
              <p className="text-sm font-medium text-primary">Organization-scoped team management is not enabled yet.</p>
              <p className="text-xs text-tertiary mt-1">
                The previous controls changed global profile fields and were not organization RBAC. They are unavailable until a tenant-scoped management workflow is implemented.
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {tab === 'security' && (
        <div className="space-y-4">
          <Card className="p-6">
            <CardTitle>Security Settings</CardTitle>
            <div className="space-y-4 mt-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                <div className="flex items-center gap-3">
                  <Lock size={18} className="text-tertiary" />
                  <div><p className="text-sm font-medium text-primary">Password</p><p className="text-xs text-tertiary">Last changed recently</p></div>
                </div>
                <Button variant="outline" size="sm">Change Password</Button>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                <div className="flex items-center gap-3">
                  <Shield size={18} className="text-tertiary" />
                  <div><p className="text-sm font-medium text-primary">Two-Factor Authentication</p><p className="text-xs text-tertiary">Add an extra layer of security</p></div>
                </div>
                <Button variant="outline" size="sm">Enable 2FA</Button>
              </div>
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
        <Card className="p-6">
          <CardTitle>Notification Preferences</CardTitle>
          <div className="space-y-3 mt-4">
            {['Email notifications', 'SMS notifications', 'WhatsApp notifications', 'Browser push notifications', 'In-app notifications'].map((n, i) => (
              <div key={n} className="flex items-center justify-between p-3 rounded-lg bg-muted">
                <span className="text-sm text-secondary">{n}</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked={i < 3} className="sr-only peer" />
                  <div className="w-10 h-5 bg-muted rounded-full peer peer-checked:bg-purple transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
                </label>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
