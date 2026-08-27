import { cn, initials } from '@/lib/utils';

interface AvatarProps {
  name?: string;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizes = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
};

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  if (src) {
    return <img src={src} alt={name ?? ''} className={cn('rounded-full object-cover', sizes[size], className)} />;
  }
  return (
    <div className={cn('rounded-full flex items-center justify-center font-semibold bg-purple-50 text-purple-700 shrink-0', sizes[size], className)}>
      {initials(name ?? '?')}
    </div>
  );
}
