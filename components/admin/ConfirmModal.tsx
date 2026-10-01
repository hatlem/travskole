'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useModalEscape } from './useModalEscape';
import { buttonClass, Spinner } from './Button';
import { focusableWithin } from './focus-trap';

type Variant = 'danger' | 'warning' | 'info';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = rød bekreft-knapp (sletting o.l.). warning/info = marineblå. */
  variant?: Variant;
  loading?: boolean;
  /** Ekstra innhold under meldingen, f.eks. forhåndsvisning av en e-post. */
  children?: ReactNode;
  /** «lg» gir plass til forhåndsvisninger. */
  size?: 'md' | 'lg';
  onConfirm: () => void;
  onCancel: () => void;
}

const variantConfig: Record<
  Variant,
  {
    iconBg: string;
    iconColor: string;
    button: 'danger' | 'primary';
  }
> = {
  danger: { iconBg: 'bg-red-100', iconColor: 'text-red-600', button: 'danger' },
  warning: { iconBg: 'bg-amber-100', iconColor: 'text-amber-700', button: 'primary' },
  info: { iconBg: 'bg-bjerke-blue/10', iconColor: 'text-bjerke-blue', button: 'primary' },
};

function VariantIcon({ variant }: { variant: Variant }) {
  if (variant === 'danger') {
    return (
      <svg
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
        />
      </svg>
    );
  }
  if (variant === 'warning') {
    return (
      <svg
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
    );
  }
  return (
    <svg
      className="h-6 w-6"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
      />
    </svg>
  );
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Bekreft',
  cancelLabel = 'Avbryt',
  variant = 'danger',
  loading = false,
  children,
  size = 'md',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useModalEscape(open, onCancel, loading);
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Fokus inn i dialogen (Avbryt = trygt standardvalg) og tilbake til utløseren ved lukking.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const buttons = dialogRef.current ? focusableWithin(dialogRef.current) : [];
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const config = variantConfig[variant];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 transition-opacity" />

      {/* Modal */}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={trapTab}
        className={`relative max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-xl bg-white p-6 shadow-xl ${size === 'lg' ? 'max-w-2xl' : 'max-w-md'}`}
      >
        {/* Icon */}
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <div className={`flex h-12 w-12 items-center justify-center rounded-full ${config.iconBg} ${config.iconColor}`}>
            <VariantIcon variant={variant} />
          </div>
        </div>

        {/* Content */}
        <div className="text-center">
          <h3 id={titleId} className="text-lg font-semibold text-gray-900 text-balance">{title}</h3>
          <div id={messageId} className="mt-2 text-sm text-gray-600 text-pretty">{message}</div>
        </div>
        {children && <div className="mt-4">{children}</div>}

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          <button
            ref={cancelRef}
            type="button"
            disabled={loading}
            onClick={onCancel}
            className={buttonClass('secondary', 'md', 'flex-1')}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            aria-busy={loading || undefined}
            onClick={onConfirm}
            className={buttonClass(config.button, 'md', 'flex-1')}
          >
            {loading ? (
              <>
                <Spinner />
                Venter …
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
