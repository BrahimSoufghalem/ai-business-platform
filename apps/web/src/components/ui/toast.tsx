'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../icons';

interface ToastItem {
  id: number;
  kind: 'default' | 'success' | 'error';
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastItem['kind']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, kind: ToastItem['kind'] = 'default') => {
    const id = nextId++;
    setItems((current) => [...current, { id, kind, message }]);
    setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast${item.kind === 'success' ? ' toast--success' : ''}${item.kind === 'error' ? ' toast--error' : ''}`}>
            <Icon
              name={item.kind === 'success' ? 'check-circle' : item.kind === 'error' ? 'alert-circle' : 'info'}
              size={18}
            />
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider.');
  return context;
}
