import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
}

const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

export function Modal({ open, onClose, title, description, children, size = 'md', footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', handler); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('relative w-full bg-surface rounded-xl shadow-xl border border-line animate-scale-in max-h-[90vh] flex flex-col', sizes[size])}>
        {(title || description) && (
          <div className="px-6 py-5 border-b border-line">
            {title && <h2 className="text-lg font-semibold text-primary">{title}</h2>}
            {description && <p className="text-sm text-secondary mt-1">{description}</p>}
          </div>
        )}
        <div className="overflow-y-auto px-6 py-5 flex-1">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-line flex justify-end gap-3">{footer}</div>}
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg text-tertiary hover:text-primary hover:bg-muted transition-colors">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
