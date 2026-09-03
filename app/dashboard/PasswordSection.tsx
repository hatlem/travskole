'use client';

import { useState } from 'react';
import { useStrings } from '@/components/SettingsProvider';
import { fieldClass } from './types';

interface PasswordSectionProps {
  /** Har kontoen et passord fra før? Styrer om vi ber om det nåværende. */
  hasPassword: boolean;
  onChanged: () => void;
}

/**
 * Bytt (eller sett) passord uten å måtte logge ut og gå via «glemt passord».
 *
 * Kontoer opprettet av admin eller via magic link har ikke noe passord ennå —
 * de setter sitt første her, uten å oppgi et gammelt.
 */
export function PasswordSection({ hasPassword, onChanged }: PasswordSectionProps) {
  const t = useStrings();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', repeatPassword: '' });

  function reset() {
    setForm({ currentPassword: '', newPassword: '', repeatPassword: '' });
    setError(null);
  }

  async function save() {
    setError(null);
    if (form.newPassword !== form.repeatPassword) {
      setError(t('dash.password_mismatch'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/dashboard/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(result.error || 'Kunne ikke oppdatere passordet');
        return;
      }
      reset();
      setOpen(false);
      setDone(true);
      onChanged();
    } catch {
      setError('Noe gikk galt. Prøv igjen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900">{t('dash.password_heading')}</h2>
        {!open && (
          <button
            onClick={() => {
              reset();
              setDone(false);
              setOpen(true);
            }}
            className="text-sm text-bjerke-blue hover:underline font-medium"
          >
            {hasPassword ? t('dash.password_change') : t('dash.password_set')}
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 space-y-4">
        {done && !open && (
          <p role="status" className="text-sm text-green-700">
            {t('dash.password_updated')}
          </p>
        )}

        {!open ? (
          <p className="text-sm text-gray-500">
            {hasPassword ? t('dash.password_change_hint') : t('dash.password_set_hint')}
          </p>
        ) : (
          <>
            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {hasPassword && (
              <div>
                <label htmlFor="current-password" className="block text-sm text-gray-500 mb-1">
                  {t('dash.password_current')}
                </label>
                <input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={form.currentPassword}
                  onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
                  className={fieldClass}
                />
              </div>
            )}
            <div>
              <label htmlFor="new-password" className="block text-sm text-gray-500 mb-1">
                {t('dash.password_new')}
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={form.newPassword}
                onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="repeat-password" className="block text-sm text-gray-500 mb-1">
                {t('dash.password_repeat')}
              </label>
              <input
                id="repeat-password"
                type="password"
                autoComplete="new-password"
                value={form.repeatPassword}
                onChange={(e) => setForm((f) => ({ ...f, repeatPassword: e.target.value }))}
                className={fieldClass}
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                disabled={saving}
                onClick={save}
                className="bg-bjerke-blue text-white px-5 py-2 rounded-lg hover:bg-bjerke-blue-dark transition disabled:opacity-50"
              >
                {saving ? t('dash.saving') : t('dash.save')}
              </button>
              <button
                disabled={saving}
                onClick={() => {
                  setOpen(false);
                  reset();
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
