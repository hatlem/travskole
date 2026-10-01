'use client';

import { useEffect, useId, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Konsekvensen, sagt rett ut (refusjon, venteliste osv.). */
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Tilgjengelig bekreftelse for kjøpersidene, bygget på native <dialog>:
 * fokusfelle, Esc og inert bakgrunn kommer fra nettleseren. «Behold» har fokus
 * først, så et bom-trykk aldri avbestiller noe.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  busy = false,
  busyLabel,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/50"
    >
      <div className="p-6">
        <h2 id={titleId} className="text-xl font-semibold text-balance">
          {title}
        </h2>
        <p id={messageId} className="mt-3 text-gray-700 text-pretty">
          {message}
        </p>
        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-lg border border-gray-300 px-5 font-semibold text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="min-h-11 rounded-lg bg-red-700 px-5 font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-60"
          >
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
