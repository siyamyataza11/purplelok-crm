import { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
}

export function Input({ label, error, icon, className, id, ...props }: InputProps) {
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={id} className="label-text block">{label}</label>}
      <div className="relative">
        {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary">{icon}</div>}
        <input id={id} className={cn('input-field', icon && 'pl-10', error && 'border-danger focus:border-danger focus:ring-danger/15', className)} {...props} />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className, id, ...props }: TextareaProps) {
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={id} className="label-text block">{label}</label>}
      <textarea id={id} className={cn('input-field resize-none', className)} {...props} />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: ReactNode;
}

export function Select({ label, error, className, id, children, ...props }: SelectProps) {
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={id} className="label-text block">{label}</label>}
      <select id={id} className={cn('input-field appearance-none cursor-pointer', className)} {...props}>
        {children}
      </select>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
