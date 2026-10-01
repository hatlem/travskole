'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/admin/Toast';
import { ConfirmModal } from '@/components/admin/ConfirmModal';

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
}

const NEW_LIST = 'new';

async function requestJson(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/** Kontaktens CRM-lister: vis, legg til (ev. i ny liste) og fjern. */
export function ContactLists({ contactId, contactName, lists, onChanged }: ContactListsProps) {
  const { toast } = useToast();
  const [allLists, setAllLists] = useState<ListOption[] | null>(null);
  const [choice, setChoice] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<ContactListMembershipRow | null>(null);
  const [removing, setRemoving] = useState(false);

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
  const creating = choice === NEW_LIST;
  const canAdd = !busy && (creating ? newName.trim() !== '' : choice !== '');

  async function add() {
    if (!canAdd) return;
    setBusy(true);
    try {
      let target: ListOption | null = available.find((l) => String(l.id) === choice) ?? null;
      if (creating) {
        const { res, data } = await requestJson('/api/admin/crm/lists', 'POST', { name: newName.trim() });
        if (!res.ok) {
          toast(data.error || 'Kunne ikke opprette liste', 'error');
          return;
        }
        target = { id: data.list.id, name: data.list.name };
        setAllLists((prev) => [...(prev ?? []), target as ListOption].sort((a, b) => a.name.localeCompare(b.name, 'nb')));
      }
      if (!target) return;

      const { res, data } = await requestJson(`/api/admin/crm/lists/${target.id}`, 'POST', { contactIds: [contactId] });
      if (!res.ok) {
        toast(data.error || 'Kunne ikke legge til i listen', 'error');
        return;
      }
      toast(data.added > 0 ? `Lagt til i «${target.name}»` : `Allerede i «${target.name}»`, data.added > 0 ? 'success' : 'info');
      setChoice('');
      setNewName('');
      onChanged();
    } catch {
      toast('Kunne ikke legge til i listen', 'error');
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
        toast(data.error || 'Kunne ikke fjerne fra listen', 'error');
        return;
      }
      toast(`Fjernet fra «${pendingRemove.name}»`, 'success');
      onChanged();
    } catch {
      toast('Kunne ikke fjerne fra listen', 'error');
    } finally {
      setRemoving(false);
      setPendingRemove(null);
    }
  }

  return (
    <div className="space-y-3">
      {lists.length === 0 ? (
        <p className="text-sm text-gray-500">Ikke med i noen lister ennå. Velg en liste under, eller lag en ny.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {lists.map((l) => (
            <li
              key={l.id}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-800"
              title={`Lagt til ${new Date(l.addedAt).toLocaleDateString('nb-NO')}`}
            >
              {l.name}
              <button
                type="button"
                onClick={() => setPendingRemove(l)}
                aria-label={`Fjern fra ${l.name}`}
                className="text-blue-500 hover:text-red-600"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Velg liste"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          disabled={allLists === null}
          className="border border-gray-300 rounded-md px-2 py-1.5 text-sm flex-1 min-w-[10rem]"
        >
          <option value="">{allLists === null ? 'Laster lister …' : 'Velg liste …'}</option>
          {available.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
          <option value={NEW_LIST}>+ Ny liste …</option>
        </select>
        {creating && (
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Navn på ny liste"
            aria-label="Navn på ny liste"
            maxLength={200}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm flex-1 min-w-[10rem]"
          />
        )}
        <button
          type="button"
          onClick={add}
          disabled={!canAdd}
          className="bg-bjerke-blue text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-bjerke-blue-dark disabled:opacity-50"
        >
          {busy ? 'Legger til …' : 'Legg i liste'}
        </button>
      </div>
      <p className="text-[11px] text-gray-500">
        Aktive flyter med utløseren «Lagt til i CRM-liste» starter når kontakten legges i listen.
      </p>

      <ConfirmModal
        open={pendingRemove !== null}
        title="Fjerne fra listen?"
        message={`Fjerne ${contactName} fra «${pendingRemove?.name ?? ''}»? Løp som allerede er i gang stoppes ikke, men flyter med utløseren «Fjernet fra CRM-liste» kan starte.`}
        confirmLabel="Fjern"
        variant="warning"
        loading={removing}
        onConfirm={remove}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
