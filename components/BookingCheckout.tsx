'use client';

import { useState } from 'react';

const PROVIDER_LABEL: Record<string, string> = { stripe: 'Betal med kort', vipps: 'Betal med Vipps' };

export function BookingCheckout({
  bookingRequestId,
  providers,
  token,
}: {
  bookingRequestId: number;
  providers: ('stripe' | 'vipps')[];
  token?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay(provider: 'stripe' | 'vipps') {
    setBusy(provider);
    setError(null);
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingRequestId, provider, ...(token ? { token } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setError(data.error || 'Kunne ikke starte betaling. Prøv igjen.');
        setBusy(null);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError('Kunne ikke starte betaling. Prøv igjen.');
      setBusy(null);
    }
  }

  if (providers.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {providers.map((p) => (
          <button
            key={p}
            onClick={() => pay(p)}
            disabled={busy !== null}
            className="bg-bjerke-blue text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy === p ? 'Starter …' : PROVIDER_LABEL[p]}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
