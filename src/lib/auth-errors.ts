export const AUTH_MESSAGES = {
  verificationFailed: "We couldn't verify your account. Please retry or sign out.",
  sessionError: 'Your session could not be verified. Please sign in again.',
  signInFailed: 'Sign in failed. Check your credentials and try again.',
  signOutWarning: 'You are signed out locally. The server could not be reached.',
  passwordResetFailed: 'Password reset could not be started. Please try again.',
  passwordUpdateFailed: 'Your password could not be updated. Request a new reset link and try again.',
  recoveryFailed: 'This recovery session is invalid or has expired. Request a new password reset link from this browser.',
} as const;

export const PASSWORD_RESET_REQUEST_CONFIRMATION =
  'If an account exists for that email, a reset link has been sent.';

export const PASSWORD_UPDATED_CONFIRMATION =
  'Your password was changed. Sign in again with your new password.';
