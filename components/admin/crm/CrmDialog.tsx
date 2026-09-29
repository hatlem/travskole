'use client';

import { useEffect, useId } from 'react';

interface CrmDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Blokkerer lukking (Escape/klikk utenfor) mens noe lagres. */
  busy?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

export function CrmDialog({ open, title, onClose, busy = false, children, footer, maxWidth = 'max-w-lg' }: CrmDialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="fixed inset-0 bg-black/50 pointer-events-none" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${maxWidth} max-h-[90vh] flex flex-col rounded-lg bg-white shadow-xl`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            aria-label="Lukk"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="text-sm">
      <label htmlFor={htmlFor} className="block text-gray-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
