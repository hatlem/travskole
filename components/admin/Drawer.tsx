'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useModalEscape } from './useModalEscape';
import { focusableWithin } from './focus-trap';

interface DrawerProps {
  open: boolean;
  title: string;
  /** Én linje under tittelen. */
  description?: ReactNode;
  /** Knapperaden nederst (holdes synlig mens innholdet scroller). */
  footer?: ReactNode;
  /** Mens noe lagres: Escape og klikk utenfor lukker ikke. */
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Skuff fra høyre (bunnark på mobil) for oppgaver med flere felt, f.eks. å bekrefte en forespørsel.
 * Fokus flyttes inn ved åpning, holdes i skuffen, og går tilbake til utløseren ved lukking.
 */
export function Drawer({ open, title, description, footer, busy = false, onClose, children }: DrawerProps) {
  useModalEscape(open, onClose, busy);
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel ? focusableWithin(panel).find((el) => el.dataset.drawerClose === undefined) : null;
    (first ?? panel)?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = focusableWithin(panelRef.current);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onClose()} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={trapTab}
        className="admin-drawer absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-2xl bg-white shadow-2xl focus:outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-full sm:max-w-lg sm:rounded-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-gray-900 text-balance">{title}</h2>
            {description && <p id={descriptionId} className="mt-0.5 text-sm text-gray-600">{description}</p>}
          </div>
          <button
            type="button"
            data-drawer-close
            onClick={onClose}
            disabled={busy}
            aria-label="Lukk"
            className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
