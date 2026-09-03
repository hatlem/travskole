'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { useStrings } from '@/components/SettingsProvider';
import { fieldClass } from './types';

interface DeleteAccountSectionProps {
  hasPassword: boolean;
}

/**
 * Selvbetjent sletting (GDPR art. 17).
 *
 * Bevisst tungvint: seksjonen må åpnes, ordet SLETT skrives, og har kontoen et
 * passord må det oppgis. Serveren scrubber persondata og stenger innlogging —
 * derfor logges brukeren ut med én gang etterpå.
 */
export function DeleteAccountSection({ hasPassword }: DeleteAccountSectionProps) {
  const t = useStrings();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWord, setConfirmWord] = useState('');
  const [password, setPassword] = useState('');

  const confirmed = confirmWord.trim().toUpperCase() === t('dash.account_delete_confirm_word');

  async function remove() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/dashboard/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, currentPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Kunne ikke slette kontoen');
        return;
      }
      // Kontoen kan ikke lenger logge inn — avslutt sesjonen med én gang.
      signOut({ callbackUrl: '/' });
    } catch {
      setError('Noe gikk galt. Prøv igjen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('dash.account_heading')}</h2>

      <div className="bg-white rounded-lg shadow-sm border border-red-200 p-5 space-y-4">
        <p className="text-sm text-gray-600">{t('dash.account_delete_hint')}</p>

        {!open ? (
          <button
            onClick={() => {
              setError(null);
              setConfirmWord('');
              setPassword('');
              setOpen(true);
            }}
            className="text-sm font-medium text-red-600 hover:underline"
          >
            {t('dash.account_delete')}
          </button>
        ) : (
          <>
            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="delete-confirm" className="block text-sm text-gray-500 mb-1">
                {t('dash.account_delete_confirm_label')}
              </label>
              <input
                id="delete-confirm"
                type="text"
                value={confirmWord}
                onChange={(e) => setConfirmWord(e.target.value)}
                className={fieldClass}
              />
            </div>
            {hasPassword && (
              <div>
                <label htmlFor="delete-password" className="block text-sm text-gray-500 mb-1">
                  {t('dash.email_password')}
                </label>
                <input
                  id="delete-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={fieldClass}
                />
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button
                disabled={saving || !confirmed}
                onClick={remove}
                className="bg-red-600 text-white px-5 py-2 rounded-lg hover:bg-red-700 transition disabled:opacity-50"
              >
                {saving ? t('dash.saving') : t('dash.account_delete')}
              </button>
              <button
                disabled={saving}
                onClick={() => setOpen(false)}
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
