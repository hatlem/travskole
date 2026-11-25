"use client";

import { useEffect, useRef, useState } from "react";
import { FeedbackForm } from "@/components/FeedbackForm";

/**
 * `inline` brukes i admin-toppfeltet, der en flytende knapp ville dekket lagre-linjer.
 * Vinduet er en native <dialog> i top layer: toppfeltet har backdrop-blur, som ellers
 * gjør `position: fixed` relativ til feltet og klemmer vinduet inn i en 56 px stripe.
 */
export function FeedbackWidget({
  variant = 'floating',
  hideOnMobile = false,
}: {
  variant?: 'floating' | 'inline';
  /** Skjul den flytende boblen under md (skjemaer, Min side) — lenken i footeren finnes fortsatt. */
  hideOnMobile?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [pageUrl, setPageUrl] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal fokuserer første knapp (Lukk); brukeren skal kunne begynne å skrive med en gang.
      dialog.querySelector('textarea')?.focus();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  const openDialog = () => {
    setPageUrl(window.location.href);
    setSent(false);
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        title="Gi tilbakemelding"
        aria-label="Gi tilbakemelding"
        aria-haspopup="dialog"
        className={
          variant === 'inline'
            ? 'ml-auto flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            : `fixed bottom-4 right-4 z-40 h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white shadow-lg transition-colors hover:bg-gray-50 ${hideOnMobile ? 'hidden md:flex' : 'flex'}`
        }
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </svg>
        {variant === 'inline' && <span className="hidden sm:inline">Tilbakemelding</span>}
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Gi tilbakemelding"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-[425px] overflow-visible rounded-xl bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/50"
      >
        <div className="relative p-6">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Lukk"
            className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>

          {/* Monteres bare når vinduet er åpent, så autofokus treffer tekstfeltet og skjemaet starter blankt. */}
          {open && (sent ? (
            <div role="status" className="pr-8">
              <h2 className="text-lg font-semibold">Takk for tilbakemeldingen!</h2>
              <p className="mt-2 text-sm text-gray-600">Vi har fått den og ser på den så snart vi kan.</p>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg bg-[var(--bjerke-blue)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--bjerke-blue-dark)]"
                >
                  Lukk
                </button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="mb-3 pr-8 text-lg font-semibold">Gi tilbakemelding</h2>
              <FeedbackForm onSuccess={() => setSent(true)} initialPageUrl={pageUrl} />
            </>
          ))}
        </div>
      </dialog>
    </>
  );
}
