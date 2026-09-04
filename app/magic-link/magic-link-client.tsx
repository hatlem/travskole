'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function MagicLinkClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    // Kjør kun én gang — tokenet er engangsbruk.
    if (attempted.current) return;
    attempted.current = true;

    const email = searchParams.get('email');
    const token = searchParams.get('token');

    if (!email || !token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- innlogging med engangstoken må skje etter montering
      setError('Ugyldig innloggingslenke.');
      return;
    }

    (async () => {
      try {
        const result = await signIn('magic-link', { email, token, redirect: false });
        if (result?.ok) {
          const sessionRes = await fetch('/api/auth/session');
          const session = await sessionRes.json();
          const isAdmin =
            session?.user?.role === 'admin' || session?.user?.role === 'superadmin';
          router.push(isAdmin ? '/admin' : '/dashboard');
          router.refresh();
        } else {
          setError('Innloggingslenken er ugyldig eller utløpt. Be om en ny.');
        }
      } catch {
        setError('Noe gikk galt. Prøv igjen.');
      }
    })();
  }, [searchParams, router]);

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm border border-gray-200 rounded-lg sm:px-10 text-center">
          {error ? (
            <>
              <div className="text-red-700 text-lg font-semibold mb-2">
                Kunne ikke logge inn
              </div>
              <p className="text-gray-600 text-sm mb-4">{error}</p>
              <Link href="/login" className="text-sm text-bjerke-blue hover:underline font-medium">
                Tilbake til innlogging
              </Link>
            </>
          ) : (
            <>
              <div
                className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-bjerke-blue"
                role="status"
                aria-label="Logger inn"
              />
              <p className="text-gray-600 text-sm">Logger deg inn …</p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
