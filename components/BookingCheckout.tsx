'use client';

import { useState } from 'react';
import { payButtonLabel } from '@/lib/buyer-display';

export function BookingCheckout({
  bookingRequestId,
  providers,
  token,
  amountKr,
}: {
  bookingRequestId: number;
  providers: ('stripe' | 'vipps')[];
  token?: string;
  amountKr?: number | null;
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
            className={`min-h-11 rounded-lg px-5 font-semibold text-white transition-colors disabled:opacity-50 ${
              p === 'vipps' ? 'bg-[#ff5b24] hover:bg-[#e64d1a]' : 'bg-bjerke-blue hover:bg-bjerke-blue-dark'
            }`}
          >
            {busy === p ? 'Starter …' : payButtonLabel(p, amountKr)}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
