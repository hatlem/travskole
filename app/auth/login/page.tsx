'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';

const loginSchema = z.object({
  email: z.string().email('Ugyldig e-postadresse'),
  password: z.string().min(6, 'Passordet må være minst 6 tegn'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
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
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err) {
      setError('Noe gikk galt. Vennligst prøv igjen.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="text-center text-3xl font-bold text-gray-900">
          Logg inn
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Eller{' '}
          <Link
            href="/auth/register"
            className="font-medium text-[#003B7A] hover:underline"
          >
            opprett en ny konto
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm border border-gray-200 rounded-lg sm:px-10">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                E-post
              </label>
              <input
                {...register('email')}
                id="email"
                type="email"
                autoComplete="email"
                className={`
                  w-full px-3 py-2 border rounded-lg shadow-sm
                  focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:ring-opacity-20
                  ${errors.email ? 'border-red-300' : 'border-gray-300'}
                `}
                placeholder="din@epost.no"
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.email.message}
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
                {...register('password')}
                id="password"
                type="password"
                autoComplete="current-password"
                className={`
                  w-full px-3 py-2 border rounded-lg shadow-sm
                  focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:ring-opacity-20
                  ${errors.password ? 'border-red-300' : 'border-gray-300'}
                `}
                placeholder="Minst 6 tegn"
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.password.message}
                </p>
              )}
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
              {isLoading ? 'Logger inn...' : 'Logg inn'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
