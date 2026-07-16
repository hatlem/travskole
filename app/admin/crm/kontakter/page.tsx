'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';
import { Pagination } from '@/components/admin/Pagination';

interface ContactRow {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string;
  source: string;
  tags: string[];
  organization: { id: number; name: string } | null;
  lastActivityAt: string | null;
  dealCount: number;
}

interface Segment { id: number; name: string }

const STAGE_LABELS: Record<string, string> = {
  lead: 'Interessent', active: 'Aktiv', customer: 'Kunde', dormant: 'Sovende', lost: 'Tapt',
};

export default function KontakterPage() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [segmentId, setSegmentId] = useState('');
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
      params.set('page', String(page));
      const res = await fetch(`/api/admin/crm/contacts?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke laste kontakter');
      const data = await res.json();
      setContacts(data.contacts || []);
      setTotal(data.total || 0);
      setPageSize(data.pageSize || 50);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setContacts([]);
      toast(err instanceof Error ? err.message : 'Kunne ikke laste kontakter', 'error');
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [q, stage, segmentId, page, toast]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    fetch('/api/admin/crm/segments')
      .then((r) => r.json())
      .then((d) => setSegments(d.segments || []));
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
      toast(data.error || 'Kunne ikke opprette kontakt', 'error');
      return;
    }
    toast('Kontakt opprettet', 'success');
    setShowNew(false);
    setNewContact({ name: '', email: '', phone: '' });
    load();
  }

  return (
    <div>
      <CrmTabs />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Søk navn, e-post, telefon …"
          value={q}
          onChange={(e) => { setPage(1); setQ(e.target.value); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm w-64"
        />
        <select
          value={stage}
          onChange={(e) => { setPage(1); setStage(e.target.value); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">Alle stadier</option>
          {Object.entries(STAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={segmentId}
          onChange={(e) => { setPage(1); setSegmentId(e.target.value); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">Alle segmenter</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <span className="text-sm text-gray-500">{total} kontakter</span>
        <button
          onClick={() => setShowNew(true)}
          className="ml-auto bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          Ny kontakt
        </button>
      </div>

      {showNew && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Navn *</span>
            <input value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">E-post</span>
            <input type="email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Telefon</span>
            <input value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </label>
          <button onClick={createContact} disabled={!newContact.name}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            Lagre
          </button>
          <button onClick={() => setShowNew(false)} className="text-sm text-gray-600 px-2 py-2">Avbryt</button>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : loadError ? (
        <EmptyState
          title="Kunne ikke laste kontakter"
          description="Noe gikk galt under henting av kontakter. Prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      ) : contacts.length === 0 ? (
        <EmptyState title="Ingen kontakter" description="Opprett en kontakt eller importer fra CSV." />
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Navn</th>
                <th className="px-4 py-3 font-medium">E-post</th>
                <th className="px-4 py-3 font-medium">Bedrift</th>
                <th className="px-4 py-3 font-medium">Stadium</th>
                <th className="px-4 py-3 font-medium">Deals</th>
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
                          <span key={t} className="inline-block bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded">{t}</span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.organization ? (
                      <Link href={`/admin/crm/bedrifter/${c.organization.id}`} className="hover:underline">
                        {c.organization.name}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">{STAGE_LABELS[c.stage] ?? c.stage}</td>
                  <td className="px-4 py-3">{c.dealCount}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleDateString('nb-NO') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !loadError && contacts.length > 0 && (
        <Pagination total={total} page={page} perPage={pageSize} onChange={setPage} />
      )}
    </div>
  );
}
