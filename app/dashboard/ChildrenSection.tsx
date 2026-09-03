'use client';

import { useState } from 'react';
import { useStrings } from '@/components/SettingsProvider';
import { fieldClass, type DashboardChild } from './types';

interface ChildrenSectionProps {
  items: DashboardChild[];
  /** Uten profil finnes det ingen Parent-rad å henge barn på ennå. */
  hasProfile: boolean;
  onChange: (children: DashboardChild[]) => void;
}

interface ChildForm {
  name: string;
  birthdate: string;
  allergies: string;
}

const emptyForm: ChildForm = { name: '', birthdate: '', allergies: '' };

function toForm(child: DashboardChild): ChildForm {
  return {
    name: child.name,
    // <input type="date"> vil ha yyyy-mm-dd, ikke full ISO-streng.
    birthdate: child.birthdate ? child.birthdate.slice(0, 10) : '',
    allergies: child.allergies ?? '',
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Barnekortene på dashbordet, med legg til / rediger / fjern.
 *
 * Tidligere var dette rene visningskort: en endret allergi eller et feilstavet
 * navn kunne ikke rettes av noen. Skjemaet her snakker med
 * /api/dashboard/children, som deler regler med admin-veien.
 */
export function ChildrenSection({ items, hasProfile, onChange }: ChildrenSectionProps) {
  const t = useStrings();
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<ChildForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startAdd() {
    setForm(emptyForm);
    setError(null);
    setEditingId('new');
  }

  function startEdit(child: DashboardChild) {
    setForm(toForm(child));
    setError(null);
    setEditingId(child.id);
  }

  function cancel() {
    setEditingId(null);
    setError(null);
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const creating = editingId === 'new';
      const res = await fetch(
        creating ? '/api/dashboard/children' : `/api/dashboard/children/${editingId}`,
        {
          method: creating ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }
      );
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(result.error || 'Kunne ikke lagre');
        return;
      }
      onChange(
        creating
          ? [result.child, ...items]
          : items.map((c) => (c.id === result.child.id ? result.child : c))
      );
      setEditingId(null);
    } catch {
      setError('Noe gikk galt. Prøv igjen.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(child: DashboardChild) {
    if (!window.confirm(t('dash.child_remove_confirm', { navn: child.name }))) return;
    setError(null);
    setRemovingId(child.id);
    try {
      const res = await fetch(`/api/dashboard/children/${child.id}`, { method: 'DELETE' });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(result.error || 'Kunne ikke fjerne barnet');
        return;
      }
      onChange(items.filter((c) => c.id !== child.id));
    } catch {
      setError('Noe gikk galt. Prøv igjen.');
    } finally {
      setRemovingId(null);
    }
  }

  const formCard = (
    <div className="bg-white rounded-lg shadow-sm border border-bjerke-blue/40 p-5 space-y-3">
      <div>
        <label className="block text-sm text-gray-500 mb-1">{t('dash.child_name_label')}</label>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className={fieldClass}
        />
      </div>
      <div>
        <label className="block text-sm text-gray-500 mb-1">{t('dash.child_birthdate_label')}</label>
        <input
          type="date"
          value={form.birthdate}
          onChange={(e) => setForm((f) => ({ ...f, birthdate: e.target.value }))}
          className={fieldClass}
        />
      </div>
      <div>
        <label className="block text-sm text-gray-500 mb-1">{t('dash.child_allergies_label')}</label>
        <input
          type="text"
          value={form.allergies}
          onChange={(e) => setForm((f) => ({ ...f, allergies: e.target.value }))}
          placeholder={t('dash.child_allergies_placeholder')}
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
          onClick={cancel}
          className="text-gray-600 px-5 py-2 rounded-lg hover:bg-gray-100 transition disabled:opacity-50"
        >
          {t('dash.cancel')}
        </button>
      </div>
    </div>
  );

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900">{t('dash.children_heading')}</h2>
        {hasProfile && editingId !== 'new' && (
          <button onClick={startAdd} className="text-sm text-bjerke-blue hover:underline font-medium">
            + {t('dash.children_add')}
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {editingId === 'new' && formCard}

        {items.length > 0 ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {items.map((child) =>
              editingId === child.id ? (
                <div key={child.id}>{formCard}</div>
              ) : (
                <div key={child.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{child.name}</p>
                      {child.birthdate && (
                        <p className="text-sm text-gray-500 mt-1">
                          {t('dash.born')} {formatDate(child.birthdate)}
                        </p>
                      )}
                      <p className="text-sm text-gray-500 mt-1">
                        {child.allergies
                          ? `${t('dash.allergies_label')} ${child.allergies}`
                          : t('dash.child_allergies_none')}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-3">
                      <button
                        onClick={() => startEdit(child)}
                        className="text-sm text-bjerke-blue hover:underline font-medium"
                      >
                        {t('dash.edit')}
                      </button>
                      <button
                        onClick={() => remove(child)}
                        disabled={removingId === child.id}
                        className="text-sm text-red-600 hover:underline font-medium disabled:opacity-50"
                      >
                        {t('dash.child_remove')}
                      </button>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          editingId !== 'new' && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 text-gray-500">
              {t('dash.no_children')}
            </div>
          )
        )}
      </div>
    </section>
  );
}
