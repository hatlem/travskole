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
import type { DashboardChild, DashboardData, DashboardProfile } from './types';

export const dynamic = 'force-dynamic';

const statusStyles: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  waitlist: 'bg-blue-100 text-blue-800',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('nb-NO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function DashboardContent() {
  const t = useStrings();
  const searchParams = useSearchParams();
  const success = searchParams.get('success');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<number | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const payNow = async (registrationId: number, provider: string) => {
    setPayingId(registrationId);
    setPayError(null);
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId, provider }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? 'Kunne ikke starte betaling');
      }
      window.location.href = body.url;
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Kunne ikke starte betaling');
      setPayingId(null);
    }
  };

  const cancelRegistration = async (registrationId: number, courseName: string) => {
    if (!window.confirm(t('dash.cancel_registration_confirm', { kurs: courseName }))) return;
    setCancellingId(registrationId);
    setCancelError(null);
    try {
      const res = await fetch(`/api/dashboard/registrations/${registrationId}/cancel`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Kunne ikke avbestille');
      setData((prev) =>
        prev
          ? {
              ...prev,
              registrations: prev.registrations.map((r) =>
                r.id === registrationId ? { ...r, status: 'cancelled', cancellable: false } : r
              ),
            }
          : prev
      );
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Kunne ikke avbestille');
    } finally {
      setCancellingId(null);
    }
  };

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
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('dash.registrations_heading')}</h2>
            {(payError || cancelError) && (
              <div role="alert" className="mb-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-2">
                {payError ?? cancelError}
              </div>
            )}
            {data && data.registrations.length > 0 ? (
              <div className="space-y-3">
                {data.registrations.map((r) => {
                  const badgeStyle = statusStyles[r.status] ?? statusStyles.pending;
                  const badgeLabel = t(`dash.status_${r.status in statusStyles ? r.status : 'pending'}`);
                  return (
                    <div
                      key={r.id}
                      className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{r.courseName}</p>
                        <p className="text-sm text-gray-500">
                          {r.childName ? `${r.childName} · ` : ''}{r.courseStartDate ? formatDate(r.courseStartDate) : 'Avtal tid'}
                          {r.courseEndDate && ` – ${formatDate(r.courseEndDate)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {r.priceKr !== null &&
                          r.priceKr > 0 &&
                          r.payableMethods.length > 0 &&
                          r.status !== 'cancelled' &&
                          ['none', 'pending', 'failed'].includes(r.paymentStatus) && (
                            <div className="flex gap-2">
                              {r.payableMethods.includes('stripe') && (
                                <button
                                  onClick={() => payNow(r.id, 'stripe')}
                                  disabled={payingId === r.id}
                                  className="text-xs font-medium bg-bjerke-blue text-white px-3 py-1.5 rounded-lg hover:bg-bjerke-blue-dark transition disabled:opacity-50"
                                >
                                  {payingId === r.id ? 'Starter…' : `Betal ${r.priceKr} kr med kort`}
                                </button>
                              )}
                              {r.payableMethods.includes('vipps') && (
                                <button
                                  onClick={() => payNow(r.id, 'vipps')}
                                  disabled={payingId === r.id}
                                  className="text-xs font-medium bg-[#ff5b24] text-white px-3 py-1.5 rounded-lg hover:opacity-90 transition disabled:opacity-50"
                                >
                                  Vipps
                                </button>
                              )}
                            </div>
                          )}
                        {r.cancellable && (
                          <button
                            onClick={() => cancelRegistration(r.id, r.courseName)}
                            disabled={cancellingId === r.id}
                            className="text-xs font-medium text-gray-600 hover:text-red-600 hover:underline disabled:opacity-50"
                          >
                            {cancellingId === r.id ? 'Avbestiller…' : t('dash.cancel_registration')}
                          </button>
                        )}
                        <span className={`text-xs font-medium px-3 py-1 rounded-full whitespace-nowrap ${badgeStyle}`}>
                          {badgeLabel}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 text-gray-500">
                {t('dash.no_registrations')}
              </div>
            )}
          </section>

          {/* Admin uten forelderprofil har ingen barn å vise — de bruker admin-panelet. */}
          {!(noProfile && isAdmin) && (
            <ChildrenSection
              items={data?.children ?? []}
              hasProfile={!noProfile}
              onChange={setChildren}
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
            href="/mine-bookinger"
            className="block bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:border-bjerke-blue transition"
          >
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Mine bookinger</h3>
            <p className="text-gray-500">Se status og betal for dine bookingforespørsler</p>
          </Link>

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
