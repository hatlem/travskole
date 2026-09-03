'use client';

import { useState } from 'react';
import { useStrings } from '@/components/SettingsProvider';
import { fieldClass, type DashboardProfile } from './types';

interface ProfileSectionProps {
  profile: DashboardProfile | null;
  email: string;
  onSaved: (profile: DashboardProfile) => void;
}

/**
 * Profilkortet på dashbordet.
 *
 * Når brukeren ikke har en profil ennå (opprettet av admin eller via magic link)
 * vises skjemaet åpent som «Fullfør profilen din» — tidligere var seksjonen da
 * helt skjult, og brukeren hadde ingen vei til å fylle den ut selv.
 */
export function ProfileSection({ profile, email, onSaved }: ProfileSectionProps) {
  const t = useStrings();
  const missing = profile === null;
  const [editing, setEditing] = useState(missing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: profile?.name ?? '',
    phone: profile?.phone ?? '',
    address: profile?.address ?? '',
  });

  function startEditing() {
    setForm({
      name: profile?.name ?? '',
      phone: profile?.phone ?? '',
      address: profile?.address ?? '',
    });
    setError(null);
    setEditing(true);
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/dashboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(result.error || 'Kunne ikke lagre endringer');
        return;
      }
      onSaved(result.profile);
      setEditing(false);
    } catch {
      setError('Noe gikk galt. Prøv igjen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900">
          {missing ? t('dash.profile_complete_heading') : t('dash.profile_heading')}
        </h2>
        {!editing && (
          <button onClick={startEditing} className="text-sm text-bjerke-blue hover:underline font-medium">
            {t('dash.edit')}
          </button>
        )}
      </div>

      {editing ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 space-y-4">
          {missing && <p className="text-sm text-gray-500">{t('dash.profile_complete_text')}</p>}
          {error && (
            <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {error}
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
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={fieldClass}
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
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="edit-address" className="block text-sm text-gray-500 mb-1">
              {t('dash.address_label')}
            </label>
            <input
              id="edit-address"
              type="text"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className={fieldClass}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              disabled={saving}
              onClick={save}
              className="bg-bjerke-blue text-white px-5 py-2 rounded-lg hover:bg-bjerke-blue-dark transition disabled:opacity-50"
            >
              {saving ? t('dash.saving') : t('dash.save')}
            </button>
            {!missing && (
              <button
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className="text-gray-600 px-5 py-2 rounded-lg hover:bg-gray-100 transition disabled:opacity-50"
              >
                {t('dash.cancel')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 space-y-2">
          <p className="text-gray-900">
            <span className="text-sm text-gray-500">{t('dash.name_label')}:</span> {profile?.name}
          </p>
          <p className="text-gray-900">
            <span className="text-sm text-gray-500">{t('dash.email_label')}:</span> {email}
          </p>
          <p className="text-gray-900">
            <span className="text-sm text-gray-500">{t('dash.phone_label')}:</span> {profile?.phone}
          </p>
          {profile?.address && (
            <p className="text-gray-900">
              <span className="text-sm text-gray-500">{t('dash.address_label')}:</span> {profile.address}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
