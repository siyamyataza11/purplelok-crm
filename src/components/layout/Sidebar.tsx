import { ReactNode } from 'react';
import {
  LayoutDashboard, Users, Target, FileText, Receipt, Briefcase,
  CheckSquare, Calendar, LifeBuoy, FolderOpen, Settings, Sparkles,
  MessageSquare, BarChart3, Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { canAccessPage, type AppPage } from '@/lib/authorization';
import { useOrganization } from '@/context/OrganizationContext';

export interface NavItem { id: AppPage; label: string; icon: ReactNode; group: string; }

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={17} />, group: 'Overview' },
  { id: 'clients', label: 'Clients', icon: <Users size={17} />, group: 'CRM' },
  { id: 'leads', label: 'Leads Pipeline', icon: <Target size={17} />, group: 'CRM' },
  { id: 'quotes', label: 'Quotations', icon: <FileText size={17} />, group: 'CRM' },
  { id: 'invoices', label: 'Invoices', icon: <Receipt size={17} />, group: 'Finance' },
  { id: 'projects', label: 'Projects', icon: <Briefcase size={17} />, group: 'Operations' },
  { id: 'tasks', label: 'Tasks', icon: <CheckSquare size={17} />, group: 'Operations' },
  { id: 'calendar', label: 'Calendar', icon: <Calendar size={17} />, group: 'Operations' },
  { id: 'tickets', label: 'Support Desk', icon: <LifeBuoy size={17} />, group: 'Operations' },
  { id: 'documents', label: 'Documents', icon: <FolderOpen size={17} />, group: 'Workspace' },
  { id: 'chat', label: 'Team Chat', icon: <MessageSquare size={17} />, group: 'Workspace' },
  { id: 'reports', label: 'Reports', icon: <BarChart3 size={17} />, group: 'Workspace' },
  { id: 'assistant', label: 'PURPLE AI', icon: <Sparkles size={17} />, group: 'Workspace' },
  { id: 'settings', label: 'Settings', icon: <Settings size={17} />, group: 'System' },
];

interface SidebarProps { current: AppPage; onNavigate: (id: AppPage) => void; collapsed: boolean; }

export function Sidebar({ current, onNavigate, collapsed }: SidebarProps) {
  const { permissions } = useOrganization();
  const groups = [...new Set(NAV_ITEMS.map((n) => n.group))];
  const authorizedItems = NAV_ITEMS.filter((item) => canAccessPage(item.id, permissions));

  return (
    <aside className={cn('h-screen sticky top-0 flex flex-col border-r border-line bg-surface transition-all duration-200 z-30 shrink-0', collapsed ? 'w-16' : 'w-56')}>
      <div className="h-14 flex items-center px-4 border-b border-line shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-purple-600 flex items-center justify-center shrink-0">
            <Lock size={14} className="text-white" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="text-sm font-bold tracking-tight text-primary whitespace-nowrap">PURPLELOK</p>
              <p className="text-[10px] text-tertiary whitespace-nowrap">Command Center</p>
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-5">
        {groups.map((group) => (
          <div key={group}>
            {!collapsed && <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-tertiary">{group}</p>}
            <div className="space-y-0.5">
              {authorizedItems.filter((n) => n.group === group).map((item) => {
                const active = current === item.id;
                return (
                  <button key={item.id} onClick={() => onNavigate(item.id)}
                    className={cn('w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors duration-150',
                      active ? 'bg-purple-50 text-purple-700 font-medium' : 'text-secondary hover:text-primary hover:bg-muted')}>
                    <span className={cn('shrink-0', active ? 'text-purple-600' : 'text-tertiary')}>{item.icon}</span>
                    {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="p-3 border-t border-line">
          <button onClick={() => onNavigate('assistant')} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 transition-colors">
            <Sparkles size={16} className="text-purple-600 shrink-0" />
            <div className="text-left">
              <p className="text-xs font-medium">PURPLE AI</p>
              <p className="text-[10px] text-purple-600/70">Ask anything</p>
            </div>
          </button>
        </div>
      )}
    </aside>
  );
}
