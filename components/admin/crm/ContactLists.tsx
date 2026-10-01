'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useToast } from '@/components/admin/Toast';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { formatDateNo } from '@/lib/crm/format-date';
import { usePopoverDismiss } from './usePopover';

export interface ContactListMembershipRow {
  id: number;
  name: string;
  addedAt: string;
}

interface ListOption {
  id: number;
  name: string;
}

interface ContactListsProps {
  contactId: number;
  contactName: string;
  lists: ContactListMembershipRow[];
  onChanged: () => void;
  /** Styrt utenfra så f.eks. segment-hjelpeteksten kan åpne listevelgeren. */
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
}

async function requestJson(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

const SEARCH_THRESHOLD = 6;

/** Kontaktens CRM-lister: vis, legg i liste via en velger (ev. en ny liste) og fjern. */
export function ContactLists({ contactId, contactName, lists, onChanged, pickerOpen, onPickerOpenChange }: ContactListsProps) {
  const { toast } = useToast();
  const [allLists, setAllLists] = useState<ListOption[] | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<ContactListMembershipRow | null>(null);
  const [removing, setRemoving] = useState(false);
  const popoverId = useId();

  const close = useCallback(() => {
    onPickerOpenChange(false);
    setCreating(false);
    setNewName('');
    setQuery('');
  }, [onPickerOpenChange]);
  const { containerRef, triggerRef } = usePopoverDismiss<HTMLDivElement>(pickerOpen, close);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/admin/crm/lists', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data) => setAllLists(Array.isArray(data.lists) ? data.lists : []))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setAllLists([]);
      });
    return () => controller.abort();
  }, []);

  const memberOf = new Set(lists.map((l) => l.id));
  const available = (allLists ?? []).filter((l) => !memberOf.has(l.id));
  const q = query.trim().toLowerCase();
  const shown = q ? available.filter((l) => l.name.toLowerCase().includes(q)) : available;

  async function addTo(target: ListOption) {
    const { res, data } = await requestJson(`/api/admin/crm/lists/${target.id}`, 'POST', { contactIds: [contactId] });
    if (!res.ok) {
      toast(data.error || 'Kunne ikke legge kontakten i listen. Prøv igjen.', 'error');
      return false;
    }
    toast(data.added > 0 ? `Lagt i listen «${target.name}»` : `Kontakten er allerede i «${target.name}»`, data.added > 0 ? 'success' : 'info');
    onChanged();
    return true;
  }

  async function pick(target: ListOption) {
    if (busy) return;
    setBusy(true);
    try {
      if (await addTo(target)) close();
    } catch {
      toast('Kunne ikke legge kontakten i listen. Prøv igjen.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (busy || !name) return;
    setBusy(true);
    try {
      const { res, data } = await requestJson('/api/admin/crm/lists', 'POST', { name });
      if (!res.ok) {
        toast(data.error || 'Kunne ikke lage listen. Prøv et annet navn, eller prøv igjen.', 'error');
        return;
      }
      const target: ListOption = { id: data.list.id, name: data.list.name };
      setAllLists((prev) => [...(prev ?? []), target].sort((a, b) => a.name.localeCompare(b.name, 'nb')));
      if (await addTo(target)) close();
    } catch {
      toast('Kunne ikke lage listen. Prøv igjen.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!pendingRemove || removing) return;
    setRemoving(true);
    try {
      const { res, data } = await requestJson(`/api/admin/crm/lists/${pendingRemove.id}/members`, 'DELETE', {
        contactIds: [contactId],
      });
      if (!res.ok) {
        toast(data.error || 'Kunne ikke ta kontakten ut av listen. Prøv igjen.', 'error');
        return;
      }
      toast(`Tatt ut av «${pendingRemove.name}»`, 'success');
      onChanged();
    } catch {
      toast('Kunne ikke ta kontakten ut av listen. Prøv igjen.', 'error');
    } finally {
      setRemoving(false);
      setPendingRemove(null);
    }
  }

  return (
    <div className="space-y-3">
      {lists.length === 0 ? (
        <p className="text-sm text-gray-500">Ikke med i noen lister ennå.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {lists.map((l) => (
            <li
              key={l.id}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-0.5 pl-2.5 pr-1 text-xs text-blue-800"
              title={`Lagt til ${formatDateNo(l.addedAt)}`}
            >
              {l.name}
              <button
                type="button"
                onClick={() => setPendingRemove(l)}
                aria-label={`Fjern fra ${l.name}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-blue-500 hover:bg-blue-100 hover:text-red-600"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (pickerOpen ? close() : onPickerOpenChange(true))}
          aria-expanded={pickerOpen}
          aria-controls={popoverId}
          aria-haspopup="dialog"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Legg i liste
        </button>

        {pickerOpen && (
          <div
            ref={containerRef}
            id={popoverId}
            role="dialog"
            aria-label="Velg liste"
            className="absolute left-0 z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
          >
            {allLists === null ? (
              <p className="px-2 py-2 text-sm text-gray-400">Laster lister …</p>
            ) : (
              <>
                {available.length > SEARCH_THRESHOLD && (
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Søk i listene"
                    aria-label="Søk i listene"
                    autoFocus
                    className="mb-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                )}
                {shown.length > 0 ? (
                  <ul className="max-h-56 overflow-y-auto">
                    {shown.map((l, i) => (
                      <li key={l.id}>
                        <button
                          type="button"
                          onClick={() => pick(l)}
                          disabled={busy}
                          autoFocus={i === 0 && available.length <= SEARCH_THRESHOLD}
                          className="w-full rounded-md px-2 py-2 text-left text-sm text-gray-800 hover:bg-gray-50 focus:bg-gray-50 disabled:opacity-50"
                        >
                          {l.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    {available.length === 0
                      ? (allLists.length === 0 ? 'Du har ingen lister ennå.' : 'Kontakten er med i alle listene.')
                      : 'Ingen lister passer søket.'}
                  </p>
                )}

                <div className="mt-1 border-t border-gray-100 pt-2">
                  {creating ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => { e.preventDefault(); createAndAdd(); }}
                    >
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Navn på listen"
                        aria-label="Navn på ny liste"
                        maxLength={200}
                        autoFocus
                        className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      />
                      <button
                        type="submit"
                        disabled={busy || !newName.trim()}
                        className="whitespace-nowrap rounded-md bg-bjerke-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-bjerke-blue-dark disabled:opacity-50"
                      >
                        {busy ? 'Lager …' : 'Lag og legg til'}
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCreating(true)}
                      className="w-full rounded-md px-2 py-2 text-left text-sm text-bjerke-blue hover:bg-gray-50"
                    >
                      + Lag en ny liste
                    </button>
                  )}
                </div>
                <p className="mt-2 px-2 text-[11px] text-gray-500">
                  Aktive flyter med startregelen «Lagt til i CRM-liste» starter når kontakten legges i listen.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={pendingRemove !== null}
        title="Fjerne fra listen?"
        message={`${contactName} tas ut av «${pendingRemove?.name ?? ''}». Kontakten slettes ikke. E-postflyter som allerede er i gang, fortsetter, men flyter som starter «når noen fjernes fra en liste», kan starte.`}
        confirmLabel="Fjern"
        variant="warning"
        loading={removing}
        onConfirm={remove}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
