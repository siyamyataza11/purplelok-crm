import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Lock, Mail, ArrowRight, Shield, Sparkles, CheckCircle2 } from 'lucide-react';
import {
  PASSWORD_RESET_REQUEST_CONFIRMATION,
  PASSWORD_UPDATED_CONFIRMATION,
} from '@/lib/auth-errors';

type Mode = 'login' | 'forgot';

export function AuthScreen() {
  const {
    signIn,
    resetPassword,
    error: authError,
    recoveryStatus,
  } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password);
        if (error) setError(error);
      } else {
        const { error } = await resetPassword(email);
        if (error) setError(error);
        else setInfo(PASSWORD_RESET_REQUEST_CONFIRMATION);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-canvas">
      <div className="hidden lg:flex w-1/2 relative overflow-hidden bg-surface border-r border-line">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-50 via-surface to-purple-50/30" />
        <div className="absolute top-0 right-0 w-72 h-72 bg-purple-100/40 rounded-full blur-[80px]" />
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-purple-100/30 rounded-full blur-[80px]" />
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center"><Lock className="w-4 h-4 text-white" /></div>
            <span className="text-base font-semibold tracking-tight text-primary">PURPLELOK</span>
          </div>
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 border border-purple-100 text-xs text-purple-700 font-medium"><Sparkles size={12} /> Command Center</div>
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-primary">The internal CRM<br />built for <span className="text-purple-700">PURPLELOK</span></h1>
            <p className="text-secondary text-base max-w-md">Manage clients, leads, quotes, invoices, projects, and your entire business — all in one workspace.</p>
            <div className="space-y-2.5 pt-2">
              {['Complete client & lead management', 'Quotes, invoices, and financial dashboard', 'Projects, tasks, calendar, and support desk', 'PURPLE AI business assistant built in'].map((f) => (
                <div key={f} className="flex items-center gap-3 text-sm text-secondary"><CheckCircle2 size={16} className="text-purple-600 shrink-0" />{f}</div>
              ))}
            </div>
          </div>
          <p className="text-xs text-tertiary">© {new Date().getFullYear()} PURPLELOK. All rights reserved.</p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-canvas">
        <div className="w-full max-w-sm animate-slide-up">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center"><Lock className="w-4 h-4 text-white" /></div>
            <span className="text-base font-semibold tracking-tight text-primary">PURPLELOK</span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-primary mb-1">{mode === 'login' ? 'Welcome back' : 'Reset password'}</h2>
          <p className="text-sm text-secondary mb-6">{mode === 'login' ? 'Sign in to access the PURPLELOK internal business management system' : "We'll send you a reset link"}</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input id="auth-email" label="Email" type="email" placeholder="you@purplelok.com" value={email} onChange={(e) => setEmail(e.target.value)} icon={<Mail size={15} />} required />
            {mode !== 'forgot' && <Input id="auth-password" label="Password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} icon={<Lock size={15} />} required />}
            {(error || authError) && <div className="text-sm text-danger bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error ?? authError}</div>}
            {(info || recoveryStatus === 'password_updated') && (
              <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                {info ?? PASSWORD_UPDATED_CONFIRMATION}
              </div>
            )}
            {mode === 'login' && (
              <div className="flex items-center justify-end text-sm">
                <button type="button" onClick={() => setMode('forgot')} className="text-secondary hover:text-purple-700 transition-colors">Forgot password?</button>
              </div>
            )}
            <Button type="submit" className="w-full" size="lg" loading={loading}>
              {mode === 'login' ? 'Sign in' : 'Send reset link'}<ArrowRight size={15} />
            </Button>
          </form>
          {mode === 'forgot' && (
            <div className="mt-6 text-center text-sm text-secondary">
              <button onClick={() => setMode('login')} className="text-purple-700 hover:underline font-medium">Back to sign in</button>
            </div>
          )}
          {mode === 'login' && <div className="mt-8 flex items-center justify-center gap-2 text-xs text-tertiary"><Shield size={12} />Protected by 256-bit encryption</div>}
        </div>
      </div>
    </div>
  );
}
