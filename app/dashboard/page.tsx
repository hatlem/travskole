'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useStrings } from '@/components/SettingsProvider';
import { ProfileSection } from './ProfileSection';
import { ChildrenSection } from './ChildrenSection';
import { PasswordSection } from './PasswordSection';
import { EmailSection } from './EmailSection';
import { DeleteAccountSection } from './DeleteAccountSection';
import { Toast, useToast } from '@/components/ui/Toast';
import { RegistrationsSection } from './RegistrationsSection';
import { RequestsSection } from './RequestsSection';
import type { DashboardChild, DashboardData, DashboardProfile } from './types';

export const dynamic = 'force-dynamic';

function DashboardContent() {
  const t = useStrings();
  const searchParams = useSearchParams();
  const success = searchParams.get('success');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

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
  const isAdmin = data?.role === 'admin' || data?.role === 'superadmin';

  const setProfile = (profile: DashboardProfile) =>
    setData((prev) => (prev ? { ...prev, profile } : prev));
  const setChildren = (children: DashboardChild[]) =>
    setData((prev) => (prev ? { ...prev, children } : prev));

  return (
    <div className="min-h-screen bg-gray-50 pt-8 pb-24 sm:py-16">
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
                  {t('dash.success_heading')}
                </h3>
                <p className="mt-2 text-green-700">
                  {t('dash.success_text')}
                </p>
              </div>
            </div>
          </div>
        )}

        <h1 className="text-3xl font-bold text-gray-900 mb-8">{t('dash.heading')}</h1>

        {noProfile && isAdmin && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold text-indigo-800 mb-2">Administrator</h2>
            <p className="text-indigo-700">
              Du er logget inn som administrator. Gå til admin-panelet for å administrere kurs, påmeldinger og brukere.
            </p>
            <Link
              href="/admin"
              className="inline-block mt-4 bg-bjerke-blue text-white px-5 py-2 rounded-lg hover:bg-bjerke-blue-dark transition"
            >
              Gå til admin
            </Link>
          </div>
        )}

        <div className="space-y-8">
          <RegistrationsSection
            registrations={data?.registrations ?? []}
            notify={toast.show}
            onCancelled={(id) =>
              setData((prev) =>
                prev
                  ? {
                      ...prev,
                      registrations: prev.registrations.map((r) =>
                        r.id === id ? { ...r, status: 'cancelled', cancellable: false, cancelledBySelf: true } : r
                      ),
                    }
                  : prev
              )
            }
          />

          {((data?.bookings?.length ?? 0) > 0 || !isAdmin) && (
            <RequestsSection
              bookings={data?.bookings ?? []}
              notify={toast.show}
              onWithdrawn={(id) =>
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        bookings: (prev.bookings ?? []).map((b) =>
                          b.id === id ? { ...b, status: 'cancelled', cancellable: false, withdrawnBySelf: true, providers: [] } : b
                        ),
                      }
                    : prev
                )
              }
            />
          )}

          {/* Admin uten forelderprofil har ingen barn å vise — de bruker admin-panelet. */}
          {!(noProfile && isAdmin) && (
            <ChildrenSection
              items={data?.children ?? []}
              hasProfile={!noProfile}
              onChange={setChildren}
              notify={toast.show}
            />
          )}

          {!(noProfile && isAdmin) && (
            <ProfileSection
              profile={data?.profile ?? null}
              email={data?.email ?? ''}
              onSaved={setProfile}
            />
          )}

          <PasswordSection
            hasPassword={data?.hasPassword ?? false}
            onChanged={() => setData((prev) => (prev ? { ...prev, hasPassword: true } : prev))}
          />

          <EmailSection
            email={data?.email ?? ''}
            hasPassword={data?.hasPassword ?? false}
          />

          <Link
            href="/arrangementer"
            className="block bg-bjerke-blue text-white rounded-lg p-6 hover:bg-bjerke-blue-dark transition"
          >
            <h3 className="text-xl font-semibold mb-2">{t('dash.see_all_courses')}</h3>
            <p className="text-blue-100">{t('dash.see_all_courses_sub')}</p>
          </Link>

          <DeleteAccountSection hasPassword={data?.hasPassword ?? false} />
        </div>
      </div>
      <Toast message={toast.message} onClose={toast.dismiss} />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <main>
      <Suspense
        fallback={
          <div className="min-h-screen bg-gray-50 py-16">
            <div className="max-w-4xl mx-auto px-4">Laster...</div>
          </div>
        }
      >
        <DashboardContent />
      </Suspense>
    </main>
  );
}
