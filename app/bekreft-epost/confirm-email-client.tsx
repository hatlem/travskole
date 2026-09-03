'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

type State = 'idle' | 'saving' | 'done' | 'error';

/**
 * Bekreftelsessiden for e-postbytte.
 *
 * Knappen — ikke sidelastingen — utløser byttet. En GET som endrer noe kan
 * løses inn av e-postskannere og forhåndslastende nettlesere; samme grunn som
 * at /avmeld gjør det slik.
 */
export default function ConfirmEmailClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  async function confirm() {
    setState('saving');
    try {
      const res = await fetch('/api/auth/confirm-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error || 'Kunne ikke bekrefte adressen');
        setState('error');
        return;
      }
      setEmail(data.email ?? null);
      setState('done');
    } catch {
      setMessage('Noe gikk galt. Prøv igjen.');
      setState('error');
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm border border-gray-200 rounded-lg sm:px-10 text-center">
          {!token ? (
            <>
              <h1 className="text-lg font-semibold text-gray-900 mb-2">Ugyldig lenke</h1>
              <p className="text-gray-600 text-sm mb-4">
                Lenken mangler informasjon. Be om en ny fra profilen din.
              </p>
              <Link href="/dashboard" className="text-sm text-bjerke-blue hover:underline font-medium">
                Til min side
              </Link>
            </>
          ) : state === 'done' ? (
            <>
              <h1 className="text-lg font-semibold text-gray-900 mb-2">E-postadressen er byttet</h1>
              <p className="text-gray-600 text-sm mb-4">
                {email ? `Du logger nå inn med ${email}.` : 'Du logger nå inn med den nye adressen.'}{' '}
                Logg inn på nytt for å fortsette.
              </p>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="w-full rounded-lg bg-bjerke-blue px-4 py-2.5 text-sm font-medium text-white hover:bg-bjerke-blue-dark"
              >
                Logg inn på nytt
              </button>
            </>
          ) : state === 'error' ? (
            <>
              <h1 className="text-lg font-semibold text-red-700 mb-2">Kunne ikke bekrefte</h1>
              <p className="text-gray-600 text-sm mb-4">{message}</p>
              <Link href="/dashboard" className="text-sm text-bjerke-blue hover:underline font-medium">
                Til min side
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-gray-900 mb-2">Bekreft ny e-postadresse</h1>
              <p className="text-gray-600 text-sm mb-6">
                Trykk under for å ta i bruk denne adressen som innlogging.
              </p>
              <button
                onClick={confirm}
                disabled={state === 'saving'}
                className="w-full rounded-lg bg-bjerke-blue px-4 py-2.5 text-sm font-medium text-white hover:bg-bjerke-blue-dark disabled:opacity-50"
              >
                {state === 'saving' ? 'Bekrefter …' : 'Bekreft e-postadressen'}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
