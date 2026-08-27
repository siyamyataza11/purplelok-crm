import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { Dashboard } from '@/pages/Dashboard';
import { ClientsPage } from '@/pages/Clients';
import { LeadsPage } from '@/pages/Leads';
import { QuotesPage } from '@/pages/Quotes';
import { InvoicesPage } from '@/pages/Invoices';
import { ProjectsPage } from '@/pages/Projects';
import { TasksPage } from '@/pages/Tasks';
import { CalendarPage } from '@/pages/Calendar';
import { TicketsPage } from '@/pages/Tickets';
import { DocumentsPage } from '@/pages/Documents';
import { ChatPage } from '@/pages/Chat';
import { ReportsPage } from '@/pages/Reports';
import { AssistantPage } from '@/pages/Assistant';
import { SettingsPage } from '@/pages/Settings';

function AppContent() {
  const { session, loading } = useAuth();
  const [page, setPage] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-600 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          </div>
          <p className="text-sm text-tertiary">Loading PURPLELOK...</p>
        </div>
      </div>
    );
  }

  if (!session) return <AuthScreen />;

  function renderPage() {
    switch (page) {
      case 'dashboard': return <Dashboard />;
      case 'clients': return <ClientsPage initialQuery={searchQuery} />;
      case 'leads': return <LeadsPage />;
      case 'quotes': return <QuotesPage />;
      case 'invoices': return <InvoicesPage />;
      case 'projects': return <ProjectsPage />;
      case 'tasks': return <TasksPage />;
      case 'calendar': return <CalendarPage />;
      case 'tickets': return <TicketsPage />;
      case 'documents': return <DocumentsPage />;
      case 'chat': return <ChatPage />;
      case 'reports': return <ReportsPage />;
      case 'assistant': return <AssistantPage />;
      case 'settings': return <SettingsPage />;
      default: return <Dashboard />;
    }
  }

  return (
    <div className="flex bg-canvas min-h-screen">
      <Sidebar current={page} onNavigate={setPage} collapsed={sidebarCollapsed} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} onNavigate={setPage} searchQuery={searchQuery} onSearchChange={setSearchQuery} />
        <main className="flex-1 overflow-y-auto">{renderPage()}</main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  );
}
