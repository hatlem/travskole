'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';

export const dynamic = 'force-dynamic';

interface DashboardData {
  profile: {
    name: string;
    email: string;
    phone: string;
    address: string | null;
  } | null;
  children: {
    id: number;
    name: string;
    birthdate: string | null;
    allergies: string | null;
  }[];
  registrations: {
    id: number;
    status: string;
    createdAt: string;
    courseName: string;
    courseType: string;
    courseStartDate: string;
    courseEndDate: string | null;
    childName: string;
  }[];
}

const statusLabels: Record<string, { label: string; className: string }> = {
  pending: { label: 'Venter', className: 'bg-yellow-100 text-yellow-800' },
  confirmed: { label: 'Bekreftet', className: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Avlyst', className: 'bg-red-100 text-red-800' },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('nb-NO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get('success');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((res) => {
        if (!res.ok) throw new Error('Kunne ikke laste dashboard');
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-16">
        <div className="max-w-4xl mx-auto px-4">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-200 rounded w-48" />
            <div className="h-40 bg-gray-200 rounded-lg" />
            <div className="h-40 bg-gray-200 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-16">
        <div className="max-w-4xl mx-auto px-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
            {error}
          </div>
        </div>
      </div>
    );
  }

  const noProfile = !data?.profile;

  return (
    <div className="min-h-screen bg-gray-50 py-16">
      <div className="max-w-4xl mx-auto px-4">
        {success === 'registration' && (
          <div className="bg-green-50 border-l-4 border-green-500 p-6 mb-8">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-lg font-semibold text-green-800">
                  Påmelding vellykket!
                </h3>
                <p className="mt-2 text-green-700">
                  Takk for påmeldingen! Du vil motta en bekreftelse på e-post snart.
                </p>
              </div>
            </div>
          </div>
        )}

        <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>

        {noProfile && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold text-blue-800 mb-2">Profil ikke funnet</h2>
            <p className="text-blue-700">
              Det ser ut som du ikke har fullført en påmelding ennå. Meld deg på et kurs for å opprette profilen din.
            </p>
            <Link
              href="/arrangementer"
              className="inline-block mt-4 bg-[#003B7A] text-white px-5 py-2 rounded-lg hover:bg-[#002855] transition"
            >
              Se alle kurs
            </Link>
          </div>
        )}

        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Mine påmeldinger</h2>
            {data && data.registrations.length > 0 ? (
              <div className="space-y-3">
                {data.registrations.map((r) => {
                  const badge = statusLabels[r.status] ?? statusLabels.pending;
                  return (
                    <div
                      key={r.id}
                      className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{r.courseName}</p>
                        <p className="text-sm text-gray-500">
                          {r.childName} &middot; {formatDate(r.courseStartDate)}
                          {r.courseEndDate && ` – ${formatDate(r.courseEndDate)}`}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-3 py-1 rounded-full whitespace-nowrap ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 text-gray-500">
                Ingen påmeldinger ennå.
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Mine barn</h2>
            {data && data.children.length > 0 ? (
              <div className="grid sm:grid-cols-2 gap-4">
                {data.children.map((c) => (
                  <div
                    key={c.id}
                    className="bg-white rounded-lg shadow-sm border border-gray-200 p-5"
                  >
                    <p className="font-medium text-gray-900">{c.name}</p>
                    {c.birthdate && (
                      <p className="text-sm text-gray-500 mt-1">
                        Født {formatDate(c.birthdate)}
                      </p>
                    )}
                    {c.allergies && (
                      <p className="text-sm text-gray-500 mt-1">
                        Allergier: {c.allergies}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 text-gray-500">
                Ingen barn registrert ennå.
              </div>
            )}
          </section>

          {data?.profile && (
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Profil</h2>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 space-y-2">
                <p className="text-gray-900">
                  <span className="text-sm text-gray-500">Navn:</span>{' '}
                  {data.profile.name}
                </p>
                <p className="text-gray-900">
                  <span className="text-sm text-gray-500">E-post:</span>{' '}
                  {data.profile.email}
                </p>
                <p className="text-gray-900">
                  <span className="text-sm text-gray-500">Telefon:</span>{' '}
                  {data.profile.phone}
                </p>
                {data.profile.address && (
                  <p className="text-gray-900">
                    <span className="text-sm text-gray-500">Adresse:</span>{' '}
                    {data.profile.address}
                  </p>
                )}
              </div>
            </section>
          )}

          <Link
            href="/arrangementer"
            className="block bg-[#003B7A] text-white rounded-lg p-6 hover:bg-[#002855] transition"
          >
            <h3 className="text-xl font-semibold mb-2">Se alle kurs</h3>
            <p className="text-blue-100">Utforsk våre kurs og leirer</p>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 py-16">
          <div className="max-w-4xl mx-auto px-4">Laster...</div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
