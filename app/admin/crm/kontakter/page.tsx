'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';
import { useOpenFromQuery } from '@/components/admin/useOpenFromQuery';
import { HelpTip } from '@/components/admin/HelpTip';
import { Pagination } from '@/components/admin/Pagination';
import { Button, ButtonLink } from '@/components/admin/Button';
import { Badge } from '@/components/admin/StatusBadge';
import { assigneeLabel, useAssignees } from '@/components/admin/crm/useAssignees';
import { formatPhone, formatDateNo } from '@/lib/admin-format';

interface ContactRow {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string;
  source: string;
  tags: string[];
  organization: { id: number; name: string } | null;
  owner: { id: number; email: string } | null;
  lastActivityAt: string | null;
  dealCount: number;
  segments: GroupRef[];
  lists: GroupRef[];
}

interface GroupRef { id: number; name: string }

interface Segment { id: number; name: string }
interface ContactList { id: number; name: string }

const STAGE_LABELS: Record<string, string> = {
  lead: 'Interessent', active: 'Aktiv', customer: 'Kunde', dormant: 'Sovende', lost: 'Tapt',
};

const MAX_CHIPS = 2;

function idParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && /^\d+$/.test(raw) ? raw : '';
}

function GroupChips({ items, tone, onPick }: {
  items: GroupRef[];
  tone: 'segment' | 'list';
  onPick: (id: number) => void;
}) {
  if (items.length === 0) return <span className="text-gray-400">—</span>;
  const color = tone === 'segment'
    ? 'bg-violet-50 text-violet-800 hover:bg-violet-100'
    : 'bg-blue-50 text-blue-800 hover:bg-blue-100';
  const rest = items.slice(MAX_CHIPS);
  return (
    <span className="flex flex-wrap gap-1">
      {items.slice(0, MAX_CHIPS).map((g) => (
        <button
          key={g.id}
          type="button"
          onClick={() => onPick(g.id)}
          title={`Vis alle i «${g.name}»`}
          className={`max-w-[10rem] truncate rounded-full px-2 py-0.5 text-xs ${color}`}
        >
          {g.name}
        </button>
      ))}
      {rest.length > 0 && (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600" title={rest.map((g) => g.name).join(', ')}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}

export default function KontakterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initialParams = use(searchParams);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [segmentId, setSegmentId] = useState(() => idParam(initialParams.segmentId));
  const [listId, setListId] = useState(() => idParam(initialParams.listId));
  const [tag, setTag] = useState('');
  const [owner, setOwner] = useState('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const { assignees } = useAssignees();
  const [showNew, setShowNew] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', email: '', phone: '' });
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (stage) params.set('stage', stage);
      if (segmentId) params.set('segmentId', segmentId);
      if (listId) params.set('listId', listId);
      if (tag) params.set('tag', tag);
      if (owner) params.set('owner', owner);
      params.set('page', String(page));
      const res = await fetch(`/api/admin/crm/contacts?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke hente kontaktene. Sjekk nettforbindelsen og prøv igjen.');
      const data = await res.json();
      setContacts(data.contacts || []);
      setTotal(data.total || 0);
      setPageSize(data.pageSize || 50);
      setAvailableTags(data.availableTags || []);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setContacts([]);
      toast(err instanceof Error ? err.message : 'Kunne ikke hente kontaktene. Prøv igjen.', 'error');
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [q, stage, segmentId, listId, tag, owner, page, toast]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useOpenFromQuery('ny', () => setShowNew(true));

  useEffect(() => {
    fetch('/api/admin/crm/segments')
      .then((r) => r.json())
      .then((d) => setSegments(d.segments || []));
    fetch('/api/admin/crm/lists')
      .then((r) => r.json())
      .then((d) => setLists(d.lists || []))
      .catch(() => {});
  }, []);

  async function createContact() {
    const res = await fetch('/api/admin/crm/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newContact.name,
        email: newContact.email || null,
        phone: newContact.phone || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Kunne ikke lagre kontakten. Sjekk feltene og prøv igjen.', 'error');
      return;
    }
    toast(`${newContact.name} er lagt til som kontakt`, 'success', {
      action: data.contact?.id ? { label: 'Åpne', href: `/admin/crm/kontakter/${data.contact.id}` } : undefined,
    });
    setShowNew(false);
    setNewContact({ name: '', email: '', phone: '' });
    load();
  }

  const hasFilters = Boolean(q || stage || segmentId || listId || tag || owner);
  const clearFilters = () => {
    setPage(1);
    setQ('');
    setStage('');
    setSegmentId('');
    setListId('');
    setTag('');
    setOwner('');
  };

  return (
    <div>
      <CrmTabs
        actions={
          <>
            <ButtonLink href="/admin/crm/import" variant="secondary">
              Importer fra Excel
            </ButtonLink>
            <Button variant={showNew ? 'secondary' : 'primary'} onClick={() => setShowNew(true)}>
              Legg til kontakt
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Søk navn, e-post, telefon"
          aria-label="Søk i kontakter"
          value={q}
          onChange={(e) => { setPage(1); setQ(e.target.value); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full sm:w-64"
        />
        <select
          value={segmentId}
          onChange={(e) => { setPage(1); setSegmentId(e.target.value); }}
          aria-label="Filtrer på segment"
          className={`border rounded-md px-3 py-2 text-sm max-w-[12rem] ${segmentId ? 'border-violet-400 bg-violet-50 text-violet-900' : 'border-gray-300'}`}
        >
          <option value="">Alle segmenter</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={listId}
          onChange={(e) => { setPage(1); setListId(e.target.value); }}
          aria-label="Filtrer på liste"
          className={`border rounded-md px-3 py-2 text-sm max-w-[12rem] ${listId ? 'border-blue-400 bg-blue-50 text-blue-900' : 'border-gray-300'}`}
        >
          <option value="">Alle lister</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <select
          value={stage}
          onChange={(e) => { setPage(1); setStage(e.target.value); }}
          aria-label="Filtrer på kundestatus"
          className="border border-gray-300 rounded-md px-3 py-2 text-sm max-w-[12rem]"
        >
          <option value="">Alle kundestatuser</option>
          {Object.entries(STAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={tag}
          onChange={(e) => { setPage(1); setTag(e.target.value); }}
          aria-label="Filtrer på stikkord"
          className="border border-gray-300 rounded-md px-3 py-2 text-sm max-w-[12rem]"
        >
          <option value="">Alle stikkord</option>
          {/* Behold valgt tagg selv om gjeldende filtre ikke lenger gir den som fasett */}
          {[...new Set([...(tag ? [tag] : []), ...availableTags])].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={owner}
          onChange={(e) => { setPage(1); setOwner(e.target.value); }}
          aria-label="Filtrer på ansvarlig"
          className="border border-gray-300 rounded-md px-3 py-2 text-sm w-44 max-w-[12rem] truncate"
        >
          <option value="">Alle ansvarlige</option>
          <option value="me">Mine</option>
          <option value="none">Uten ansvarlig</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>{assigneeLabel(a)}</option>
          ))}
        </select>
        <span className="text-sm text-gray-500">{total === 1 ? '1 kontakt' : `${total} kontakter`}</span>
        {hasFilters && (
          <Button variant="link" size="sm" onClick={clearFilters}>
            Nullstill filtre
          </Button>
        )}
      </div>

      {(segmentId || listId) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-800">
          {segmentId && (
            <span>
              Viser kontakter i segmentet <strong>{segments.find((s) => String(s.id) === segmentId)?.name ?? '…'}</strong>
              <span className="text-gray-500"> (oppdateres automatisk ut fra reglene)</span>
              <HelpTip term="segment" />
            </span>
          )}
          {segmentId && listId && <span aria-hidden>·</span>}
          {listId && (
            <span>
              Viser kontakter i listen <strong>{lists.find((l) => String(l.id) === listId)?.name ?? '…'}</strong>
              <HelpTip term="list" />
            </span>
          )}
          <Button
            variant="link"
            size="sm"
            onClick={() => { setPage(1); setSegmentId(''); setListId(''); }}
            className="ml-auto"
          >
            Vis alle kontakter
          </Button>
        </div>
      )}

      {showNew && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 flex flex-wrap gap-3 items-end">
          <p className="w-full text-sm text-gray-600">
            Bare navn er påkrevd. Legg inn e-post hvis personen skal kunne få e-post fra dere.
          </p>
          <div className="text-sm">
            <label htmlFor="new-contact-name" className="block text-gray-600 mb-1">Navn</label>
            <input id="new-contact-name" required value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </div>
          <div className="text-sm">
            <label htmlFor="new-contact-email" className="block text-gray-600 mb-1">E-post</label>
            <input id="new-contact-email" type="email" autoComplete="off" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </div>
          <div className="text-sm">
            <label htmlFor="new-contact-phone" className="block text-gray-600 mb-1">Telefon</label>
            <input id="new-contact-phone" type="tel" autoComplete="off" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </div>
          <Button onClick={createContact} disabled={!newContact.name}>
            Lagre kontakt
          </Button>
          <Button variant="secondary" onClick={() => setShowNew(false)}>Avbryt</Button>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : loadError ? (
        <EmptyState
          title="Kunne ikke hente kontaktene"
          description="Det kan skyldes nettforbindelsen. Prøv igjen om litt."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      ) : contacts.length === 0 && hasFilters ? (
        <EmptyState
          title="Ingen kontakter passer søket"
          description="Prøv et annet søkeord, eller fjern noen av filtrene."
          action={{ label: 'Nullstill filtre', onClick: clearFilters }}
        />
      ) : contacts.length === 0 ? (
        <EmptyState
          icon="users"
          title="Ingen kontakter ennå"
          description="Kontakter er personene dere har kontakt med. Legg til én for hånd, eller last opp en hel liste fra Excel."
          action={{ label: 'Legg til kontakt', onClick: () => setShowNew(true) }}
          secondaryAction={{ label: 'Importer fra Excel', href: '/admin/crm/import' }}
        />
      ) : (
        <>
        <ul className="space-y-2 md:hidden" aria-label="Kontakter">
          {contacts.map((c) => (
            <li key={c.id} className="relative rounded-lg border border-gray-200 bg-white p-3 text-sm active:bg-gray-50">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/admin/crm/kontakter/${c.id}`}
                  className="font-medium text-blue-700 after:absolute after:inset-0 after:content-['']"
                >
                  {c.name}
                </Link>
                <Badge className="shrink-0 bg-gray-100 text-gray-700">
                  {STAGE_LABELS[c.stage] ?? c.stage}
                </Badge>
              </div>
              {(c.email || c.phone) && (
                <p className="mt-1 break-words text-gray-600">
                  {c.email}
                  {c.email && c.phone && ' · '}
                  {c.phone && <span className="tabular-nums whitespace-nowrap">{formatPhone(c.phone)}</span>}
                </p>
              )}
              {c.organization && <p className="mt-0.5 text-gray-600">{c.organization.name}</p>}
              <p className="mt-1 text-xs text-gray-500">
                {c.owner ? `Ansvarlig: ${c.owner.email}` : 'Uten ansvarlig'}
                {c.dealCount > 0 && ` · ${c.dealCount === 1 ? '1 avtale' : `${c.dealCount} avtaler`}`}
                {c.lastActivityAt && ` · sist aktiv ${formatDateNo(c.lastActivityAt)}`}
              </p>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto border border-gray-200 rounded-lg md:block">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Navn</th>
                <th className="px-4 py-3 font-medium">E-post og telefon</th>
                <th className="px-4 py-3 font-medium">Bedrift</th>
                <th className="px-4 py-3 font-medium">Kundestatus</th>
                <th className="px-4 py-3 font-medium">Segmenter</th>
                <th className="px-4 py-3 font-medium">Lister</th>
                <th className="px-4 py-3 font-medium">Ansvarlig</th>
                <th className="px-4 py-3 font-medium">Avtaler</th>
                <th className="px-4 py-3 font-medium">Sist aktiv</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contacts.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/crm/kontakter/${c.id}`} className="font-medium text-blue-700 hover:underline">
                      {c.name}
                    </Link>
                    {c.tags.length > 0 && (
                      <span className="ml-2 space-x-1">
                        {c.tags.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => { setPage(1); setTag(t); }}
                            title={`Filtrer på «${t}»`}
                            className="inline-block bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded hover:bg-blue-100"
                          >
                            {t}
                          </button>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.email ?? '—'}
                    {c.phone && <span className="block text-xs text-gray-500 tabular-nums whitespace-nowrap">{formatPhone(c.phone)}</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.organization ? (
                      <Link href={`/admin/crm/bedrifter/${c.organization.id}`} className="hover:underline">
                        {c.organization.name}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">{STAGE_LABELS[c.stage] ?? c.stage}</td>
                  <td className="px-4 py-3">
                    <GroupChips items={c.segments} tone="segment" onPick={(id) => { setPage(1); setSegmentId(String(id)); }} />
                  </td>
                  <td className="px-4 py-3">
                    <GroupChips items={c.lists} tone="list" onPick={(id) => { setPage(1); setListId(String(id)); }} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.owner?.email ?? '—'}</td>
                  <td className="px-4 py-3">{c.dealCount}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDateNo(c.lastActivityAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {!loading && !loadError && contacts.length > 0 && (
        <Pagination total={total} page={page} perPage={pageSize} onChange={setPage} />
      )}
    </div>
  );
}
