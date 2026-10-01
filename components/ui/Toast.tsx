'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Kortvarig bekreftelse («Barnet er lagret»). Forsvinner etter 5 s, kan lukkes. */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(null), 5000);
  }, []);
  const dismiss = useCallback(() => setMessage(null), []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { message, show, dismiss };
}

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      {message && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-gray-900 py-2 pl-4 pr-1 text-sm text-white shadow-lg">
          <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>{message}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Lukk melding"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
