'use client';

import { useEffect, useState } from 'react';

export interface EditableUser {
  id: number;
  email: string;
  role: string;
  name: string;
  phone: string;
  address: string | null;
}

interface UserFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  user?: EditableUser | null;
  isSuperAdmin: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent';

export function UserFormModal({ open, mode, user, isSuperAdmin, onClose, onSaved }: UserFormModalProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [role, setRole] = useState('parent');
  const [sendMagicLink, setSendMagicLink] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // (Re)initialiser feltene hver gang modalen åpnes.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (mode === 'edit' && user) {
      setEmail(user.email);
      setName(user.name ?? '');
      setPhone(user.phone ?? '');
      setAddress(user.address ?? '');
      setRole(user.role);
      setSendMagicLink(false);
    } else {
      setEmail('');
      setName('');
      setPhone('');
      setAddress('');
      setRole('parent');
      setSendMagicLink(true);
    }
  }, [open, mode, user]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const trimmedName = name.trim();
      const trimmedPhone = phone.trim();
      const trimmedAddress = address.trim();

      let res: Response;
      if (mode === 'create') {
        res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            role,
            ...(trimmedName ? { name: trimmedName } : {}),
            ...(trimmedPhone ? { phone: trimmedPhone } : {}),
            ...(trimmedAddress ? { address: trimmedAddress } : {}),
            sendMagicLink,
          }),
        });
      } else {
        res = await fetch(`/api/admin/users/${user!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            role,
            ...(trimmedName ? { name: trimmedName } : {}),
            ...(trimmedPhone ? { phone: trimmedPhone } : {}),
            address: trimmedAddress || null,
          }),
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Kunne ikke lagre bruker');
        setSaving(false);
        return;
      }
      onSaved(mode === 'create' ? 'Bruker opprettet' : 'Bruker oppdatert');
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
      <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {mode === 'create' ? 'Ny bruker' : 'Rediger bruker'}
        </h3>

        {error && (
          <div role="alert" className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-post</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="navn@epost.no" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Navn</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Fornavn Etternavn" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="+47 …" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rolle</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className={`${inputClass} bg-white`}>
                <option value="parent">Forelder</option>
                {isSuperAdmin && <option value="admin">Admin</option>}
                {isSuperAdmin && <option value="superadmin">Superadmin</option>}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Adresse (valgfritt)</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} placeholder="Gate 1, 0000 Sted" />
          </div>

          {mode === 'create' && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={sendMagicLink} onChange={(e) => setSendMagicLink(e.target.checked)} className="rounded border-gray-300" />
              Send innloggingslenke på e-post
            </label>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" disabled={saving} onClick={onClose} className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Avbryt
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-bjerke-blue px-4 py-2.5 text-sm font-medium text-white hover:bg-bjerke-blue-dark disabled:opacity-50">
              {saving ? 'Lagrer …' : mode === 'create' ? 'Opprett' : 'Lagre'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
