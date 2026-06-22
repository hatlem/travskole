'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useStrings } from '@/components/SettingsProvider';

export const dynamic = 'force-dynamic';

interface DashboardData {
  role?: string;
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
    courseStartDate: string | null;
    courseEndDate: string | null;
    childName: string | null;
  }[];
}

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
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', address: '' });

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

        {noProfile && !isAdmin && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold text-blue-800 mb-2">{t('dash.no_profile_heading')}</h2>
            <p className="text-blue-700">
              {t('dash.no_profile_text')}
            </p>
            <Link
              href="/arrangementer"
              className="inline-block mt-4 bg-bjerke-blue text-white px-5 py-2 rounded-lg hover:bg-bjerke-blue-dark transition"
            >
              Se alle kurs
            </Link>
          </div>
        )}

        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('dash.registrations_heading')}</h2>
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
                          {r.childName ? `${r.childName} \u00b7 ` : ''}{r.courseStartDate ? formatDate(r.courseStartDate) : 'Avtal tid'}
                          {r.courseEndDate && ` – ${formatDate(r.courseEndDate)}`}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-3 py-1 rounded-full whitespace-nowrap ${badgeStyle}`}>
                        {badgeLabel}
                      </span>
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

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('dash.children_heading')}</h2>
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
                        {t('dash.born')} {formatDate(c.birthdate)}
                      </p>
                    )}
                    {c.allergies && (
                      <p className="text-sm text-gray-500 mt-1">
                        {t('dash.allergies_label')} {c.allergies}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 text-gray-500">
                {t('dash.no_children')}
              </div>
            )}
          </section>

          {data?.profile && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">{t('dash.profile_heading')}</h2>
                {!editing && (
                  <button
                    onClick={() => {
                      setEditForm({
                        name: data.profile!.name,
                        phone: data.profile!.phone,
                        address: data.profile!.address ?? '',
                      });
                      setEditError(null);
                      setEditing(true);
                    }}
                    className="text-sm text-bjerke-blue hover:underline font-medium"
                  >
                    {t('dash.edit')}
                  </button>
                )}
              </div>
              {editing ? (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 space-y-4">
                  {editError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                      {editError}
                    </div>
                  )}
                  <div>
                    <label htmlFor="edit-name" className="block text-sm text-gray-500 mb-1">
                      {t('dash.name_label')}
                    </label>
                    <input
                      id="edit-name"
                      type="text"
                      required
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bjerke-blue"
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-phone" className="block text-sm text-gray-500 mb-1">
                      {t('dash.phone_label')}
                    </label>
                    <input
                      id="edit-phone"
                      type="tel"
                      required
                      value={editForm.phone}
                      onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bjerke-blue"
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-address" className="block text-sm text-gray-500 mb-1">
                      {t('dash.address_label')}
                    </label>
                    <input
                      id="edit-address"
                      type="text"
                      value={editForm.address}
                      onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bjerke-blue"
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      disabled={saving}
                      onClick={async () => {
                        setEditError(null);
                        setSaving(true);
                        try {
                          const res = await fetch('/api/dashboard', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(editForm),
                          });
                          const result = await res.json();
                          if (!res.ok) {
                            setEditError(result.error || 'Kunne ikke lagre endringer');
                            return;
                          }
                          setData((prev) =>
                            prev ? { ...prev, profile: result.profile } : prev
                          );
                          setEditing(false);
                        } catch {
                          setEditError('Noe gikk galt. Prøv igjen.');
                        } finally {
                          setSaving(false);
                        }
                      }}
                      className="bg-bjerke-blue text-white px-5 py-2 rounded-lg hover:bg-bjerke-blue-dark transition disabled:opacity-50"
                    >
                      {saving ? t('dash.saving') : t('dash.save')}
                    </button>
                    <button
                      disabled={saving}
                      onClick={() => {
                        setEditing(false);
                        setEditError(null);
                      }}
                      className="text-gray-600 px-5 py-2 rounded-lg hover:bg-gray-100 transition disabled:opacity-50"
                    >
                      {t('dash.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 space-y-2">
                  <p className="text-gray-900">
                    <span className="text-sm text-gray-500">{t('dash.name_label')}:</span>{' '}
                    {data.profile.name}
                  </p>
                  <p className="text-gray-900">
                    <span className="text-sm text-gray-500">{t('dash.email_label')}:</span>{' '}
                    {data.profile.email}
                  </p>
                  <p className="text-gray-900">
                    <span className="text-sm text-gray-500">{t('dash.phone_label')}:</span>{' '}
                    {data.profile.phone}
                  </p>
                  {data.profile.address && (
                    <p className="text-gray-900">
                      <span className="text-sm text-gray-500">{t('dash.address_label')}:</span>{' '}
                      {data.profile.address}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          <Link
            href="/arrangementer"
            className="block bg-bjerke-blue text-white rounded-lg p-6 hover:bg-bjerke-blue-dark transition"
          >
            <h3 className="text-xl font-semibold mb-2">{t('dash.see_all_courses')}</h3>
            <p className="text-blue-100">{t('dash.see_all_courses_sub')}</p>
          </Link>
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
