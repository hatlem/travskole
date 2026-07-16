'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { useToast } from '@/components/admin/Toast';

interface Segment { id: number; name: string; rules: string }
interface List { id: number; name: string; memberCount: number }
interface Suppression { id: number; email: string; reason: string; createdAt: string }
interface Rule { field: string; op: string; value: string }
interface ContactSearchResult { id: number; name: string; email: string | null }

const FIELDS: Array<{
  value: string;
  label: string;
  allowedOps: Array<'eq' | 'neq' | 'contains' | 'lt' | 'gt' | 'is_null' | 'not_null'>;
}> = [
  { value: 'stage', label: 'Stadium', allowedOps: ['eq', 'neq', 'contains', 'is_null', 'not_null'] },
  { value: 'source', label: 'Kilde', allowedOps: ['eq', 'neq', 'contains', 'is_null', 'not_null'] },
  { value: 'email', label: 'E-post', allowedOps: ['eq', 'neq', 'contains', 'is_null', 'not_null'] },
  { value: 'tags', label: 'Tagg', allowedOps: ['contains', 'is_null', 'not_null'] },
  { value: 'deal.eventType', label: 'Deal: arrangementstype', allowedOps: ['eq', 'neq', 'contains', 'is_null', 'not_null'] },
  { value: 'deal.eventDate', label: 'Deal: dato', allowedOps: ['lt', 'gt', 'is_null', 'not_null'] },
  { value: 'deal.status', label: 'Deal: status', allowedOps: ['eq', 'neq', 'contains', 'is_null', 'not_null'] },
];

const ALL_OPS = [
  { value: 'eq', label: 'er' },
  { value: 'neq', label: 'er ikke' },
  { value: 'contains', label: 'inneholder' },
  { value: 'lt', label: 'før/mindre enn' },
  { value: 'gt', label: 'etter/større enn' },
  { value: 'is_null', label: 'mangler' },
  { value: 'not_null', label: 'finnes' },
];

function getAllowedOpsForField(fieldValue: string): typeof ALL_OPS {
  const field = FIELDS.find((f) => f.value === fieldValue);
  if (!field) return ALL_OPS;
  return ALL_OPS.filter((op) => field.allowedOps.includes(op.value as never));
}

const emptyRule = (): Rule => {
  const defaultField = FIELDS[0];
  const defaultOp = defaultField?.allowedOps?.[0] || 'eq';
  return { field: defaultField?.value || 'stage', op: defaultOp as string, value: '' };
};

export default function SegmenterPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  // Segmenter
  const [segName, setSegName] = useState('');
  const [rules, setRules] = useState<Rule[]>([emptyRule()]);
  const [segmentBusy, setSegmentBusy] = useState(false);
  const [deletingSegmentId, setDeletingSegmentId] = useState<number | null>(null);

  // Lister
  const [listName, setListName] = useState('');
  const [listBusy, setListBusy] = useState(false);
  const [deletingListId, setDeletingListId] = useState<number | null>(null);

  // Medlemskap
  const [memberListId, setMemberListId] = useState<number | null>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<ContactSearchResult[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);
  const memberSearchAbortRef = useRef<AbortController | null>(null);

  // Suppresjon
  const [suppressEmail, setSuppressEmail] = useState('');
  const [suppressBusy, setSuppressBusy] = useState(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const [segRes, listRes, supRes] = await Promise.all([
        fetch('/api/admin/crm/segments', { signal: controller.signal }),
        fetch('/api/admin/crm/lists', { signal: controller.signal }),
        fetch('/api/admin/crm/suppressions', { signal: controller.signal }),
      ]);
      if (!segRes.ok || !listRes.ok || !supRes.ok) {
        throw new Error('Kunne ikke laste segmenter, lister og suppresjoner');
      }
      const [segData, listData, supData] = await Promise.all([
        segRes.json(), listRes.json(), supRes.json(),
      ]);
      setSegments(segData.segments || []);
      setLists(listData.lists || []);
      setSuppressions(supData.suppressions || []);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      toast(err instanceof Error ? err.message : 'Kunne ikke laste data', 'error');
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const rulesValid = rules.every(
    (r) => r.field && r.op && (r.op === 'is_null' || r.op === 'not_null' || r.value.trim() !== ''),
  );

  async function createSegment() {
    if (!segName.trim() || !rulesValid || segmentBusy) return;
    const cleaned = rules
      .filter((r) => r.field && r.op)
      .map((r) => ({
        field: r.field,
        op: r.op,
        ...(r.op === 'is_null' || r.op === 'not_null' ? {} : { value: r.value.trim() }),
      }));

    setSegmentBusy(true);
    try {
      const res = await fetch('/api/admin/crm/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: segName.trim(), rules: JSON.stringify({ all: cleaned }) }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke opprette segment', 'error');
        return;
      }
      toast('Segment opprettet', 'success');
      setSegName('');
      setRules([emptyRule()]);
      await load();
    } catch {
      toast('Kunne ikke opprette segment', 'error');
    } finally {
      setSegmentBusy(false);
    }
  }

  async function deleteSegment(id: number) {
    if (deletingSegmentId !== null) return;
    if (!confirm('Er du sikker på at du vil slette dette segmentet?')) return;

    setDeletingSegmentId(id);
    try {
      const res = await fetch(`/api/admin/crm/segments/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Kunne ikke slette segment', 'error');
        return;
      }
      toast('Segment slettet', 'success');
      await load();
    } catch {
      toast('Kunne ikke slette segment', 'error');
    } finally {
      setDeletingSegmentId(null);
    }
  }

  async function createList() {
    if (!listName.trim() || listBusy) return;
    setListBusy(true);
    try {
      const res = await fetch('/api/admin/crm/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: listName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke opprette liste', 'error');
        return;
      }
      toast('Liste opprettet', 'success');
      setListName('');
      await load();
    } catch {
      toast('Kunne ikke opprette liste', 'error');
    } finally {
      setListBusy(false);
    }
  }

  async function deleteList(id: number) {
    if (deletingListId !== null) return;
    if (!confirm('Er du sikker på at du vil slette denne listen? Alle medlemskap fjernes.')) return;

    setDeletingListId(id);
    try {
      const res = await fetch(`/api/admin/crm/lists/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Kunne ikke slette liste', 'error');
        return;
      }
      toast('Liste slettet', 'success');
      if (memberListId === id) closeMemberPanel();
      await load();
    } catch {
      toast('Kunne ikke slette liste', 'error');
    } finally {
      setDeletingListId(null);
    }
  }

  function closeMemberPanel() {
    memberSearchAbortRef.current?.abort();
    setMemberListId(null);
    setMemberQuery('');
    setMemberResults([]);
    setSelectedContactIds([]);
  }

  function toggleMemberPanel(id: number) {
    if (memberListId === id) {
      closeMemberPanel();
      return;
    }
    memberSearchAbortRef.current?.abort();
    setMemberListId(id);
    setMemberQuery('');
    setMemberResults([]);
    setSelectedContactIds([]);
  }

  const searchMembers = useCallback(async (query: string) => {
    memberSearchAbortRef.current?.abort();
    if (!query.trim()) {
      setMemberResults([]);
      return;
    }
    const controller = new AbortController();
    memberSearchAbortRef.current = controller;
    setMemberSearching(true);
    try {
      const params = new URLSearchParams({ q: query.trim() });
      const res = await fetch(`/api/admin/crm/contacts?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke søke etter kontakter');
      const data = await res.json();
      setMemberResults(data.contacts || []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      toast(err instanceof Error ? err.message : 'Kunne ikke søke etter kontakter', 'error');
    } finally {
      if (memberSearchAbortRef.current === controller) {
        setMemberSearching(false);
      }
    }
  }, [toast]);

  useEffect(() => {
    if (memberListId === null) return;
    const t = setTimeout(() => searchMembers(memberQuery), memberQuery ? 300 : 0);
    return () => clearTimeout(t);
  }, [memberQuery, memberListId, searchMembers]);

  useEffect(() => {
    return () => memberSearchAbortRef.current?.abort();
  }, []);

  function toggleSelectedContact(id: number) {
    setSelectedContactIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function addMembers() {
    if (memberListId === null || selectedContactIds.length === 0 || addingMembers) return;
    setAddingMembers(true);
    try {
      const res = await fetch(`/api/admin/crm/lists/${memberListId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: selectedContactIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke legge til medlemmer', 'error');
        return;
      }
      toast(`${data.added} kontakt${data.added === 1 ? '' : 'er'} lagt til i listen`, 'success');
      setSelectedContactIds([]);
      setMemberQuery('');
      setMemberResults([]);
      await load();
    } catch {
      toast('Kunne ikke legge til medlemmer', 'error');
    } finally {
      setAddingMembers(false);
    }
  }

  async function addSuppression() {
    if (!suppressEmail.trim() || suppressBusy) return;
    setSuppressBusy(true);
    try {
      const res = await fetch('/api/admin/crm/suppressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: suppressEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Ugyldig e-post', 'error');
        return;
      }
      toast('Lagt til i ikke-kontakt-listen', 'success');
      setSuppressEmail('');
      await load();
    } catch {
      toast('Kunne ikke legge til i ikke-kontakt-listen', 'error');
    } finally {
      setSuppressBusy(false);
    }
  }

  async function removeSuppression(email: string) {
    if (removingEmail !== null) return;
    setRemovingEmail(email);
    try {
      const res = await fetch(`/api/admin/crm/suppressions?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Kunne ikke fjerne fra ikke-kontakt-listen', 'error');
        return;
      }
      toast('Fjernet fra ikke-kontakt-listen', 'success');
      await load();
    } catch {
      toast('Kunne ikke fjerne fra ikke-kontakt-listen', 'error');
    } finally {
      setRemovingEmail(null);
    }
  }

  if (loading) {
    return (
      <div>
        <CrmTabs />
        <TableSkeleton rows={6} cols={3} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <CrmTabs />
        <EmptyState
          title="Kunne ikke laste data"
          description="Noe gikk galt under henting av segmenter, lister og suppresjoner. Prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      </div>
    );
  }

  return (
    <div>
      <CrmTabs />
      <div className="grid md:grid-cols-2 gap-8 max-w-5xl">
        <section>
          <h2 className="font-semibold mb-3">Segmenter</h2>
          <p className="text-sm text-gray-500 mb-3">
            Dynamiske utvalg av kontakter, f.eks. «booket julebord i fjor». Brukes som filter i kontaktlisten
            og senere som målgruppe for automatiske flyter.
          </p>
          <div className="border border-gray-200 rounded-lg p-4 mb-4 space-y-3">
            <input
              value={segName}
              onChange={(e) => setSegName(e.target.value)}
              placeholder="Navn, f.eks. Julebord 2025"
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full"
            />
            {rules.map((rule, i) => {
              const allowedOps = getAllowedOpsForField(rule.field);
              const opIsAllowed = allowedOps.some((o) => o.value === rule.op);
              const effectiveOp = opIsAllowed ? rule.op : allowedOps[0]?.value || 'eq';

              return (
                <div key={i} className="flex gap-2 items-center">
                  <select
                    value={rule.field}
                    onChange={(e) => {
                      const newField = e.target.value;
                      const newAllowedOps = getAllowedOpsForField(newField);
                      const newOp = newAllowedOps[0]?.value || 'eq';
                      setRules(rules.map((r, j) => (j === i ? { ...r, field: newField, op: newOp } : r)));
                    }}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                  >
                    {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                  <select
                    value={effectiveOp}
                    onChange={(e) => setRules(rules.map((r, j) => (j === i ? { ...r, op: e.target.value } : r)))}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                  >
                    {allowedOps.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {effectiveOp !== 'is_null' && effectiveOp !== 'not_null' && (
                    <input
                      value={rule.value}
                      onChange={(e) => setRules(rules.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                      placeholder="verdi"
                      className="border border-gray-300 rounded-md px-2 py-1.5 text-sm flex-1"
                    />
                  )}
                  {rules.length > 1 && (
                    <button
                      onClick={() => setRules(rules.filter((_, j) => j !== i))}
                      className="text-gray-400 hover:text-red-600 text-sm"
                      aria-label="Fjern regel"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            <div className="flex gap-2">
              <button
                onClick={() => setRules([...rules, emptyRule()])}
                className="text-sm text-blue-700 hover:underline"
              >
                + Legg til regel
              </button>
              <button
                onClick={createSegment}
                disabled={!segName.trim() || !rulesValid || segmentBusy}
                className="ml-auto bg-blue-600 text-white px-4 py-1.5 rounded-md text-sm disabled:opacity-50"
              >
                {segmentBusy ? 'Lagrer …' : 'Lagre segment'}
              </button>
            </div>
          </div>
          {segments.length === 0 ? (
            <p className="text-sm text-gray-400">Ingen segmenter opprettet ennå.</p>
          ) : (
            <ul className="space-y-2">
              {segments.map((s) => (
                <li key={s.id} className="border border-gray-200 rounded-lg p-3 text-sm flex items-center justify-between">
                  <span className="font-medium">{s.name}</span>
                  <button
                    onClick={() => deleteSegment(s.id)}
                    disabled={deletingSegmentId === s.id}
                    className="text-gray-400 hover:text-red-600 text-xs disabled:opacity-50"
                  >
                    {deletingSegmentId === s.id ? 'Sletter …' : 'Slett'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-8">
          <section>
            <h2 className="font-semibold mb-3">Lister</h2>
            <div className="flex gap-2 mb-3">
              <input
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="Ny liste …"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm flex-1"
              />
              <button
                onClick={createList}
                disabled={!listName.trim() || listBusy}
                className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
              >
                {listBusy ? 'Oppretter …' : 'Opprett'}
              </button>
            </div>
            {lists.length === 0 ? (
              <p className="text-sm text-gray-400">Ingen lister opprettet ennå.</p>
            ) : (
              <ul className="space-y-2">
                {lists.map((l) => (
                  <li key={l.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{l.name}</span>
                      <span className="text-gray-500 text-xs">{l.memberCount} kontakter</span>
                    </div>
                    <div className="flex gap-3 mt-2">
                      <button
                        onClick={() => toggleMemberPanel(l.id)}
                        className="text-xs text-blue-700 hover:underline"
                      >
                        {memberListId === l.id ? 'Lukk' : 'Administrer medlemmer'}
                      </button>
                      <button
                        onClick={() => deleteList(l.id)}
                        disabled={deletingListId === l.id}
                        className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                      >
                        {deletingListId === l.id ? 'Sletter …' : 'Slett liste'}
                      </button>
                    </div>

                    {memberListId === l.id && (
                      <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                        <input
                          type="search"
                          value={memberQuery}
                          onChange={(e) => setMemberQuery(e.target.value)}
                          placeholder="Søk navn, e-post, telefon …"
                          className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-full"
                        />
                        {selectedContactIds.length > 0 && (
                          <p className="text-xs text-gray-500">{selectedContactIds.length} valgt</p>
                        )}
                        {memberSearching ? (
                          <p className="text-xs text-gray-400">Søker …</p>
                        ) : memberQuery.trim() && memberResults.length === 0 ? (
                          <p className="text-xs text-gray-400">Ingen kontakter funnet.</p>
                        ) : memberResults.length > 0 ? (
                          <ul className="max-h-40 overflow-y-auto border border-gray-100 rounded-md divide-y divide-gray-100">
                            {memberResults.map((c) => (
                              <li key={c.id}>
                                <label className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-gray-50 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={selectedContactIds.includes(c.id)}
                                    onChange={() => toggleSelectedContact(c.id)}
                                  />
                                  <span className="font-medium">{c.name}</span>
                                  <span className="text-gray-400">{c.email ?? '—'}</span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <button
                          onClick={addMembers}
                          disabled={selectedContactIds.length === 0 || addingMembers}
                          className="bg-gray-800 text-white px-3 py-1.5 rounded-md text-xs disabled:opacity-50"
                        >
                          {addingMembers ? 'Legger til …' : 'Legg til i liste'}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-semibold mb-3">Ikke kontakt (suppression)</h2>
            <p className="text-sm text-gray-500 mb-3">
              E-poster her mottar ALDRI utsendelser — respekteres av alt som sendes fra plattformen.
            </p>
            <div className="flex gap-2 mb-3">
              <input
                type="email"
                value={suppressEmail}
                onChange={(e) => setSuppressEmail(e.target.value)}
                placeholder="epost@eksempel.no"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm flex-1"
              />
              <button
                onClick={addSuppression}
                disabled={!suppressEmail.trim() || suppressBusy}
                className="bg-gray-800 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
              >
                {suppressBusy ? 'Legger til …' : 'Legg til'}
              </button>
            </div>
            {suppressions.length === 0 ? (
              <p className="text-sm text-gray-400">Ingen e-poster i ikke-kontakt-listen.</p>
            ) : (
              <ul className="space-y-1">
                {suppressions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100">
                    <span>{s.email} <span className="text-gray-400 text-xs">({s.reason})</span></span>
                    <button
                      onClick={() => removeSuppression(s.email)}
                      disabled={removingEmail === s.email}
                      className="text-gray-400 hover:text-red-600 text-xs disabled:opacity-50"
                    >
                      {removingEmail === s.email ? 'Fjerner …' : 'Fjern'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
