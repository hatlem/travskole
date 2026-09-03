'use client';

import { useState } from 'react';
import { useStrings } from '@/components/SettingsProvider';
import { fieldClass } from './types';

interface EmailSectionProps {
  email: string;
  hasPassword: boolean;
}

/**
 * Bytt innloggingsadresse.
 *
 * Adressen byttes ikke her og nå: forespørselen sender en bekreftelseslenke til
 * den nye adressen (og et varsel til den gamle), slik at ingen kan flytte
 * kontoen sin til en adresse de ikke kontrollerer.
 */
export function EmailSection({ email, hasPassword }: EmailSectionProps) {
  const t = useStrings();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [form, setForm] = useState({ newEmail: '', currentPassword: '' });

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/dashboard/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Kunne ikke sende bekreftelse');
        return;
      }
      setSentTo(data.pendingEmail ?? form.newEmail);
      setForm({ newEmail: '', currentPassword: '' });
      setOpen(false);
    } catch {
      setError('Noe gikk galt. Prøv igjen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900">{t('dash.email_heading')}</h2>
        {!open && (
          <button
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
            className="text-sm text-bjerke-blue hover:underline font-medium"
          >
            {t('dash.email_change')}
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 space-y-4">
        <p className="text-gray-900">{email}</p>

        {sentTo && !open && (
          <p role="status" className="text-sm text-green-700">
            {t('dash.email_change_sent', { epost: sentTo })}
          </p>
        )}

        {!open ? (
          <p className="text-sm text-gray-500">{t('dash.email_change_hint')}</p>
        ) : (
          <>
            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="new-email" className="block text-sm text-gray-500 mb-1">
                {t('dash.email_new')}
              </label>
              <input
                id="new-email"
                type="email"
                autoComplete="email"
                value={form.newEmail}
                onChange={(e) => setForm((f) => ({ ...f, newEmail: e.target.value }))}
                className={fieldClass}
              />
            </div>
            {hasPassword && (
              <div>
                <label htmlFor="email-password" className="block text-sm text-gray-500 mb-1">
                  {t('dash.email_password')}
                </label>
                <input
                  id="email-password"
                  type="password"
                  autoComplete="current-password"
                  value={form.currentPassword}
                  onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
                  className={fieldClass}
                />
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button
                disabled={saving}
                onClick={submit}
                className="bg-bjerke-blue text-white px-5 py-2 rounded-lg hover:bg-bjerke-blue-dark transition disabled:opacity-50"
              >
                {saving ? t('dash.saving') : t('dash.save')}
              </button>
              <button
                disabled={saving}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                className="text-gray-600 px-5 py-2 rounded-lg hover:bg-gray-100 transition disabled:opacity-50"
              >
                {t('dash.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
