import { useState } from 'react';
import { Lock, Shield } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { validateRecoveryPassword } from '@/lib/password-recovery';

export function PasswordRecoveryScreen() {
  const {
    recoveryStatus,
    recoveryCanUpdate,
    recoveryError,
    updateRecoveryPassword,
    signOut,
  } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const canSubmit = recoveryCanUpdate && (
    recoveryStatus === 'recovery_session' || recoveryStatus === 'recovery_error'
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validation = validateRecoveryPassword(password, confirmation);
    if (validation) {
      setValidationError(validation);
      return;
    }
    setValidationError(null);
    const result = await updateRecoveryPassword(password);
    if (!result.error) {
      setPassword('');
      setConfirmation('');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-canvas">
      <div className="card w-full max-w-sm p-6 animate-slide-up">
        <div className="w-10 h-10 rounded-lg bg-purple-600 flex items-center justify-center mb-5">
          <Lock className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-primary">Set a new password</h1>
        <p className="text-sm text-secondary mt-1 mb-6">
          Password recovery does not grant CRM access. After updating it, sign in again with your new password.
        </p>

        {recoveryCanUpdate ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id="recovery-password"
              label="New Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <Input
              id="recovery-password-confirmation"
              label="Confirm New Password"
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              required
            />
            {(validationError || recoveryError) && (
              <div className="text-sm text-danger bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {validationError ?? recoveryError}
              </div>
            )}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={recoveryStatus === 'updating_password'}
              disabled={!canSubmit}
            >
              Update Password
            </Button>
          </form>
        ) : (
          <div className="text-sm text-danger bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {recoveryError}
          </div>
        )}

        <Button
          variant="ghost"
          className="w-full mt-3"
          onClick={() => void signOut()}
        >
          Return to sign in
        </Button>
        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-tertiary">
          <Shield size={12} /> Internal account recovery
        </div>
      </div>
    </div>
  );
}
