'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';

const registerSchema = z.object({
  name: z.string().min(2, 'Navnet må være minst 2 tegn'),
  email: z.string().email('Ugyldig e-postadresse'),
  phone: z.string().min(8, 'Telefonnummer må være minst 8 tegn'),
  password: z.string().min(6, 'Passordet må være minst 6 tegn'),
  confirmPassword: z.string(),
  address: z.string().optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passordene må være like',
  path: ['confirmPassword'],
});

type RegisterFormData = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          phone: data.phone,
          password: data.password,
          address: data.address,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || 'Noe gikk galt. Vennligst prøv igjen.');
        return;
      }

      // Registration successful, redirect to login
      router.push('/auth/login?registered=true');
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
          Opprett konto
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Eller{' '}
          <Link
            href="/auth/login"
            className="font-medium text-[#003B7A] hover:underline"
          >
            logg inn
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
                htmlFor="name"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Fullt navn
              </label>
              <input
                {...register('name')}
                id="name"
                type="text"
                autoComplete="name"
                className={`
                  w-full px-3 py-2 border rounded-lg shadow-sm
                  focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:ring-opacity-20
                  ${errors.name ? 'border-red-300' : 'border-gray-300'}
                `}
                placeholder="Ola Nordmann"
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.name.message}
                </p>
              )}
            </div>

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
                htmlFor="phone"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Telefon
              </label>
              <input
                {...register('phone')}
                id="phone"
                type="tel"
                autoComplete="tel"
                className={`
                  w-full px-3 py-2 border rounded-lg shadow-sm
                  focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:ring-opacity-20
                  ${errors.phone ? 'border-red-300' : 'border-gray-300'}
                `}
                placeholder="+47 123 45 678"
              />
              {errors.phone && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.phone.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="address"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Adresse (valgfritt)
              </label>
              <input
                {...register('address')}
                id="address"
                type="text"
                autoComplete="street-address"
                className="
                  w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm
                  focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:ring-opacity-20
                "
                placeholder="Gateveien 1, 0123 Oslo"
              />
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
                autoComplete="new-password"
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

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Bekreft passord
              </label>
              <input
                {...register('confirmPassword')}
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                className={`
                  w-full px-3 py-2 border rounded-lg shadow-sm
                  focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:ring-opacity-20
                  ${errors.confirmPassword ? 'border-red-300' : 'border-gray-300'}
                `}
                placeholder="Gjenta passord"
              />
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.confirmPassword.message}
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
              {isLoading ? 'Oppretter konto...' : 'Opprett konto'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
