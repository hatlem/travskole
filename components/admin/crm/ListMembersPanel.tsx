'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/admin/Toast';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { Pagination } from '@/components/admin/Pagination';
import { Button } from '@/components/admin/Button';

interface ContactRef {
  id: number;
  name: string;
  email: string | null;
}

interface ListMembersPanelProps {
  listId: number;
  listName: string;
  onChanged: () => void;
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

/** Legg til kontakter i en liste (søk) og se/fjern medlemmene. */
export function ListMembersPanel({ listId, listName, onChanged }: ListMembersPanelProps) {
  const { toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactRef[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);

  const [members, setMembers] = useState<ContactRef[] | null>(null);
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberPage, setMemberPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [membersFailed, setMembersFailed] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<ContactRef | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const loadMembers = useCallback(async (signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams({ listId: String(listId), page: String(memberPage) });
      const res = await fetch(`/api/admin/crm/contacts?${params}`, { signal });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMembers(data.contacts || []);
      setMemberTotal(Number(data.total) || 0);
      setPageSize(Number(data.pageSize) || 50);
      setMembersFailed(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setMembersFailed(true);
    }
  }, [listId, memberPage]);

  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(() => loadMembers(controller.signal), 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [loadMembers]);

  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/crm/contacts?${new URLSearchParams({ q: query.trim() })}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setResults(data.contacts || []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        toast('Søket virket ikke akkurat nå. Prøv igjen.', 'error');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, toast]);

  const memberIds = new Set((members ?? []).map((m) => m.id));
  const visibleResults = query.trim() ? results : [];

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function add() {
    if (selected.length === 0 || adding) return;
    setAdding(true);
    try {
      const { res, data } = await requestJson(`/api/admin/crm/lists/${listId}`, 'POST', { contactIds: selected });
      if (!res.ok) {
        toast(data.error || 'Kunne ikke legge kontaktene i listen. Prøv igjen.', 'error');
        return;
      }
      const already = data.alreadyMember > 0 ? ` (${data.alreadyMember} var allerede med)` : '';
      toast(`${data.added} kontakt${data.added === 1 ? '' : 'er'} lagt i «${listName}»${already}`, 'success');
      setSelected([]);
      setQuery('');
      setResults([]);
      await loadMembers();
      onChanged();
    } catch {
      toast('Kunne ikke legge kontaktene i listen. Prøv igjen.', 'error');
    } finally {
      setAdding(false);
    }
  }

  async function remove() {
    if (!pendingRemove || removing) return;
    setRemoving(true);
    try {
      const { res, data } = await requestJson(`/api/admin/crm/lists/${listId}/members`, 'DELETE', {
        contactIds: [pendingRemove.id],
      });
      if (!res.ok) {
        toast(data.error || 'Kunne ikke ta kontakten ut av listen. Prøv igjen.', 'error');
        return;
      }
      toast(`${pendingRemove.name} er fjernet fra «${listName}»`, 'success');
      if (members?.length === 1 && memberPage > 1) setMemberPage(memberPage - 1);
      else await loadMembers();
      onChanged();
    } catch {
      toast('Kunne ikke ta kontakten ut av listen. Prøv igjen.', 'error');
    } finally {
      setRemoving(false);
      setPendingRemove(null);
    }
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3 space-y-4">
      <div className="space-y-2">
        <label htmlFor={`list-${listId}-search`} className="block text-xs font-medium text-gray-700">
          Legg til kontakter
        </label>
        <input
          ref={searchRef}
          id={`list-${listId}-search`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Skriv navn, e-post eller telefon …"
          className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-full"
        />
        {searching ? (
          <p className="text-xs text-gray-400">Søker …</p>
        ) : query.trim() && visibleResults.length === 0 ? (
          <p className="text-xs text-gray-400">Fant ingen kontakter. Prøv bare fornavn eller en del av e-posten.</p>
        ) : visibleResults.length > 0 ? (
          <ul className="max-h-48 overflow-y-auto border border-gray-100 rounded-md divide-y divide-gray-100">
            {visibleResults.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={memberIds.has(c.id) || selected.includes(c.id)}
                    disabled={memberIds.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <span className="font-medium">{c.name}</span>
                  <span className="text-gray-400 min-w-0 truncate">{c.email ?? '—'}</span>
                  {memberIds.has(c.id) && <span className="ml-auto text-gray-400">allerede med</span>}
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={add}
            disabled={selected.length === 0}
            loading={adding}
            loadingLabel="Legger til …"
          >
            {selected.length > 0 ? `Legg ${selected.length} i listen` : 'Legg i listen'}
          </Button>
          <span className="text-xs text-gray-500">
            Flyter som starter når noen «legges i en liste», starter for disse kontaktene.
          </span>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-700 mb-1">I listen nå ({memberTotal})</p>
        {membersFailed ? (
          <p className="text-xs text-red-600">Kunne ikke hente kontaktene i listen. Lukk og åpne listen igjen.</p>
        ) : members === null ? (
          <p className="text-xs text-gray-400">Henter …</p>
        ) : members.length === 0 ? (
          <p className="text-xs text-gray-500">Listen er tom. Søk opp kontakter over for å legge dem til.</p>
        ) : (
          <ul className="border border-gray-100 rounded-md divide-y divide-gray-100">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                <Link href={`/admin/crm/kontakter/${m.id}`} className="font-medium text-blue-700 hover:underline">
                  {m.name}
                </Link>
                <span className="text-gray-400 min-w-0 truncate">{m.email ?? '—'}</span>
                <Button
                  variant="dangerText"
                  size="sm"
                  onClick={() => setPendingRemove(m)}
                  className="ml-auto"
                  aria-label={`Fjern ${m.name} fra listen`}
                >
                  Fjern
                </Button>
              </li>
            ))}
          </ul>
        )}
        {memberTotal > pageSize && (
          <Pagination total={memberTotal} page={memberPage} perPage={pageSize} onChange={setMemberPage} />
        )}
      </div>

      <ConfirmModal
        open={pendingRemove !== null}
        title="Fjerne fra listen?"
        message={`${pendingRemove?.name ?? ''} tas ut av «${listName}». Kontakten slettes ikke. E-postflyter som starter «når noen fjernes fra en liste», kan starte.`}
        confirmLabel="Fjern"
        variant="warning"
        loading={removing}
        onConfirm={remove}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
