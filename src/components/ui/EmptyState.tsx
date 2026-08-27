import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      {icon && <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-tertiary mb-4">{icon}</div>}
      <h3 className="text-sm font-semibold text-primary mb-1">{title}</h3>
      {description && <p className="text-sm text-secondary max-w-sm mb-4">{description}</p>}
      {action}
    </div>
  );
}
