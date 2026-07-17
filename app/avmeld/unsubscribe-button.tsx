'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * Client-side confirm-and-post: the actual unsubscribe mutation only ever
 * happens from an explicit user click (a POST from this component), never
 * from the page's own GET render. This is what removes the prefetch-risk
 * (browsers/extensions speculatively GET-fetching links) — a GET here only
 * verifies the token and renders this button, it never mutates state.
 */
export function UnsubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setState('loading');
    try {
      const res = await fetch(`/api/avmeld/one-click?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      });
      if (!res.ok) {
        setState('error');
        return;
      }
      setState('done');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-8">
        <h2 className="text-xl font-bold text-green-900 mb-2">Du er nå avmeldt</h2>
        <p className="text-green-800 mb-4">
          Du har blitt fjernet fra markedsføringslisten og mottar ikke lenger e-postmeldinger fra oss.
        </p>
        <p className="text-green-800 mb-6">
          Du kan når som helst kontakte oss hvis du ønsker å melde deg på igjen.
        </p>
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-bjerke-blue text-white rounded-lg font-medium hover:opacity-90"
        >
          Gå til forsiden
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-2">Meld deg av markedsføring</h2>
      <p className="text-gray-700 mb-6">
        Bekreft under for å melde deg av e-postmeldinger fra Bjerke Travbane. Dette påvirker ikke
        e-post knyttet til påmeldinger du allerede har gjort.
      </p>
      <form onSubmit={handleSubmit}>
        <button
          type="submit"
          disabled={state === 'loading'}
          className="inline-block px-4 py-2 bg-bjerke-blue text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-60"
        >
          {state === 'loading' ? 'Melder deg av …' : 'Meld meg av'}
        </button>
        {state === 'error' && (
          <p className="text-red-700 text-sm mt-4">
            Noe gikk galt. Prøv igjen, eller kontakt oss direkte.
          </p>
        )}
      </form>
    </div>
  );
}
