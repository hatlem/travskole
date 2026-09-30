'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { useToast } from '@/components/admin/Toast';

interface SenderIdentity {
  id: number;
  email: string;
  displayName: string;
  active: boolean;
  sendCount: number;
  hasUserAccount: boolean;
}

const API = '/api/admin/crm/sender-identities';

export default function AvsenderePage() {
  const [identities, setIdentities] = useState<SenderIdentity[]>([]);
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch(API, { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke laste avsendere');
      const data = await res.json();
      setIdentities(data.identities || []);
      setAllowedDomains(data.allowedDomains || []);
      setCanManage(Boolean(data.canManage));
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      toast(err instanceof Error ? err.message : 'Kunne ikke laste avsendere', 'error');
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function patch(id: number, body: { displayName?: string; active?: boolean }, successMessage: string) {
    setBusyId(id);
    try {
      const res = await fetch(API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Kunne ikke oppdatere avsender', 'error');
        return false;
      }
      setIdentities((prev) => prev.map((i) => (i.id === id ? { ...i, ...body } : i)));
      toast(successMessage, 'success');
      return true;
    } catch {
      toast('Kunne ikke oppdatere avsender', 'error');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(identity: SenderIdentity) {
    setConfirmDeleteId(null);
    setEditingId(identity.id);
    setEditName(identity.displayName);
  }

  async function saveName(identity: SenderIdentity) {
    const name = editName.trim();
    if (!name || busyId !== null) return;
    if (name === identity.displayName) {
      setEditingId(null);
      return;
    }
    if (await patch(identity.id, { displayName: name }, 'Visningsnavn oppdatert')) {
      setEditingId(null);
    }
  }

  async function toggleActive(identity: SenderIdentity) {
    if (busyId !== null) return;
    await patch(
      identity.id,
      { active: !identity.active },
      identity.active ? 'Avsender deaktivert' : 'Avsender aktivert',
    );
  }

  async function remove(id: number) {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Kunne ikke slette avsender', 'error');
        return;
      }
      setIdentities((prev) => prev.filter((i) => i.id !== id));
      toast('Avsender slettet', 'success');
    } catch {
      toast('Kunne ikke slette avsender', 'error');
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || !newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim(), displayName: newName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Kunne ikke legge til avsender', 'error');
        return;
      }
      toast('Avsender lagt til', 'success');
      setNewEmail('');
      setNewName('');
      await load();
    } catch {
      toast('Kunne ikke legge til avsender', 'error');
    } finally {
      setCreating(false);
    }
  }

  const domainHint = allowedDomains.map((d) => `@${d}`).join(', ');

  return (
    <div>
      <CrmTabs />
      <div className="max-w-5xl space-y-6">
        <div>
          <h2 className="font-semibold mb-1">Avsendere</h2>
          <p className="text-sm text-gray-500">
            Adressene som kan velges som avsender i e-poststeg i flyter. Deaktiverte avsendere kan ikke
            velges, og e-poststeg som bruker dem sendes ikke.
          </p>
        </div>

        <div className="border border-amber-300 bg-amber-50 rounded-lg p-4 text-sm text-amber-900 space-y-1">
          <p className="font-semibold">Før du legger til en ny adresse</p>
          <p>
            Adressen må først verifiseres som avsender i Azure Communication Services av Basefarm/Orange
            (SPF/DKIM). Ellers vil utsendelser fra adressen feile.
          </p>
          <p>
            Svar på e-poster går alltid til <span className="font-medium">registrering@bjerke.no</span>,
            uansett hvilken avsender som er valgt.
          </p>
        </div>

        {loading ? (
          <TableSkeleton rows={7} cols={5} />
        ) : loadError ? (
          <EmptyState
            title="Kunne ikke laste avsendere"
            description="Noe gikk galt under henting av avsenderadresser. Prøv igjen."
            action={{ label: 'Prøv igjen', onClick: () => load() }}
          />
        ) : identities.length === 0 ? (
          <EmptyState
            title="Ingen avsendere"
            description="Legg til en verifisert avsenderadresse for å kunne sende e-post fra flyter."
          />
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">E-post</th>
                  <th className="px-4 py-2 font-medium">Visningsnavn</th>
                  <th className="px-4 py-2 font-medium">Brukerkonto</th>
                  <th className="px-4 py-2 font-medium text-right">Sendt</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {identities.map((identity) => {
                  const busy = busyId === identity.id;
                  const editing = editingId === identity.id;
                  const confirming = confirmDeleteId === identity.id;
                  return (
                    <tr key={identity.id} className={identity.active ? '' : 'text-gray-400'}>
                      <td className="px-4 py-2 font-medium">{identity.email}</td>
                      <td className="px-4 py-2">
                        {editing ? (
                          <div className="flex gap-2 items-center">
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveName(identity);
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                              autoFocus
                              maxLength={200}
                              aria-label="Visningsnavn"
                              className="border border-gray-300 rounded-md px-2 py-1 text-sm w-48"
                            />
                            <button
                              onClick={() => saveName(identity)}
                              disabled={!editName.trim() || busy}
                              className="text-xs text-blue-700 hover:underline disabled:opacity-50"
                            >
                              {busy ? 'Lagrer …' : 'Lagre'}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-xs text-gray-500 hover:underline"
                            >
                              Avbryt
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(identity)}
                            className="hover:underline text-left"
                            title="Endre visningsnavn"
                          >
                            {identity.displayName}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {identity.hasUserAccount ? (
                          <span
                            className="text-green-700"
                            title="En bruker med samme e-post finnes og kan få tildelt oppfølging av svar"
                          >
                            Ja
                          </span>
                        ) : (
                          <span className="text-gray-400" title="Ingen brukerkonto med denne e-posten">
                            Nei
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{identity.sendCount}</td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => toggleActive(identity)}
                          disabled={busyId !== null}
                          role="switch"
                          aria-checked={identity.active}
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
                            identity.active
                              ? 'bg-green-100 text-green-800 hover:bg-green-200'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                          title={identity.active ? 'Klikk for å deaktivere' : 'Klikk for å aktivere'}
                        >
                          {identity.active ? 'Aktiv' : 'Inaktiv'}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {canManage && (confirming ? (
                          <span className="inline-flex items-center gap-2 text-xs">
                            <span className="text-gray-600">Slette?</span>
                            <button
                              onClick={() => remove(identity.id)}
                              disabled={busy}
                              className="text-red-600 font-medium hover:underline disabled:opacity-50"
                            >
                              {busy ? 'Sletter …' : 'Ja, slett'}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={busy}
                              className="text-gray-500 hover:underline"
                            >
                              Avbryt
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setConfirmDeleteId(identity.id);
                            }}
                            disabled={busyId !== null}
                            className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                            title={
                              identity.sendCount > 0
                                ? 'Avsendere med sendehistorikk kan ikke slettes — deaktiver i stedet'
                                : undefined
                            }
                          >
                            Slett
                          </button>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {canManage && !loading && !loadError && (
          <section>
            <h3 className="font-semibold mb-2">Legg til avsender</h3>
            <form onSubmit={create} className="border border-gray-200 rounded-lg p-4 flex flex-wrap gap-2 items-end">
              <label className="flex flex-col gap-1 text-xs text-gray-600 flex-1 min-w-[16rem]">
                E-post
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={`navn${allowedDomains[0] ? `@${allowedDomains[0]}` : '@bjerke.no'}`}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-600 flex-1 min-w-[12rem]">
                Visningsnavn
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Fornavn Etternavn"
                  maxLength={200}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900"
                />
              </label>
              <button
                type="submit"
                disabled={!newEmail.trim() || !newName.trim() || creating}
                className="bg-bjerke-blue text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
              >
                {creating ? 'Legger til …' : 'Legg til avsender'}
              </button>
              {domainHint && (
                <p className="w-full text-xs text-gray-500">Tillatte domener: {domainHint}</p>
              )}
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
