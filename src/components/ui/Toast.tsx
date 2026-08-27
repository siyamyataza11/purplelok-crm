import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'info';
interface Toast { id: string; type: ToastType; message: string; }

const ToastContext = createContext<{ add: (type: ToastType, message: string) => void } | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const remove = (id: string) => setToasts((t) => t.filter((x) => x.id !== id));

  return (
    <ToastContext.Provider value={{ add }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 w-80">
        {toasts.map((t) => (
          <div key={t.id} className={cn('bg-surface rounded-xl px-4 py-3 flex items-start gap-3 animate-slide-in-right shadow-lg border border-line')}>
            {t.type === 'success' && <CheckCircle2 size={18} className="text-green-600 shrink-0 mt-0.5" />}
            {t.type === 'error' && <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />}
            {t.type === 'info' && <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />}
            <p className="text-sm text-primary flex-1">{t.message}</p>
            <button onClick={() => remove(t.id)} className="text-tertiary hover:text-primary"><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
