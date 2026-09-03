'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * «Trekk forespørselen» på /mine-bookinger.
 *
 * Serveren avgjør om det er lov (se lib/registrations/cancel-rules) — knappen
 * vises bare når den allerede har sagt ja, og feilmeldingen derfra er den
 * brukeren ser hvis noe har endret seg i mellomtiden.
 */
export function BookingCancel({ bookingRequestId }: { bookingRequestId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm('Trekke denne bookingforespørselen?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/bookings/${bookingRequestId}/cancel`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Kunne ikke avbestille');
        return;
      }
      router.refresh();
    } catch {
      setError('Noe gikk galt. Prøv igjen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={cancel}
        disabled={busy}
        className="text-xs font-medium text-gray-600 hover:text-red-600 hover:underline disabled:opacity-50"
      >
        {busy ? 'Avbestiller …' : 'Trekk forespørselen'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
