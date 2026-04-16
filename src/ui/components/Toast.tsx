'use client';

/**
 * Toast — lightweight notification system.
 *
 * Usage (in a parent component):
 *
 *   const { toasts, addToast, removeToast } = useToast();
 *
 *   // Trigger a toast:
 *   addToast({ variant: 'success', message: 'Memo exported.' });
 *
 *   // Render the portal:
 *   <ToastContainer toasts={toasts} onDismiss={removeToast} />
 *
 * Toasts auto-dismiss after `durationMs` (default 4 000 ms).
 * Screen-reader accessible via role="status" / role="alert".
 */

import { useState, useCallback, useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
  durationMs?: number;
}

export interface ToastOptions {
  variant: ToastVariant;
  message: string;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// useToast hook
// ---------------------------------------------------------------------------

let _idCounter = 0;

function newId(): string {
  _idCounter += 1;
  return `toast-${_idCounter.toString()}`;
}

export function useToast(): {
  toasts: Toast[];
  addToast: (options: ToastOptions) => string;
  removeToast: (id: string) => void;
} {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((options: ToastOptions): string => {
    const id = newId();
    const toast: Toast = { id, durationMs: 4_000, ...options };
    setToasts((prev) => [...prev, toast]);
    return id;
  }, []);

  const removeToast = useCallback((id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}

// ---------------------------------------------------------------------------
// Individual Toast item
// ---------------------------------------------------------------------------

const VARIANT_STYLES: Record<
  ToastVariant,
  { bg: string; border: string; icon: string; role: 'status' | 'alert' }
> = {
  success: { bg: '#f0fdf4', border: '#86efac', icon: '✓', role: 'status' },
  error: { bg: '#fff5f5', border: '#fca5a5', icon: '✕', role: 'alert' },
  warning: { bg: '#fffbeb', border: '#fcd34d', icon: '!', role: 'alert' },
  info: { bg: '#eff6ff', border: '#93c5fd', icon: 'i', role: 'status' },
};

const ICON_COLOR: Record<ToastVariant, string> = {
  success: '#15803d',
  error: '#dc2626',
  warning: '#d97706',
  info: '#1d4ed8',
};

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps): React.ReactElement {
  const { bg, border, icon, role } = VARIANT_STYLES[toast.variant];
  const iconColor = ICON_COLOR[toast.variant];
  // Progress bar tracks remaining duration
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const duration = toast.durationMs ?? 4_000;
    timerRef.current = setTimeout(() => {
      setVisible(false);
      // Remove from list after CSS fade (200ms)
      setTimeout(() => {
        onDismiss(toast.id);
      }, 200);
    }, duration);

    return (): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.durationMs, onDismiss]);

  return (
    <div
      role={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      className="flex items-start gap-3 rounded-lg border px-4 py-3 shadow-md transition-all duration-200"
      style={{
        backgroundColor: bg,
        borderColor: border,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(0.5rem)',
        maxWidth: '24rem',
        fontFamily: 'var(--font-sans, sans-serif)',
      }}
    >
      <span
        className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold"
        style={{ backgroundColor: iconColor, color: 'white' }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="flex-1 text-sm" style={{ color: '#1f2937' }}>
        {toast.message}
      </p>
      <button
        onClick={(): void => {
          onDismiss(toast.id);
        }}
        className="flex-shrink-0 text-sm opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
        style={{ background: 'none', border: 'none', color: '#374151', lineHeight: 1 }}
        aria-label="Dismiss notification"
        type="button"
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToastContainer
// ---------------------------------------------------------------------------

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  /** Position on screen. Default: 'bottom-right'. */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center';
}

const POSITION_STYLES: Record<string, React.CSSProperties> = {
  'top-right': { top: '1rem', right: '1rem' },
  'top-left': { top: '1rem', left: '1rem' },
  'bottom-right': { bottom: '1rem', right: '1rem' },
  'bottom-left': { bottom: '1rem', left: '1rem' },
  'top-center': { top: '1rem', left: '50%', transform: 'translateX(-50%)' },
};

export function ToastContainer({
  toasts,
  onDismiss,
  position = 'bottom-right',
}: ToastContainerProps): React.ReactElement | null {
  if (toasts.length === 0) return null;

  const posStyle = POSITION_STYLES[position] ?? POSITION_STYLES['bottom-right'];

  return (
    <div
      aria-label="Notifications"
      className="fixed z-50 flex flex-col gap-2 pointer-events-none"
      style={posStyle}
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
