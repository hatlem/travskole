'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const email = searchParams.get('email');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!token || !email) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow-sm border border-gray-200 rounded-lg sm:px-10 text-center">
            <p className="text-red-600 font-semibold mb-4">Ugyldig lenke</p>
            <p className="text-gray-600 text-sm mb-6">
              Denne lenken er ugyldig eller har utløpt. Be om en ny tilbakestillingslenke.
            </p>
            <Link
              href="/auth/forgot-password"
              className="text-sm text-[#003B7A] hover:underline"
            >
              Be om ny lenke
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Passordet må være minst 6 tegn');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passordene stemmer ikke overens');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Noe gikk galt');
        return;
      }

      setSuccess(true);
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
          Nytt passord
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Velg et nytt passord for kontoen din.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm border border-gray-200 rounded-lg sm:px-10">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {success ? (
            <div className="text-center py-4">
              <div className="text-green-600 text-lg font-semibold mb-2">
                Passordet er oppdatert
              </div>
              <p className="text-gray-600 text-sm mb-6">
                Du kan nå logge inn med det nye passordet ditt.
              </p>
              <Link
                href="/auth/login"
                className="
                  inline-block bg-[#003B7A] hover:bg-[#002855]
                  text-white font-semibold py-3 px-6 rounded-lg
                  transition duration-200
                  focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:ring-offset-2
                "
              >
                Gå til innlogging
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Nytt passord
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="
                    w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm
                    focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:ring-opacity-20
                  "
                  placeholder="Minst 6 tegn"
                />
              </div>

              <div>
                <label
                  htmlFor="confirm-password"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Bekreft passord
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="
                    w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm
                    focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:ring-opacity-20
                  "
                  placeholder="Gjenta passordet"
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
                {isLoading ? 'Oppdaterer...' : 'Oppdater passord'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
