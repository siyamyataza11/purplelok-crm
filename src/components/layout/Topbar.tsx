import { useState, useRef, useEffect } from 'react';
import { Search, Bell, Menu, ChevronDown, LogOut, User as UserIcon, Settings as SettingsIcon, Check } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useTenantData } from '@/context/TenantDataContext';
import { markTenantNotificationsRead } from '@/lib/tenant-domain-workflows';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import type { Notification } from '@/types';
import { timeAgo } from '@/lib/utils';
import { canAccessPage, type AppPage } from '@/lib/authorization';

interface TopbarProps {
  onToggleSidebar: () => void;
  onNavigate: (id: AppPage) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export function Topbar({ onToggleSidebar, onNavigate, searchQuery, onSearchChange }: TopbarProps) {
  const { profile, signOut } = useAuth();
  const { currentOrganization, membership, roles, permissions } = useOrganization();
  const tenant = useTenantData();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const notificationScope = `${currentOrganization?.id ?? ''}:${profile?.id ?? ''}`;
  const notificationScopeRef = useRef(notificationScope);
  notificationScopeRef.current = notificationScope;

  useEffect(() => {
    let cancelled = false;
    setNotifications([]);
    async function load() {
      if (!profile?.id) return;
      try {
        const data = await tenant.table('notifications').select<Notification>('*', {
          filters: [{ operator: 'eq', column: 'user_id', value: profile.id }],
          order: [{ column: 'created_at', ascending: false }],
          limit: 20,
        });
        if (!cancelled) setNotifications(data);
      } catch {
        if (!cancelled) setNotifications([]);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [profile?.id, tenant, currentOrganization?.id]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function markAllRead() {
    if (!profile?.id) return;
    const requestScope = notificationScope;
    try {
      await markTenantNotificationsRead(tenant, profile.id, notifications);
      if (notificationScopeRef.current !== requestScope) return;
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // Preserve the unread state when ownership or tenant verification fails.
    }
  }

  return (
    <header className="h-14 sticky top-0 z-20 bg-surface/90 backdrop-blur-sm border-b border-line flex items-center px-4 gap-3">
      <button onClick={onToggleSidebar} className="btn-ghost p-1.5"><Menu size={18} /></button>

      <div className="flex-1 max-w-md relative">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
          <input
            value={searchQuery}
            onChange={(e) => { onSearchChange(e.target.value); setSearchOpen(e.target.value.length > 0); }}
            onFocus={() => searchQuery && setSearchOpen(true)}
            placeholder="Search clients, projects, invoices..."
            className="w-full bg-muted border border-line rounded-lg pl-9 pr-4 py-1.5 text-sm text-primary placeholder-tertiary focus:outline-none focus:border-purple-400 focus:bg-surface transition-colors"
          />
        </div>
        {searchOpen && searchQuery && (
          <div className="absolute top-full mt-1 w-full bg-surface rounded-lg shadow-lg border border-line p-1.5 animate-scale-in">
            <p className="px-3 py-2 text-xs text-tertiary">Search "{searchQuery}" across the CRM</p>
            {canAccessPage('clients', permissions) && <button onClick={() => { onNavigate('clients'); setSearchOpen(false); }} className="w-full text-left px-3 py-1.5 rounded-md hover:bg-muted text-sm text-secondary flex items-center gap-2"><Search size={13} /> Search in Clients</button>}
            {canAccessPage('projects', permissions) && <button onClick={() => { onNavigate('projects'); setSearchOpen(false); }} className="w-full text-left px-3 py-1.5 rounded-md hover:bg-muted text-sm text-secondary flex items-center gap-2"><Search size={13} /> Search in Projects</button>}
          </div>
        )}
      </div>

      <div className="relative" ref={notifRef}>
        <button onClick={() => setNotifOpen(!notifOpen)} className="btn-ghost p-1.5 relative">
          <Bell size={18} />
          {unreadCount > 0 && <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-purple-600 rounded-full" />}
        </button>
        {notifOpen && (
          <div className="absolute right-0 top-full mt-1 w-80 bg-surface rounded-lg shadow-lg border border-line animate-scale-in">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <p className="text-sm font-semibold text-primary">Notifications</p>
              {unreadCount > 0 && <button onClick={markAllRead} className="text-xs text-purple-600 hover:underline flex items-center gap-1"><Check size={12} /> Mark all read</button>}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-tertiary">No notifications yet</p>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className={cn('px-4 py-3 border-b border-line last:border-0 hover:bg-muted cursor-pointer', !n.read && 'bg-purple-50/50')}>
                    <p className="text-sm text-primary">{n.title}</p>
                    {n.body && <p className="text-xs text-secondary mt-0.5">{n.body}</p>}
                    <p className="text-[10px] text-tertiary mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <div className="relative" ref={userMenuRef}>
        <button onClick={() => setUserOpen(!userOpen)} className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-muted transition-colors">
          <Avatar name={profile?.full_name} src={profile?.avatar_url} size="sm" />
          <div className="hidden sm:block text-left">
            <p className="text-sm font-medium text-primary leading-tight">{profile?.full_name || 'User'}</p>
            <p className="text-[10px] text-tertiary">{membership?.job_title || roles.map((role) => role.name).join(', ')}</p>
          </div>
          <ChevronDown size={14} className="text-tertiary" />
        </button>
        {userOpen && (
          <div className="absolute right-0 top-full mt-1 w-56 bg-surface rounded-lg shadow-lg border border-line animate-scale-in">
            <div className="px-4 py-3 border-b border-line">
              <p className="text-sm font-medium text-primary">{profile?.full_name}</p>
              <p className="text-xs text-secondary">{profile?.email}</p>
              <p className="text-xs text-tertiary mt-1">{currentOrganization?.name}</p>
              {membership?.job_title && <p className="text-xs text-secondary mt-1">{membership.job_title}</p>}
              <div className="mt-2 flex flex-wrap gap-1">
                {roles.map((role) => <Badge key={role.id} variant="purple">{role.name}</Badge>)}
              </div>
            </div>
            <div className="p-1">
              {canAccessPage('settings', permissions) && <>
                <button onClick={() => { onNavigate('settings'); setUserOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md hover:bg-muted text-sm text-secondary"><UserIcon size={15} /> Profile</button>
                <button onClick={() => { onNavigate('settings'); setUserOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md hover:bg-muted text-sm text-secondary"><SettingsIcon size={15} /> Settings</button>
              </>}
              <button onClick={signOut} className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md hover:bg-red-50 text-sm text-danger"><LogOut size={15} /> Sign out</button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
