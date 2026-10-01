'use client';

import { useId, useState } from 'react';

interface LoginLinkOfferProps {
  /** Forhåndsutfylt adresse (fra kvitteringen); kan endres. */
  email?: string;
  label?: string;
  /** Kort forklaring over knappen. */
  hint?: string;
}

/**
 * «Få innloggingslenke på e-post» for anonyme kjøpere — i stedet for å sende
 * dem til en innloggingsmur. Endepunktet svarer alltid likt (ingen kontoavsløring).
 */
export function LoginLinkOffer({ email = '', label = 'Få innloggingslenke på e-post', hint }: LoginLinkOfferProps) {
  const inputId = useId();
  const [value, setValue] = useState(email);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const address = value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Skriv inn e-postadressen du brukte ved påmeldingen');
      return;
    }
    setError(null);
    setState('sending');
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Kunne ikke sende lenken. Prøv igjen om litt.');
        setState('idle');
        return;
      }
      setState('sent');
    } catch {
      setError('Kunne ikke sende lenken. Sjekk nettforbindelsen og prøv igjen.');
      setState('idle');
    }
  }

  if (state === 'sent') {
    return (
      <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-900">
        <p className="font-semibold">Sjekk e-posten din</p>
        <p className="mt-1 text-sm text-pretty">
          Hvis <strong>{value.trim()}</strong> er registrert hos oss, har vi sendt en innloggingslenke dit. Finner du den
          ikke, sjekk søppelpost-mappen.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={send} noValidate className="space-y-3">
      {hint && <p className="text-sm text-gray-700 text-pretty">{hint}</p>}
      <div>
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-700">
          E-post
        </label>
        <input
          id={inputId}
          type="email"
          autoComplete="email"
          inputMode="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="min-h-11 w-full rounded-lg border border-gray-300 px-4 text-base focus:border-transparent focus:ring-2 focus:ring-bjerke-blue"
        />
        {error && (
          <p id={`${inputId}-error`} role="alert" className="mt-1 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={state === 'sending'}
        className="min-h-11 w-full rounded-lg border-2 border-bjerke-blue px-5 font-semibold text-bjerke-blue transition-colors hover:bg-blue-50 disabled:opacity-60 sm:w-auto"
      >
        {state === 'sending' ? 'Sender…' : label}
      </button>
    </form>
  );
}
