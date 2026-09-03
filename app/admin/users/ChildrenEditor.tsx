'use client';

import { useState } from 'react';
import { useToast } from '@/components/admin/Toast';

export interface AdminChild {
  id: number;
  name: string;
  birthdate: string | null;
  allergies: string | null;
}

interface ChildrenEditorProps {
  userId: number;
  items: AdminChild[];
  /** Kalles etter lagring så listen i tabellen kan oppdateres. */
  onChange: (children: AdminChild[]) => void;
}

interface ChildForm {
  name: string;
  birthdate: string;
  allergies: string;
}

const emptyForm: ChildForm = { name: '', birthdate: '', allergies: '' };

const inputClass =
  'w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent';

/**
 * Barneredigering i den utvidbare raden på /admin/users.
 *
 * Barnedata (særlig allergier) kunne tidligere bare settes i det øyeblikket
 * påmeldingen ble opprettet — verken forelder eller admin kunne rette dem
 * etterpå. Endepunktene her deler regler med selvbetjeningen.
 */
export function ChildrenEditor({ userId, items, onChange }: ChildrenEditorProps) {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<ChildForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  function startAdd() {
    setForm(emptyForm);
    setEditingId('new');
  }

  function startEdit(child: AdminChild) {
    setForm({
      name: child.name,
      birthdate: child.birthdate ? child.birthdate.slice(0, 10) : '',
      allergies: child.allergies ?? '',
    });
    setEditingId(child.id);
  }

  async function save() {
    setSaving(true);
    try {
      const creating = editingId === 'new';
      const res = await fetch(
        creating
          ? `/api/admin/users/${userId}/children`
          : `/api/admin/users/${userId}/children/${editingId}`,
        {
          method: creating ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Kunne ikke lagre barnet');
      onChange(
        creating
          ? [...items, data.child]
          : items.map((c) => (c.id === data.child.id ? data.child : c))
      );
      setEditingId(null);
      toast(creating ? 'Barn lagt til' : 'Barn oppdatert', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove(child: AdminChild) {
    if (!window.confirm(`Fjern ${child.name}? Påmeldingshistorikken beholdes.`)) return;
    setBusyId(child.id);
    try {
      const res = await fetch(`/api/admin/users/${userId}/children/${child.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Kunne ikke fjerne barnet');
      onChange(items.filter((c) => c.id !== child.id));
      toast('Barn fjernet', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setBusyId(null);
    }
  }

  const formCard = (
    <div className="bg-white rounded-lg border border-bjerke-blue/40 px-3 py-3 space-y-2">
      <input
        type="text"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        placeholder="Navn"
        className={inputClass}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={form.birthdate}
          onChange={(e) => setForm((f) => ({ ...f, birthdate: e.target.value }))}
          className={inputClass}
        />
        <input
          type="text"
          value={form.allergies}
          onChange={(e) => setForm((f) => ({ ...f, allergies: e.target.value }))}
          placeholder="Allergier"
          className={inputClass}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-bjerke-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-bjerke-blue-dark disabled:opacity-50"
        >
          {saving ? 'Lagrer …' : 'Lagre'}
        </button>
        <button
          onClick={() => setEditingId(null)}
          disabled={saving}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Avbryt
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase">Barn ({items.length})</p>
        {editingId !== 'new' && (
          <button onClick={startAdd} className="text-xs font-medium text-bjerke-blue hover:underline">
            + Legg til barn
          </button>
        )}
      </div>

      <div className="space-y-2">
        {editingId === 'new' && formCard}

        {items.map((child) =>
          editingId === child.id ? (
            <div key={child.id}>{formCard}</div>
          ) : (
            <div key={child.id} className="bg-white rounded-lg border border-gray-200 px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-gray-900">{child.name}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                    {child.birthdate && (
                      <span>Født: {new Date(child.birthdate).toLocaleDateString('nb-NO')}</span>
                    )}
                    {child.allergies ? (
                      <span className="text-orange-600">Allergier: {child.allergies}</span>
                    ) : (
                      <span>Ingen allergier registrert</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => startEdit(child)}
                    className="text-xs font-medium text-bjerke-blue hover:underline"
                  >
                    Rediger
                  </button>
                  <button
                    onClick={() => remove(child)}
                    disabled={busyId === child.id}
                    className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                  >
                    Fjern
                  </button>
                </div>
              </div>
            </div>
          )
        )}

        {items.length === 0 && editingId !== 'new' && (
          <p className="text-sm text-gray-400">Ingen barn registrert</p>
        )}
      </div>
    </div>
  );
}
