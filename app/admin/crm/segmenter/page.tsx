'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { useToast } from '@/components/admin/Toast';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { isSuperAdmin } from '@/lib/settings-shared';
import { describeSegmentRules, parseSegmentRules } from '@/lib/crm/segments';
import { ListMembersPanel } from '@/components/admin/crm/ListMembersPanel';

interface Segment { id: number; name: string; rules: string; memberCount: number }
interface List { id: number; name: string; memberCount: number }
interface Suppression { id: number; email: string; reason: string; createdAt: string }
interface Rule { field: string; op: string; value: string }

function countLabel(n: number): string {
  return `${n} kontakt${n === 1 ? '' : 'er'}`;
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-gray-600">{description}</p>
    </div>
  );
}

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
  const { data: session } = useSession();
  const canRemoveSuppression = isSuperAdmin(session?.user?.role);
  const abortRef = useRef<AbortController | null>(null);

  // Segmenter
  const [segName, setSegName] = useState('');
  const [rules, setRules] = useState<Rule[]>([emptyRule()]);
  const [segmentBusy, setSegmentBusy] = useState(false);
  const [deletingSegmentId, setDeletingSegmentId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'segment' | 'list'; id: number; name: string } | null>(null);

  const [pendingConvert, setPendingConvert] = useState<Segment | null>(null);
  const [converting, setConverting] = useState(false);
  const segNameRef = useRef<HTMLInputElement>(null);

  // Lister
  const [listName, setListName] = useState('');
  const [listBusy, setListBusy] = useState(false);
  const [deletingListId, setDeletingListId] = useState<number | null>(null);
  const [memberListId, setMemberListId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [highlightListId, setHighlightListId] = useState<number | null>(null);
  const listNameRef = useRef<HTMLInputElement>(null);

  // Suppresjon
  const [suppressEmail, setSuppressEmail] = useState('');
  const [suppressBusy, setSuppressBusy] = useState(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [pendingUnsuppress, setPendingUnsuppress] = useState<Suppression | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const [segRes, listRes, supRes] = await Promise.all([
        fetch('/api/admin/crm/segments?counts=1', { signal: controller.signal }),
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

    setDeletingListId(id);
    try {
      const res = await fetch(`/api/admin/crm/lists/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Kunne ikke slette liste', 'error');
        return;
      }
      toast('Liste slettet', 'success');
      if (memberListId === id) setMemberListId(null);
      await load();
    } catch {
      toast('Kunne ikke slette liste', 'error');
    } finally {
      setDeletingListId(null);
    }
  }

  async function renameList() {
    if (!renaming || !renaming.name.trim() || renameBusy) return;
    setRenameBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/lists/${renaming.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renaming.name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Kunne ikke endre navnet', 'error');
        return;
      }
      toast('Navnet er endret', 'success');
      setRenaming(null);
      await load();
    } catch {
      toast('Kunne ikke endre navnet', 'error');
    } finally {
      setRenameBusy(false);
    }
  }

  async function convertSegment() {
    if (!pendingConvert || converting) return;
    setConverting(true);
    try {
      const res = await fetch(`/api/admin/crm/segments/${pendingConvert.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Kunne ikke lage liste av segmentet', 'error');
        return;
      }
      toast(`Listen «${data.list.name}» er laget med ${countLabel(data.added)}`, 'success');
      setHighlightListId(data.list.id);
      await load();
      requestAnimationFrame(() => {
        document.getElementById(`liste-${data.list.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    } catch {
      toast('Kunne ikke lage liste av segmentet', 'error');
    } finally {
      setConverting(false);
      setPendingConvert(null);
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
      <div className="max-w-4xl space-y-10">
        <aside className="rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-gray-800">
          <p className="font-semibold mb-1">Hva er forskjellen?</p>
          <p>
            <strong>Segment:</strong> alle som hadde julebord i fjor – oppdateres av seg selv.{' '}
            <strong>Liste:</strong> en gruppe du setter sammen selv, f.eks. «Inviter til sommerfest».
          </p>
        </aside>

        <section aria-labelledby="segmenter-heading">
          <div id="segmenter-heading">
            <SectionHeading
              title="Segmenter — automatiske grupper basert på regler"
              description="Du lager reglene én gang, så finner systemet hvem som passer. Kontakter kommer og går av seg selv."
            />
          </div>

          {segments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center mb-6">
              <p className="font-medium">Ingen segmenter ennå</p>
              <p className="text-sm text-gray-500 mt-1 mb-3">
                Et segment kan for eksempel være «alle som hadde julebord før 2026».
              </p>
              <button
                type="button"
                onClick={() => segNameRef.current?.focus()}
                className="bg-bjerke-blue text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-bjerke-blue-dark"
              >
                Lag ditt første segment
              </button>
            </div>
          ) : (
            <ul className="space-y-2 mb-6">
              {segments.map((s) => (
                <li key={s.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-medium min-w-0 break-words">{s.name}</span>
                    <span className="text-gray-500 text-xs shrink-0">{countLabel(s.memberCount)} nå</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Regler: {describeSegmentRules(parseSegmentRules(s.rules)).join(' · ')}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
                    <Link href={`/admin/crm/kontakter?segmentId=${s.id}`} className="text-blue-700 font-medium hover:underline">
                      Vis kontakter
                    </Link>
                    <button
                      type="button"
                      onClick={() => setPendingConvert(s)}
                      disabled={s.memberCount === 0}
                      title={s.memberCount === 0 ? 'Segmentet er tomt' : undefined}
                      className="text-blue-700 hover:underline disabled:text-gray-400 disabled:no-underline"
                    >
                      Gjør om til liste
                    </button>
                    <a href={`/api/admin/crm/segments/${s.id}/export`} download className="text-blue-700 hover:underline">
                      Last ned som CSV
                    </a>
                    <button
                      type="button"
                      onClick={() => setPendingDelete({ kind: 'segment', id: s.id, name: s.name })}
                      disabled={deletingSegmentId === s.id}
                      className="ml-auto text-gray-400 hover:text-red-600 disabled:opacity-50"
                    >
                      {deletingSegmentId === s.id ? 'Sletter …' : 'Slett'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold">Lag nytt segment</h3>
            <p className="text-xs text-gray-500">
              Alle reglene må stemme. Regler om deal gjelder samme deal: «arrangementstype er julebord» + «dato
              før 2026-01-01» gir bare kontakter som hadde et julebord før 2026.
            </p>
            <input
              ref={segNameRef}
              value={segName}
              onChange={(e) => setSegName(e.target.value)}
              placeholder="Navn, f.eks. Julebord 2025"
              aria-label="Navn på segmentet"
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full"
            />
            {rules.map((rule, i) => {
              const allowedOps = getAllowedOpsForField(rule.field);
              const opIsAllowed = allowedOps.some((o) => o.value === rule.op);
              const effectiveOp = opIsAllowed ? rule.op : allowedOps[0]?.value || 'eq';

              return (
                <div key={i} className="flex flex-wrap gap-2 items-center">
                  <select
                    value={rule.field}
                    onChange={(e) => {
                      const newField = e.target.value;
                      const newAllowedOps = getAllowedOpsForField(newField);
                      const newOp = newAllowedOps[0]?.value || 'eq';
                      setRules(rules.map((r, j) => (j === i ? { ...r, field: newField, op: newOp } : r)));
                    }}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm max-w-full"
                  >
                    {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                  <select
                    value={effectiveOp}
                    onChange={(e) => setRules(rules.map((r, j) => (j === i ? { ...r, op: e.target.value } : r)))}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm max-w-full"
                  >
                    {allowedOps.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {effectiveOp !== 'is_null' && effectiveOp !== 'not_null' && (
                    <input
                      value={rule.value}
                      onChange={(e) => setRules(rules.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                      placeholder="verdi"
                      className="border border-gray-300 rounded-md px-2 py-1.5 text-sm flex-1 min-w-32"
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
                className="ml-auto bg-bjerke-blue text-white px-4 py-1.5 rounded-md text-sm disabled:opacity-50"
              >
                {segmentBusy ? 'Lagrer …' : 'Lagre segment'}
              </button>
            </div>
          </div>
        </section>

        <section aria-labelledby="lister-heading">
          <div id="lister-heading">
            <SectionHeading
              title="Lister — manuelle grupper du legger kontakter i"
              description="Du bestemmer selv hvem som er med. Ingen kommer inn eller ut av seg selv."
            />
          </div>

          <div className="flex gap-2 mb-4">
            <input
              ref={listNameRef}
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createList()}
              placeholder="Navn på ny liste, f.eks. Inviter til sommerfest"
              aria-label="Navn på ny liste"
              maxLength={200}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm flex-1 min-w-0"
            />
            <button
              onClick={createList}
              disabled={!listName.trim() || listBusy}
              className="bg-bjerke-blue text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            >
              {listBusy ? 'Lager …' : 'Lag liste'}
            </button>
          </div>

          {lists.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center">
              <p className="font-medium">Ingen lister ennå</p>
              <p className="text-sm text-gray-500 mt-1 mb-3">
                Lag en liste og legg inn kontaktene du vil samle, f.eks. de du vil invitere til et arrangement.
              </p>
              <button
                type="button"
                onClick={() => listNameRef.current?.focus()}
                className="bg-bjerke-blue text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-bjerke-blue-dark"
              >
                Lag din første liste
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {lists.map((l) => (
                <li
                  key={l.id}
                  id={`liste-${l.id}`}
                  className={`border rounded-lg p-3 text-sm scroll-mt-4 ${highlightListId === l.id ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'}`}
                >
                  {renaming?.id === l.id ? (
                    <div className="flex flex-wrap gap-2">
                      <input
                        autoFocus
                        value={renaming.name}
                        onChange={(e) => setRenaming({ id: l.id, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') renameList();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        aria-label="Nytt navn på listen"
                        maxLength={200}
                        className="border border-gray-300 rounded-md px-2 py-1 text-sm flex-1 min-w-0"
                      />
                      <button
                        type="button"
                        onClick={renameList}
                        disabled={!renaming.name.trim() || renameBusy}
                        className="bg-bjerke-blue text-white px-3 py-1 rounded-md text-xs disabled:opacity-50"
                      >
                        {renameBusy ? 'Lagrer …' : 'Lagre'}
                      </button>
                      <button type="button" onClick={() => setRenaming(null)} className="text-xs text-gray-600 px-1">
                        Avbryt
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="font-medium min-w-0 break-words">{l.name}</span>
                      <span className="text-gray-500 text-xs shrink-0">{countLabel(l.memberCount)}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setMemberListId(memberListId === l.id ? null : l.id)}
                      aria-expanded={memberListId === l.id}
                      className="text-blue-700 font-medium hover:underline"
                    >
                      {memberListId === l.id ? 'Lukk' : 'Legg til kontakter'}
                    </button>
                    <Link href={`/admin/crm/kontakter?listId=${l.id}`} className="text-blue-700 hover:underline">
                      Vis kontakter
                    </Link>
                    <button
                      type="button"
                      onClick={() => setRenaming({ id: l.id, name: l.name })}
                      className="text-blue-700 hover:underline"
                    >
                      Endre navn
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete({ kind: 'list', id: l.id, name: l.name })}
                      disabled={deletingListId === l.id}
                      className="ml-auto text-gray-400 hover:text-red-600 disabled:opacity-50"
                    >
                      {deletingListId === l.id ? 'Sletter …' : 'Slett'}
                    </button>
                  </div>

                  {memberListId === l.id && (
                    <ListMembersPanel listId={l.id} listName={l.name} onChanged={load} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="ikke-kontakt-heading">
          <div id="ikke-kontakt-heading">
            <SectionHeading
              title="Ikke-kontakt-liste"
              description="E-postadresser her får aldri e-post fra oss – uansett segment, liste eller flyt."
            />
          </div>
          <div className="flex gap-2 mb-3">
            <input
              type="email"
              value={suppressEmail}
              onChange={(e) => setSuppressEmail(e.target.value)}
              placeholder="epost@eksempel.no"
              aria-label="E-postadresse som ikke skal kontaktes"
              className="border border-gray-300 rounded-md px-3 py-2 text-sm flex-1 min-w-0"
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
            <p className="text-sm text-gray-400">Ingen e-postadresser her ennå.</p>
          ) : (
            <ul className="space-y-1">
              {suppressions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 text-sm py-1 border-b border-gray-100">
                  <span className="min-w-0 break-all">{s.email} <span className="text-gray-400 text-xs">({s.reason})</span></span>
                  {canRemoveSuppression && (
                    <button
                      onClick={() => setPendingUnsuppress(s)}
                      disabled={removingEmail === s.email}
                      className="text-gray-400 hover:text-red-600 text-xs disabled:opacity-50"
                    >
                      {removingEmail === s.email ? 'Fjerner …' : 'Fjern'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <ConfirmModal
        open={pendingConvert !== null}
        title="Gjøre segmentet om til en liste?"
        message={`Vi lager en ny liste med de ${countLabel(pendingConvert?.memberCount ?? 0)} som er i «${pendingConvert?.name ?? ''}» akkurat nå. Listen oppdateres ikke av seg selv etterpå, og segmentet blir som før. Flyter som starter når noen blir «Lagt til i CRM-liste», kan starte for disse kontaktene.`}
        confirmLabel="Lag liste"
        variant="warning"
        loading={converting}
        onConfirm={convertSegment}
        onCancel={() => setPendingConvert(null)}
      />
      <ConfirmModal
        open={pendingDelete !== null}
        title={pendingDelete?.kind === 'list' ? 'Slett liste' : 'Slett segment'}
        message={
          pendingDelete?.kind === 'list'
            ? `Slette listen «${pendingDelete.name}»? Kontaktene slettes ikke – bare selve listen.`
            : `Slette segmentet «${pendingDelete?.name ?? ''}»? Kontaktene slettes ikke, men flyter som bruker segmentet, finner ingen lenger.`
        }
        confirmLabel="Slett"
        loading={deletingSegmentId !== null || deletingListId !== null}
        onConfirm={async () => {
          if (!pendingDelete) return;
          if (pendingDelete.kind === 'list') await deleteList(pendingDelete.id);
          else await deleteSegment(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
      <ConfirmModal
        open={pendingUnsuppress !== null}
        title="Fjerne fra ikke-kontakt-listen?"
        message={`${pendingUnsuppress?.email ?? ''} kan da igjen motta e-post fra flyter og utsendelser. Gjør dette bare hvis personen selv har bedt om det${pendingUnsuppress?.reason === 'unsubscribe' ? ' — adressen meldte seg av selv' : ''}.`}
        confirmLabel="Fjern"
        variant="warning"
        loading={removingEmail !== null}
        onConfirm={async () => {
          if (!pendingUnsuppress) return;
          await removeSuppression(pendingUnsuppress.email);
          setPendingUnsuppress(null);
        }}
        onCancel={() => setPendingUnsuppress(null)}
      />
    </div>
  );
}
