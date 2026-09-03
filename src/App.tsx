import { useState } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { OrganizationProvider, useOrganization } from '@/context/OrganizationContext';
import { TenantDataProvider } from '@/context/TenantDataContext';
import { ToastProvider } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { PasswordRecoveryScreen } from '@/components/auth/PasswordRecoveryScreen';
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
import { canAccessPage, type AppPage } from '@/lib/authorization';
import { isOrganizationContextReady } from '@/context/organization-context-state';

function AppContent() {
  const {
    session,
    loading,
    status: authStatus,
    recoveryCallbackActive,
    revalidateAuth,
    signOut,
  } = useAuth();
  const {
    currentOrganization,
    membership,
    roles,
    permissions,
    availableOrganizations,
    isOrganizationLoading,
    organizationError,
    setActiveOrganization,
    refreshOrganizationContext,
  } = useOrganization();
  const [page, setPage] = useState<AppPage>('dashboard');
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

  if (authStatus === 'password_recovery' || recoveryCallbackActive) {
    return <PasswordRecoveryScreen />;
  }

  if (authStatus === 'verification_error') {
    return (
      <AuthAccessState
        title="Authentication verification failed"
        message="We couldn't verify your account. Please retry or sign out."
        onRetry={() => void revalidateAuth()}
        onSignOut={() => void signOut()}
      />
    );
  }

  if (authStatus === 'account_disabled') {
    return (
      <AuthAccessState
        title="Account disabled"
        message="Your PURPLELOK profile is inactive. Contact an administrator for access."
        onSignOut={() => void signOut()}
      />
    );
  }

  if (authStatus === 'unauthenticated' || !session) return <AuthScreen />;

  if (authStatus !== 'authenticated') {
    return (
      <AuthAccessState
        title="Authentication unavailable"
        message="Your account has not completed live identity verification."
        onRetry={() => void revalidateAuth()}
        onSignOut={() => void signOut()}
      />
    );
  }

  if (isOrganizationLoading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-600 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          </div>
          <p className="text-sm text-tertiary">Verifying organization access...</p>
        </div>
      </div>
    );
  }

  if (organizationError || !isOrganizationContextReady(
    isOrganizationLoading,
    organizationError,
    {
      currentOrganization,
      membership,
      roles,
      permissions,
    },
  )) {
    const canSelect = organizationError?.code === 'selection_required'
      && availableOrganizations.length > 1;
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div className="card w-full max-w-md p-6 text-center space-y-4">
          <div className="w-10 h-10 rounded-lg bg-purple-600 flex items-center justify-center mx-auto">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-primary">
              {organizationError?.code === 'authorization_error'
                ? 'Authorization context error'
                : organizationError?.code === 'no_permissions'
                  ? 'No permissions assigned'
                  : organizationError?.code === 'membership_suspended'
                    ? 'Membership suspended'
                    : organizationError?.code === 'organization_suspended'
                      ? 'Organization suspended'
                      : organizationError?.code === 'invitation_pending'
                        ? 'Invitation pending'
                        : canSelect
                          ? 'Select an organization'
                          : 'No organization access'}
            </h1>
            <p className="text-sm text-tertiary mt-1">
              {organizationError?.message ?? 'Your account cannot enter the CRM.'}
            </p>
          </div>
          {canSelect && (
            <div className="space-y-2">
              {availableOrganizations.map(({ organization }) => (
                <Button
                  key={organization.id}
                  variant="outline"
                  className="w-full"
                  onClick={() => void setActiveOrganization(organization.id)}
                >
                  {organization.name}
                </Button>
              ))}
            </div>
          )}
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => void refreshOrganizationContext()}>Retry</Button>
            <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentOrganization) return null;

  function renderPage() {
    if (!canAccessPage(page, permissions)) {
      return (
        <div className="p-6">
          <div className="card p-8 text-center">
            <h1 className="text-lg font-semibold text-primary">Access denied</h1>
            <p className="text-sm text-tertiary mt-1">Your organization role does not permit this page.</p>
          </div>
        </div>
      );
    }
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
    <div key={currentOrganization.id} className="flex bg-canvas min-h-screen">
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
      <OrganizationProvider>
        <TenantDataProvider>
          <ToastProvider>
            <AppContent />
          </ToastProvider>
        </TenantDataProvider>
      </OrganizationProvider>
    </AuthProvider>
  );
}

function AuthAccessState({
  title,
  message,
  onRetry,
  onSignOut,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-6 text-center space-y-4">
        <div className="w-10 h-10 rounded-lg bg-purple-600 flex items-center justify-center mx-auto">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-primary">{title}</h1>
          <p className="text-sm text-tertiary mt-1">{message}</p>
        </div>
        <div className="flex justify-center gap-2">
          {onRetry && <Button variant="outline" onClick={onRetry}>Retry</Button>}
          <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
