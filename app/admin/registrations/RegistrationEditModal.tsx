'use client';

import { useState } from 'react';

export interface EditableRegistration {
  id: number;
  course: { id: number; name: string };
  child: { id: number; name: string; birthdate: string | null; allergies: string | null } | null;
  parent: { id: number; name: string; phone: string; address: string | null; user?: { email: string } };
}

interface RegistrationEditModalProps {
  registration: EditableRegistration;
  onClose: () => void;
  onSaved: (registration: EditableRegistration, message: string) => void;
}

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent';

/**
 * Retter opplysningene på en påmelding.
 *
 * Tidligere kunne admin bare endre status og slette — en feilstavet deltaker
 * eller en ny allergi måtte løses ved å slette og opprette påmeldingen på nytt.
 * Statusen endres fortsatt fra nedtrekksmenyen i tabellen (den har egen
 * ventelistelogikk), så modalen holder seg til selve opplysningene.
 */
export function RegistrationEditModal({ registration, onClose, onSaved }: RegistrationEditModalProps) {
  // Feltene initialiseres fra påmeldingen én gang. Kall-stedet monterer modalen
  // med key={id}, så en annen påmelding gir en ny instans med ferske verdier.
  const [form, setForm] = useState(() => ({
    childName: registration.child?.name ?? '',
    childBirthdate: registration.child?.birthdate ? registration.child.birthdate.slice(0, 10) : '',
    childAllergies: registration.child?.allergies ?? '',
    parentName: registration.parent.name,
    parentPhone: registration.parent.phone,
    parentAddress: registration.parent.address ?? '',
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/registrations/${registration.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(registration.child
            ? {
                childName: form.childName,
                childBirthdate: form.childBirthdate,
                childAllergies: form.childAllergies,
              }
            : {}),
          parentName: form.parentName,
          parentPhone: form.parentPhone,
          parentAddress: form.parentAddress,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Kunne ikke lagre endringene');
        setSaving(false);
        return;
      }
      onSaved(data.registration, 'Påmeldingen er oppdatert');
      onClose();
    } catch {
      setError('Noe gikk galt. Prøv igjen.');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="fixed inset-0 bg-black/50" />
      <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-gray-900">Rediger påmelding</h3>
        <p className="text-sm text-gray-500 mb-4">
          #{registration.id} · {registration.course.name}
        </p>

        {error && (
          <div role="alert" className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {registration.child ? (
            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold text-gray-500 uppercase">Deltaker</legend>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Navn</label>
                <input
                  type="text"
                  required
                  value={form.childName}
                  onChange={(e) => setForm((f) => ({ ...f, childName: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fødselsdato</label>
                  <input
                    type="date"
                    value={form.childBirthdate}
                    onChange={(e) => setForm((f) => ({ ...f, childBirthdate: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Allergier</label>
                  <input
                    type="text"
                    value={form.childAllergies}
                    onChange={(e) => setForm((f) => ({ ...f, childAllergies: e.target.value }))}
                    placeholder="Valgfritt"
                    className={inputClass}
                  />
                </div>
              </div>
            </fieldset>
          ) : (
            <p className="text-sm text-gray-500">
              Voksen-arrangement — deltakeren er forelderen selv.
            </p>
          )}

          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-gray-500 uppercase">Kontaktperson</legend>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Navn</label>
              <input
                type="text"
                required
                value={form.parentName}
                onChange={(e) => setForm((f) => ({ ...f, parentName: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
              <input
                type="tel"
                required
                value={form.parentPhone}
                onChange={(e) => setForm((f) => ({ ...f, parentPhone: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Adresse (valgfritt)</label>
              <input
                type="text"
                value={form.parentAddress}
                onChange={(e) => setForm((f) => ({ ...f, parentAddress: e.target.value }))}
                className={inputClass}
              />
            </div>
            <p className="text-xs text-gray-500">
              Kontaktinfoen ligger på forelderprofilen — endringer her gjelder alle påmeldingene til
              {' '}{registration.parent.user?.email ?? 'denne familien'}.
            </p>
          </fieldset>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Avbryt
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-bjerke-blue px-4 py-2.5 text-sm font-medium text-white hover:bg-bjerke-blue-dark disabled:opacity-50"
            >
              {saving ? 'Lagrer …' : 'Lagre'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
