'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { useToast } from '@/components/admin/Toast';
import { HelpTip } from '@/components/admin/HelpTip';

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
  const [showAdd, setShowAdd] = useState(false);
  const newEmailRef = useRef<HTMLInputElement>(null);

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
      if (!res.ok) throw new Error('Kunne ikke hente avsenderne. Last siden på nytt om litt.');
      const data = await res.json();
      setIdentities(data.identities || []);
      setAllowedDomains(data.allowedDomains || []);
      setCanManage(Boolean(data.canManage));
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      toast(err instanceof Error ? err.message : 'Kunne ikke hente avsenderne. Last siden på nytt om litt.', 'error');
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
        toast(data.error || 'Endringen ble ikke lagret. Prøv igjen.', 'error');
        return false;
      }
      setIdentities((prev) => prev.map((i) => (i.id === id ? { ...i, ...body } : i)));
      toast(successMessage, 'success');
      return true;
    } catch {
      toast('Endringen ble ikke lagret — sjekk nettforbindelsen og prøv igjen.', 'error');
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
    if (await patch(identity.id, { displayName: name }, 'Navnet er endret — nye e-poster sendes med det nye navnet')) {
      setEditingId(null);
    }
  }

  async function toggleActive(identity: SenderIdentity) {
    if (busyId !== null) return;
    await patch(
      identity.id,
      { active: !identity.active },
      identity.active
        ? `${identity.email} er slått av — e-poster som bruker den, sendes ikke før du slår den på igjen`
        : `${identity.email} er slått på og kan brukes i e-postflyter`,
    );
  }

  async function remove(id: number) {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Avsenderen ble ikke slettet. Har den sendt e-post før, kan du slå den av i stedet.', 'error');
        return;
      }
      setIdentities((prev) => prev.filter((i) => i.id !== id));
      toast('Avsenderen er slettet', 'success');
    } catch {
      toast('Avsenderen ble ikke slettet — sjekk nettforbindelsen og prøv igjen.', 'error');
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
        toast(data.error || 'Avsenderen ble ikke lagt til. Sjekk at adressen er riktig og prøv igjen.', 'error');
        return;
      }
      toast(`${newEmail.trim()} er lagt til og kan velges i e-postflyter`, 'success');
      setNewEmail('');
      setNewName('');
      setShowAdd(false);
      await load();
    } catch {
      toast('Avsenderen ble ikke lagt til — sjekk nettforbindelsen og prøv igjen.', 'error');
    } finally {
      setCreating(false);
    }
  }

  const domainHint = allowedDomains.map((d) => `@${d}`).join(', ');
  const emailPlaceholder = `navn@${allowedDomains[0] ?? 'bjerke.no'}`;

  function openAddForm() {
    setShowAdd(true);
    requestAnimationFrame(() => {
      newEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      newEmailRef.current?.focus({ preventScroll: true });
    });
  }

  function closeAddForm() {
    setShowAdd(false);
    setNewEmail('');
    setNewName('');
  }

  function renderName(identity: SenderIdentity) {
    const busy = busyId === identity.id;
    if (editingId === identity.id) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName(identity);
              if (e.key === 'Escape') setEditingId(null);
            }}
            autoFocus
            maxLength={200}
            aria-label="Navn mottakeren ser"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 sm:w-56 sm:flex-none"
          />
          <button
            onClick={() => saveName(identity)}
            disabled={!editName.trim() || busy}
            className="rounded-md bg-bjerke-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-bjerke-blue-dark disabled:opacity-50"
          >
            {busy ? 'Lagrer …' : 'Lagre'}
          </button>
          <button onClick={() => setEditingId(null)} className="px-1 text-xs text-gray-600 hover:underline">
            Avbryt
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={() => startEdit(identity)}
        className="text-left hover:underline"
        title="Endre navnet mottakeren ser"
      >
        {identity.displayName}
      </button>
    );
  }

  function renderToggle(identity: SenderIdentity) {
    return (
      <button
        onClick={() => toggleActive(identity)}
        disabled={busyId !== null}
        role="switch"
        aria-checked={identity.active}
        aria-label={`${identity.email} er ${identity.active ? 'på' : 'av'}`}
        className={`inline-flex min-h-7 items-center rounded-full px-2.5 py-0.5 text-xs font-medium disabled:opacity-50 ${
          identity.active
            ? 'bg-green-100 text-green-800 hover:bg-green-200'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
        title={identity.active ? 'Klikk for å slå av avsenderen' : 'Klikk for å slå på avsenderen'}
      >
        {identity.active ? 'På' : 'Av'}
      </button>
    );
  }

  function renderDelete(identity: SenderIdentity) {
    if (!canManage) return null;
    const busy = busyId === identity.id;
    if (confirmDeleteId === identity.id) {
      return (
        <span className="inline-flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-600">Slette {identity.email} for godt?</span>
          <button
            onClick={() => remove(identity.id)}
            disabled={busy}
            className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Sletter …' : 'Ja, slett'}
          </button>
          <button onClick={() => setConfirmDeleteId(null)} disabled={busy} className="text-gray-600 hover:underline">
            Avbryt
          </button>
        </span>
      );
    }
    return (
      <button
        onClick={() => {
          setEditingId(null);
          setConfirmDeleteId(identity.id);
        }}
        disabled={busyId !== null}
        className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
        title={
          identity.sendCount > 0 ? 'Avsendere som har sendt e-post, kan ikke slettes — slå den av i stedet' : undefined
        }
      >
        Slett
      </button>
    );
  }

  const loginLabel = (identity: SenderIdentity) =>
    identity.hasUserAccount ? (
      <span className="text-green-700" title="Det finnes en innlogging med samme e-post, så svar kan fordeles til denne personen">
        Ja
      </span>
    ) : (
      <span className="text-gray-500" title="Ingen innlogging med denne e-posten">
        Nei
      </span>
    );

  return (
    <div>
      <CrmTabs
        actions={
          canManage && !loading && !loadError ? (
            <button
              type="button"
              onClick={() => (showAdd ? closeAddForm() : openAddForm())}
              aria-expanded={showAdd}
              aria-controls="ny-avsender"
              className="inline-flex items-center gap-2 bg-bjerke-blue text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-bjerke-blue-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue focus-visible:ring-offset-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Legg til avsender
            </button>
          ) : undefined
        }
      />
      <div className="max-w-5xl space-y-6">
        <p className="text-sm text-gray-600">
          Du velger avsender i hver e-post i en e-postflyt. En avsender som er slått av, kan ikke velges, og
          e-poster som bruker den, blir ikke sendt.
        </p>

        <div className="border border-amber-300 bg-amber-50 rounded-lg p-4 text-sm text-amber-900 space-y-1">
          <p className="font-semibold">Før du legger til en ny adresse</p>
          <p>
            IT-leverandøren (Basefarm/Orange) må først godkjenne adressen for utsending. Gjør de ikke det, kommer
            ikke e-postene fram. Spør dem før du tar adressen i bruk.
          </p>
          <p className="flex flex-wrap items-center">
            Svar på e-postene går alltid til <span className="mx-1 font-medium">registrering@bjerke.no</span>,
            uansett hvilken avsender som er valgt.
            <HelpTip label="Avsender og svar-til">
              Avsenderen er navnet og adressen mottakeren ser i innboksen, f.eks. «Kari på Bjerke». Trykker mottakeren
              «Svar», havner svaret likevel i registrering@bjerke.no, så ingenting forsvinner.
            </HelpTip>
          </p>
          <details className="pt-1 text-xs text-amber-800">
            <summary className="cursor-pointer">Teknisk (for IT)</summary>
            <p className="mt-1">
              Adressen må verifiseres som avsender i Azure Communication Services, med SPF og DKIM for domenet.
            </p>
          </details>
        </div>

        {canManage && showAdd && !loading && !loadError && (
          <section id="ny-avsender" aria-labelledby="ny-avsender-heading" className="rounded-lg border border-bjerke-blue/30 bg-white p-4 shadow-sm">
            <h3 id="ny-avsender-heading" className="mb-3 text-sm font-semibold">Legg til avsender</h3>
            <form onSubmit={create} className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1 text-xs font-medium text-gray-600">
                E-postadresse
                <input
                  ref={newEmailRef}
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && closeAddForm()}
                  placeholder={emailPlaceholder}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-normal text-gray-900"
                />
              </label>
              <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-xs font-medium text-gray-600">
                Navn mottakeren ser
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && closeAddForm()}
                  placeholder="F.eks. Kari på Bjerke"
                  maxLength={200}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-normal text-gray-900"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeAddForm}
                  disabled={creating}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Avbryt
                </button>
                <button
                  type="submit"
                  disabled={!newEmail.trim() || !newName.trim() || creating}
                  className="rounded-md bg-bjerke-blue px-4 py-2 text-sm font-medium text-white hover:bg-bjerke-blue-dark disabled:opacity-50"
                >
                  {creating ? 'Legger til …' : 'Legg til avsender'}
                </button>
              </div>
              {domainHint && <p className="w-full text-xs text-gray-500">Adressen må slutte på: {domainHint}</p>}
            </form>
          </section>
        )}

        {loading ? (
          <TableSkeleton rows={7} cols={5} />
        ) : loadError ? (
          <EmptyState
            title="Kunne ikke hente avsenderne"
            description="Noe gikk galt da avsenderadressene skulle hentes. Ingenting er endret — prøv igjen."
            action={{ label: 'Prøv igjen', onClick: () => load() }}
          />
        ) : identities.length === 0 ? (
          showAdd ? null : (
            <EmptyState
              title="Ingen avsendere ennå"
              description="E-postflytene trenger minst én avsender. Legg til en adresse som IT-leverandøren har godkjent."
              action={canManage ? { label: 'Legg til avsender', onClick: openAddForm } : undefined}
            />
          )
        ) : (
          <>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 md:hidden">
              {identities.map((identity) => (
                <li key={identity.id} className={`px-4 py-3 text-sm ${identity.active ? '' : 'text-gray-500'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-all font-medium">{identity.email}</span>
                    {renderToggle(identity)}
                  </div>
                  <div className="mt-1">{renderName(identity)}</div>
                  <p className="mt-1 text-xs text-gray-500">
                    <span className="tabular-nums">{identity.sendCount}</span> e-poster sendt · Kan logge inn: {loginLabel(identity)}
                  </p>
                  {canManage && <div className="mt-2">{renderDelete(identity)}</div>}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-lg border border-gray-200 md:block">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">E-post</th>
                    <th className="px-4 py-2 font-medium">Navn mottakeren ser</th>
                    <th className="px-4 py-2 font-medium">Kan logge inn</th>
                    <th className="px-4 py-2 font-medium text-right">E-poster sendt</th>
                    <th className="px-4 py-2 font-medium">På/av</th>
                    <th className="px-4 py-2"><span className="sr-only">Handlinger</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {identities.map((identity) => (
                    <tr key={identity.id} className={identity.active ? '' : 'text-gray-500'}>
                      <td className="px-4 py-2 font-medium">{identity.email}</td>
                      <td className="px-4 py-2">{renderName(identity)}</td>
                      <td className="px-4 py-2 text-xs">{loginLabel(identity)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{identity.sendCount}</td>
                      <td className="px-4 py-2">{renderToggle(identity)}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{renderDelete(identity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
