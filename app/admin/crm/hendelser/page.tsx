'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';
import { Pagination } from '@/components/admin/Pagination';
import { EVENT_TYPES } from '@/lib/events/taxonomy';

interface EventRow {
  id: number;
  type: string;
  source: string;
  occurredAt: string;
  meta: string;
  visitorId: string | null;
  contact: { id: number; name: string } | null;
}

const SOURCES = ['server', 'client', 'webhook'] as const;

function EventDetails({ meta }: { meta: string }) {
  let formatted = meta;
  try {
    formatted = JSON.stringify(JSON.parse(meta), null, 2);
  } catch {
    formatted = meta;
  }
  return (
    <details>
      <summary className="cursor-pointer text-blue-700 hover:underline">meta</summary>
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
      if (!res.ok) throw new Error('Kunne ikke laste hendelser');
      const data = await res.json();
      setEvents(data.events || []);
      setTotal(data.total || 0);
      setPageSize(data.pageSize || 50);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setEvents([]);
      toast(err instanceof Error ? err.message : 'Kunne ikke laste hendelser', 'error');
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
          value={type}
          onChange={(e) => { setPage(1); setType(e.target.value); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">Alle typer</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={source}
          onChange={(e) => { setPage(1); setSource(e.target.value); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">Alle kilder</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>{s}</option>
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
        <span className="text-sm text-gray-500">{total} hendelser</span>
        {contactId && (
          <span className="ml-auto inline-flex items-center gap-2 rounded-md bg-blue-50 px-3 py-1.5 text-sm text-blue-700">
            Filtrert på kontakt #{contactId}
            <button
              type="button"
              onClick={() => { setPage(1); setContactId(''); }}
              aria-label="Fjern kontaktfilter"
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
          title="Kunne ikke laste hendelser"
          description="Noe gikk galt under henting av hendelser. Prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      ) : events.length === 0 ? (
        <EmptyState
          title="Ingen hendelser"
          description="Hendelser dukker opp her når besøkende og kunder er aktive."
        />
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Tidspunkt</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Kilde</th>
                <th className="px-4 py-3 font-medium">Kontakt</th>
                <th className="px-4 py-3 font-medium">Detaljer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {new Date(e.occurredAt).toLocaleString('nb-NO')}
                  </td>
                  <td className="px-4 py-3 font-medium">{e.type}</td>
                  <td className="px-4 py-3 text-gray-600">{e.source}</td>
                  <td className="px-4 py-3">
                    {e.contact ? (
                      <Link href={`/admin/crm/kontakter/${e.contact.id}`} className="text-blue-700 hover:underline">
                        {e.contact.name}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <EventDetails meta={e.meta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
