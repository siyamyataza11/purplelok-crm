import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => auth,
}));

import { AuthScreen } from '@/components/auth/AuthScreen';

const projectRoot = resolve(process.cwd());

function readProjectFile(path: string) {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(path) ? [path] : [];
  });
}

describe('Batch 5E-B1 internal auth containment', () => {
  beforeEach(() => {
    auth.signIn.mockReset().mockResolvedValue({ error: null });
    auth.resetPassword.mockReset().mockResolvedValue({ error: null });
  });

  it('renders the existing email/password login flow', () => {
    render(<AuthScreen />);

    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('renders no public signup option or account-creation copy', () => {
    render(<AuthScreen />);

    expect(screen.queryByText(/sign up/i)).toBeNull();
    expect(screen.queryByText(/create (?:your )?account/i)).toBeNull();
    expect(screen.queryByLabelText(/full name/i)).toBeNull();
    expect(screen.queryByText(/remember me/i)).toBeNull();
  });

  it('cannot navigate into a stale signup mode', () => {
    render(<AuthScreen />);

    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    expect(screen.getByRole('heading', { name: /reset password/i })).toBeTruthy();
    expect(screen.queryByText(/sign up/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeTruthy();
  });

  it('exposes no signup function through AuthContext', () => {
    const contextSource = readProjectFile('src/context/AuthContext.tsx');

    expect(contextSource).not.toMatch(/\bsignUp\b/);
  });

  it('contains no Supabase signup call or local signup wrapper in application source', () => {
    const matches = sourceFiles(resolve(projectRoot, 'src')).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return /auth\.signUp|\bsignUp\s*[:=(]/.test(source) ? [path] : [];
    });

    expect(matches).toEqual([]);
  });

  it('keeps login submission functional', async () => {
    render(<AuthScreen />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'employee@purplelok.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(auth.signIn).toHaveBeenCalledWith('employee@purplelok.com', 'correct-password');
    });
    expect(auth.resetPassword).not.toHaveBeenCalled();
  });

  it('keeps the password-reset flow visible and functional', async () => {
    render(<AuthScreen />);

    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'employee@purplelok.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(auth.resetPassword).toHaveBeenCalledWith('employee@purplelok.com');
    });
    expect(screen.getByText(/password reset link sent/i)).toBeTruthy();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('contains no signup metadata write path', () => {
    const contextSource = readProjectFile('src/context/AuthContext.tsx');
    const screenSource = readProjectFile('src/components/auth/AuthScreen.tsx');

    expect(contextSource).not.toMatch(/auth\.signUp|raw_user_meta_data|options\s*:\s*\{\s*data/);
    expect(screenSource).not.toMatch(/fullName|Create your account|Join the PURPLELOK team/);
  });
});
