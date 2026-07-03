"use client";

import { useState } from "react";
import { FeedbackForm } from "@/components/FeedbackForm";

export function FeedbackWidget() {
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
        className="fixed bottom-4 right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white shadow-lg transition-colors hover:bg-gray-50"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </svg>
      </button>

      {/* Modal backdrop + dialog */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => handleOpen(false)} />
          <div className="relative mx-4 w-full max-w-[425px] rounded-xl bg-white p-6 shadow-xl">
            {/* Close button */}
            <button
              onClick={() => handleOpen(false)}
              className="absolute right-3 top-3 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
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
