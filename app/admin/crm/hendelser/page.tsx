'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';
import { Pagination } from '@/components/admin/Pagination';
import { EVENT_LABELS, eventLabel, eventSourceLabel, groupedEventTypes } from '@/lib/flows/event-labels';
import { describeEventMeta, formatEventTime } from '@/lib/crm/event-details';

interface EventRow {
  id: number;
  type: string;
  source: string;
  occurredAt: string;
  meta: string;
  visitorId: string | null;
  contact: { id: number; name: string } | null;
}

const SOURCES = ['server', 'web', 'client', 'webhook'] as const;

/** Hvor hendelsen kom fra, i vanlige ord (kodeverdien vises under «Teknisk»). */
const sourceLabel = eventSourceLabel;

function EventDetails({ meta, type, source }: { meta: string; type: string; source: string }) {
  let formatted = meta;
  try {
    formatted = JSON.stringify(JSON.parse(meta), null, 2);
  } catch {
    formatted = meta;
  }
  return (
    <details>
      <summary className="cursor-pointer text-blue-700 hover:underline">Teknisk</summary>
      <p className="mt-1 text-xs text-gray-500">
        Kode: <span className="font-mono">{type}</span> · kilde: <span className="font-mono">{source}</span>
      </p>
      <pre className="mt-1 max-w-md whitespace-pre-wrap break-words text-xs text-gray-600">{formatted}</pre>
    </details>
  );
}

function HendelserContent() {
  const searchParams = useSearchParams();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [type, setType] = useState('');
  const [source, setSource] = useState('');
  const [contactId, setContactId] = useState(() => searchParams.get('contactId') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (source) params.set('source', source);
      if (contactId) params.set('contactId', contactId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('page', String(page));
      const res = await fetch(`/api/admin/crm/events?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke hente loggen. Last siden på nytt om litt.');
      const data = await res.json();
      setEvents(data.events || []);
      setTotal(data.total || 0);
      setPageSize(data.pageSize || 50);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setEvents([]);
      toast(err instanceof Error ? err.message : 'Kunne ikke hente loggen. Last siden på nytt om litt.', 'error');
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [type, source, contactId, from, to, page, toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return (
    <div>
      <CrmTabs />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          aria-label="Hva skjedde"
          value={type}
          onChange={(e) => { setPage(1); setType(e.target.value); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">Alt som har skjedd</option>
          {groupedEventTypes().map(({ group, types }) => (
            <optgroup key={group} label={group}>
              {types.map((t) => (
                <option key={t} value={t}>{EVENT_LABELS[t]}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <select
          aria-label="Hvor det kom fra"
          value={source}
          onChange={(e) => { setPage(1); setSource(e.target.value); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">Fra alle steder</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>{sourceLabel(s)}</option>
          ))}
        </select>
        <label className="text-sm flex items-center gap-1">
          <span className="text-gray-600">Fra</span>
          <input
            type="date"
            value={from}
            onChange={(e) => { setPage(1); setFrom(e.target.value); }}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm flex items-center gap-1">
          <span className="text-gray-600">Til</span>
          <input
            type="date"
            value={to}
            onChange={(e) => { setPage(1); setTo(e.target.value); }}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </label>
        <span className="text-sm text-gray-500">{total} {total === 1 ? 'hendelse' : 'hendelser'}</span>
        {contactId && (
          <span className="ml-auto inline-flex items-center gap-2 rounded-md bg-blue-50 px-3 py-1.5 text-sm text-blue-700">
            Viser bare én kontakt
            <button
              type="button"
              onClick={() => { setPage(1); setContactId(''); }}
              aria-label="Vis alle kontakter igjen"
              className="text-blue-500 hover:text-blue-700"
            >
              &times;
            </button>
          </span>
        )}
      </div>

      {loading ? (
        <TableSkeleton rows={8} />
      ) : loadError ? (
        <EmptyState
          title="Kunne ikke hente loggen"
          description="Noe gikk galt da hendelsene skulle hentes. Prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      ) : events.length === 0 ? (
        <EmptyState
          title={type || source || from || to || contactId ? 'Ingenting passer filteret' : 'Ingenting har skjedd ennå'}
          description={type || source || from || to || contactId
            ? 'Prøv en annen periode, eller vis alt.'
            : 'Her dukker det opp en linje hver gang noen melder seg på, åpner en e-post eller besøker nettsiden.'}
          action={type || source || from || to || contactId
            ? { label: 'Vis alt', onClick: () => { setPage(1); setType(''); setSource(''); setFrom(''); setTo(''); setContactId(''); } }
            : undefined}
        />
      ) : (
        <>
          <ul className="space-y-2 md:hidden" aria-label="Hendelser">
            {events.map((e) => {
              const summary = describeEventMeta(e.type, e.meta);
              return (
                <li key={e.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-gray-900">{eventLabel(e.type)}</p>
                    <time dateTime={e.occurredAt} className="shrink-0 text-xs text-gray-500 tabular-nums">
                      {formatEventTime(e.occurredAt)}
                    </time>
                  </div>
                  {summary && <p className="mt-0.5 break-words text-gray-600">{summary}</p>}
                  <p className="mt-1 text-xs text-gray-500">
                    {sourceLabel(e.source)}
                    {e.contact && (
                      <>
                        {' · '}
                        <Link href={`/admin/crm/kontakter/${e.contact.id}`} className="text-blue-700 hover:underline">
                          {e.contact.name}
                        </Link>
                      </>
                    )}
                  </p>
                  <div className="mt-2 text-xs">
                    <EventDetails meta={e.meta} type={e.type} source={e.source} />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block overflow-x-auto border border-gray-200 rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Tidspunkt</th>
                  <th className="px-4 py-3 font-medium">Hva skjedde</th>
                  <th className="px-4 py-3 font-medium">Hvor</th>
                  <th className="px-4 py-3 font-medium">Kontakt</th>
                  <th className="px-4 py-3 font-medium">Detaljer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {events.map((e) => {
                  const summary = describeEventMeta(e.type, e.meta);
                  return (
                    <tr key={e.id} className="hover:bg-gray-50 align-top">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap tabular-nums">
                        <time dateTime={e.occurredAt}>{formatEventTime(e.occurredAt)}</time>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{eventLabel(e.type)}</span>
                        {summary && <span className="block max-w-sm break-words text-gray-600">{summary}</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{sourceLabel(e.source)}</td>
                      <td className="px-4 py-3">
                        {e.contact ? (
                          <Link href={`/admin/crm/kontakter/${e.contact.id}`} className="text-blue-700 hover:underline">
                            {e.contact.name}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <EventDetails meta={e.meta} type={e.type} source={e.source} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && !loadError && events.length > 0 && (
        <Pagination total={total} page={page} perPage={pageSize} onChange={setPage} />
      )}
    </div>
  );
}

export default function HendelserPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={8} />}>
      <HendelserContent />
    </Suspense>
  );
}
