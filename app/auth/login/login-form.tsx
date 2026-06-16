'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useStrings } from '@/components/SettingsProvider';

const loginSchema = z.object({
  email: z.string().email('Ugyldig e-postadresse'),
  password: z.string().min(1, 'Passord er påkrevd'),
});

const magicLinkSchema = z.object({
  email: z.string().email('Ugyldig e-postadresse'),
});

type LoginFormData = z.infer<typeof loginSchema>;
type MagicLinkFormData = z.infer<typeof magicLinkSchema>;

const errorMessages: Record<string, string> = {
  Configuration: 'Det er en feil med serverens autentiseringskonfigurasjon. Kontakt administrator.',
  AccessDenied: 'Tilgang nektet.',
  Verification: 'Lenken har utløpt eller er allerede brukt. Prøv igjen.',
  Default: 'Noe gikk galt med innloggingen.',
};

export default function LoginForm() {
  const t = useStrings();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get('error');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [activeTab, setActiveTab] = useState<'password' | 'magic'>('magic');

  const passwordForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const magicForm = useForm<MagicLinkFormData>({
    resolver: zodResolver(magicLinkSchema),
  });

  const onPasswordSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        setError('Feil e-post eller passord');
      } else if (result?.ok) {
        // Check if user is admin and redirect accordingly
        const sessionRes = await fetch('/api/auth/session');
        const session = await sessionRes.json();
        const isAdmin = session?.user?.role === 'admin' || session?.user?.role === 'superadmin';
        router.push(isAdmin ? '/admin' : '/dashboard');
        router.refresh();
      }
    } catch {
      setError('Noe gikk galt. Vennligst prøv igjen.');
    } finally {
      setIsLoading(false);
    }
  };

  const onMagicLinkSubmit = async (data: MagicLinkFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await signIn('email', {
        email: data.email,
        redirect: false,
      });

      if (result?.error) {
        setError('Kunne ikke sende innloggingslenke. Prøv igjen.');
      } else {
        setMagicLinkSent(true);
      }
    } catch {
      setError('Noe gikk galt. Vennligst prøv igjen.');
    } finally {
      setIsLoading(false);
    }
  };

  const displayError = error || (urlError ? (errorMessages[urlError] || errorMessages.Default) : null);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="text-center text-3xl font-bold text-gray-900">
          {t('auth.login_button')}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Eller{' '}
          <Link
            href="/auth/register"
            className="font-medium text-bjerke-blue hover:underline"
          >
            opprett en ny konto
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm border border-gray-200 rounded-lg sm:px-10">
          {displayError && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {displayError}
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b border-gray-200 mb-6">
            <button
              type="button"
              onClick={() => setActiveTab('magic')}
              className={`flex-1 pb-3 text-sm font-medium border-b-2 transition ${
                activeTab === 'magic'
                  ? 'border-bjerke-blue text-bjerke-blue'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Magic Link
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('password')}
              className={`flex-1 pb-3 text-sm font-medium border-b-2 transition ${
                activeTab === 'password'
                  ? 'border-bjerke-blue text-bjerke-blue'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              E-post & Passord
            </button>
          </div>

          {/* Magic Link Tab */}
          {activeTab === 'magic' && (
            magicLinkSent ? (
              <div className="text-center py-4">
                <div className="text-green-600 text-lg font-semibold mb-2">
                  Sjekk e-posten din
                </div>
                <p className="text-gray-600 text-sm">
                  Vi har sendt en innloggingslenke til e-postadressen din. Klikk på lenken for å logge inn.
                </p>
                <button
                  type="button"
                  onClick={() => setMagicLinkSent(false)}
                  className="mt-4 text-sm text-bjerke-blue hover:underline"
                >
                  Send på nytt
                </button>
              </div>
            ) : (
              <form onSubmit={magicForm.handleSubmit(onMagicLinkSubmit)} className="space-y-6">
                <div>
                  <label
                    htmlFor="magic-email"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    E-post
                  </label>
                  <input
                    {...magicForm.register('email')}
                    id="magic-email"
                    type="email"
                    autoComplete="email"
                    className={`
                      w-full px-3 py-2 border rounded-lg shadow-sm
                      focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:ring-opacity-20
                      ${magicForm.formState.errors.email ? 'border-red-300' : 'border-gray-300'}
                    `}
                    placeholder="din@epost.no"
                  />
                  {magicForm.formState.errors.email && (
                    <p className="mt-1 text-sm text-red-600">
                      {magicForm.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="
                    w-full bg-bjerke-blue hover:bg-bjerke-blue-dark
                    text-white font-semibold py-3 px-4 rounded-lg
                    transition duration-200
                    disabled:opacity-50 disabled:cursor-not-allowed
                    focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:ring-offset-2
                  "
                >
                  {isLoading ? t('auth.sending') : t('auth.send_magic_link')}
                </button>
              </form>
            )
          )}

          {/* Password Tab */}
          {activeTab === 'password' && (
            <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-6">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  E-post
                </label>
                <input
                  {...passwordForm.register('email')}
                  id="email"
                  type="email"
                  autoComplete="email"
                  className={`
                    w-full px-3 py-2 border rounded-lg shadow-sm
                    focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:ring-opacity-20
                    ${passwordForm.formState.errors.email ? 'border-red-300' : 'border-gray-300'}
                  `}
                  placeholder="din@epost.no"
                />
                {passwordForm.formState.errors.email && (
                  <p className="mt-1 text-sm text-red-600">
                    {passwordForm.formState.errors.email.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Passord
                </label>
                <input
                  {...passwordForm.register('password')}
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className={`
                    w-full px-3 py-2 border rounded-lg shadow-sm
                    focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:ring-opacity-20
                    ${passwordForm.formState.errors.password ? 'border-red-300' : 'border-gray-300'}
                  `}
                  placeholder="Ditt passord"
                />
                {passwordForm.formState.errors.password && (
                  <p className="mt-1 text-sm text-red-600">
                    {passwordForm.formState.errors.password.message}
                  </p>
                )}
                <div className="mt-1 text-right">
                  <Link href="/auth/forgot-password" className="text-sm text-bjerke-blue hover:underline">
                    Glemt passord?
                  </Link>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="
                  w-full bg-bjerke-blue hover:bg-bjerke-blue-dark
                  text-white font-semibold py-3 px-4 rounded-lg
                  transition duration-200
                  disabled:opacity-50 disabled:cursor-not-allowed
                  focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:ring-offset-2
                "
              >
                {isLoading ? t('auth.logging_in') : t('auth.login_button')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
