'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface ToastOptions {
  /** Millisekunder før den forsvinner. `null` = blir stående til den lukkes. Standard: 6 s, feil blir stående. */
  duration?: number | null;
  /** Lenke/knapp i toasten, f.eks. «Se på nettsiden». */
  action?: ToastAction;
}

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
  exiting: boolean;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
};

export const TOAST_DEFAULT_DURATION_MS = 6000;

/** Feil blir stående til de lukkes; alt annet forsvinner av seg selv. */
export function toastDuration(type: ToastType, options?: ToastOptions): number | null {
  if (options && options.duration !== undefined) return options.duration;
  return type === 'error' ? null : TOAST_DEFAULT_DURATION_MS;
}

const STYLES: Record<ToastType, { box: string; icon: string; label: string }> = {
  success: { box: 'border-green-600 bg-white text-gray-900', icon: 'text-green-700', label: 'Fullført' },
  error: { box: 'border-red-600 bg-red-50 text-red-900', icon: 'text-red-700', label: 'Feil' },
  info: { box: 'border-bjerke-blue bg-white text-gray-900', icon: 'text-bjerke-blue', label: 'Info' },
};

function ToastIcon({ type }: { type: ToastType }) {
  const d =
    type === 'success'
      ? 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'
      : type === 'error'
        ? 'M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z'
        : 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z';
  return (
    <svg className={`mt-0.5 h-5 w-5 shrink-0 ${STYLES[type].icon}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

/**
 * Toaster øverst til høyre (under topplinja), så de aldri havner bak cookie-merket nede i hjørnet.
 * Skjermlesere får meldingen via faste live-regioner: feil «assertive», resten «polite».
 */
export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [announcement, setAnnouncement] = useState({ polite: '', assertive: '' });
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const announceCount = useRef(0);

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 150);
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info', options?: ToastOptions) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, message, type, action: options?.action, exiting: false }]);
      // Usynlig variasjon gjør at samme melding to ganger på rad også leses opp.
      const text = message + (announceCount.current++ % 2 ? '\u200b' : '');
      setAnnouncement(type === 'error' ? { polite: '', assertive: text } : { polite: text, assertive: '' });
      const duration = toastDuration(type, options);
      if (duration !== null) timersRef.current.set(id, setTimeout(() => removeToast(id), duration));
    },
    [removeToast],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement.polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{announcement.assertive}</div>
      <div
        aria-label="Varsler"
        role="region"
        className="pointer-events-none fixed right-4 top-[4.5rem] z-[9999] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((t) => {
          const style = STYLES[t.type];
          return (
            <div
              key={t.id}
              className={`admin-toast pointer-events-auto flex items-start gap-3 rounded-lg border-l-4 px-4 py-3 text-sm shadow-lg ring-1 ring-black/5 ${style.box} ${
                t.exiting ? 'admin-toast-exit' : ''
              }`}
            >
              <ToastIcon type={t.type} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-pretty">
                  <span className="sr-only">{style.label}: </span>
                  {t.message}
                </p>
                {t.action &&
                  (t.action.href ? (
                    <Link
                      href={t.action.href}
                      onClick={() => removeToast(t.id)}
                      className="mt-1 inline-block rounded-sm font-semibold text-bjerke-blue underline underline-offset-2 hover:text-bjerke-blue-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue"
                    >
                      {t.action.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        t.action?.onClick?.();
                        removeToast(t.id);
                      }}
                      className="mt-1 rounded-sm font-semibold text-bjerke-blue underline underline-offset-2 hover:text-bjerke-blue-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue"
                    >
                      {t.action.label}
                    </button>
                  ))}
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                aria-label="Lukk varselet"
                className="-mr-2 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-current opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};
