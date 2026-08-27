import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'purple' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple-soft';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
  dot?: boolean;
}

const variants: Record<BadgeVariant, string> = {
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
  success: 'bg-green-50 text-green-700 border-green-200',
  warning: 'bg-orange-50 text-orange-700 border-orange-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  neutral: 'bg-gray-100 text-secondary border-gray-200',
  'purple-soft': 'bg-purple-50 text-purple-600 border-purple-100',
};

const dotColors: Record<BadgeVariant, string> = {
  purple: 'bg-purple-600',
  success: 'bg-green-500',
  warning: 'bg-orange-500',
  danger: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-gray-400',
  'purple-soft': 'bg-purple-500',
};

export function Badge({ children, variant = 'neutral', className, dot }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border', variants[variant], className)}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dotColors[variant])} />}
      {children}
    </span>
  );
}
