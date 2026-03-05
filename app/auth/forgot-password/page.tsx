'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        throw new Error('Noe gikk galt');
      }

      setSubmitted(true);
    } catch {
      setError('Noe gikk galt. Vennligst prøv igjen.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="text-center text-3xl font-bold text-gray-900">
          Glemt passord?
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Skriv inn e-postadressen din, så sender vi deg en lenke for å tilbakestille passordet.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm border border-gray-200 rounded-lg sm:px-10">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {submitted ? (
            <div className="text-center py-4">
              <div className="text-green-600 text-lg font-semibold mb-2">
                Sjekk e-posten din
              </div>
              <p className="text-gray-600 text-sm">
                Hvis det finnes en konto med denne e-postadressen, har vi sendt en lenke for å tilbakestille passordet.
              </p>
              <Link
                href="/auth/login"
                className="mt-6 inline-block text-sm text-[#003B7A] hover:underline"
              >
                Tilbake til innlogging
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  E-post
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="
                    w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm
                    focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:ring-opacity-20
                  "
                  placeholder="din@epost.no"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="
                  w-full bg-[#003B7A] hover:bg-[#002855]
                  text-white font-semibold py-3 px-4 rounded-lg
                  transition duration-200
                  disabled:opacity-50 disabled:cursor-not-allowed
                  focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:ring-offset-2
                "
              >
                {isLoading ? 'Sender...' : 'Send tilbakestillingslenke'}
              </button>

              <div className="text-center">
                <Link
                  href="/auth/login"
                  className="text-sm text-[#003B7A] hover:underline"
                >
                  Tilbake til innlogging
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
