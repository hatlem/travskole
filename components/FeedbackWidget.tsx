"use client";

import { useState } from "react";
import { FeedbackForm } from "@/components/FeedbackForm";

/** `inline` brukes i admin-toppfeltet, der en flytende knapp ville dekket lagre-linjer. */
export function FeedbackWidget({
  variant = 'floating',
  hideOnMobile = false,
}: {
  variant?: 'floating' | 'inline';
  /** Skjul den flytende boblen under md (skjemaer, Min side) — lenken i footeren finnes fortsatt. */
  hideOnMobile?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
  };

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => handleOpen(true)}
        title="Gi tilbakemelding"
        aria-label="Gi tilbakemelding"
        className={
          variant === 'inline'
            ? 'ml-auto flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            : `fixed bottom-4 right-4 z-40 h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white shadow-lg transition-colors hover:bg-gray-50 ${hideOnMobile ? 'hidden md:flex' : 'flex'}`
        }
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </svg>
        {variant === 'inline' && <span className="hidden sm:inline">Tilbakemelding</span>}
      </button>

      {/* Modal backdrop + dialog */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => handleOpen(false)} />
          <div className="relative mx-4 w-full max-w-[425px] rounded-xl bg-white p-6 shadow-xl">
            {/* Close button */}
            <button
              onClick={() => handleOpen(false)}
              aria-label="Lukk"
              className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>

            <h2 className="sr-only">Gi tilbakemelding</h2>

            <FeedbackForm
              onSuccess={() => handleOpen(false)}
              initialPageUrl={typeof window !== "undefined" ? window.location.href : ""}
            />
          </div>
        </div>
      )}
    </>
  );
}
