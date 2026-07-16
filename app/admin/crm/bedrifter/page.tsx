'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';
import { Pagination } from '@/components/admin/Pagination';

interface OrgRow {
  id: number;
  name: string;
  domain: string | null;
  phone: string | null;
  stage: string;
  contactCount: number;
  dealCount: number;
  lastActivityAt: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  lead: 'Interessent',
  active: 'Aktiv',
  customer: 'Kunde',
  dormant: 'Sovende',
  lost: 'Tapt',
};

export default function BedrifterPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newOrg, setNewOrg] = useState({ name: '', domain: '', phone: '' });
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
      params.set('page', String(page));
      const res = await fetch(`/api/admin/crm/organizations?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke laste bedrifter');
      const data = await res.json();
      setOrgs(data.organizations || []);
      setTotal(data.total || 0);
      setPageSize(data.pageSize || 50);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setOrgs([]);
      toast(err instanceof Error ? err.message : 'Kunne ikke laste bedrifter', 'error');
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [q, page, toast]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function createOrg() {
    const res = await fetch('/api/admin/crm/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newOrg.name,
        domain: newOrg.domain || null,
        phone: newOrg.phone || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Kunne ikke opprette bedrift', 'error');
      return;
    }
    toast('Bedrift opprettet', 'success');
    setShowNew(false);
    setNewOrg({ name: '', domain: '', phone: '' });
    load();
  }

  return (
    <div>
      <CrmTabs />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Søk navn, domene, org.nr …"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm w-64"
        />
        <span className="text-sm text-gray-500">{total} bedrifter</span>
        <button
          onClick={() => setShowNew(true)}
          className="ml-auto bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          Ny bedrift
        </button>
      </div>

      {showNew && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Navn *</span>
            <input
              value={newOrg.name}
              onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Domene</span>
            <input
              placeholder="acme.no"
              value={newOrg.domain}
              onChange={(e) => setNewOrg({ ...newOrg, domain: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Telefon</span>
            <input
              value={newOrg.phone}
              onChange={(e) => setNewOrg({ ...newOrg, phone: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={createOrg}
            disabled={!newOrg.name}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
          >
            Lagre
          </button>
          <button onClick={() => setShowNew(false)} className="text-sm text-gray-600 px-2 py-2">
            Avbryt
          </button>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : loadError ? (
        <EmptyState
          title="Kunne ikke laste bedrifter"
          description="Noe gikk galt under henting av bedrifter. Prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      ) : orgs.length === 0 ? (
        <EmptyState
          title="Ingen bedrifter"
          description="Bedrifter opprettes automatisk fra bookinger med firmadomene, eller manuelt her."
        />
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Navn</th>
                <th className="px-4 py-3 font-medium">Domene</th>
                <th className="px-4 py-3 font-medium">Stadium</th>
                <th className="px-4 py-3 font-medium">Kontakter</th>
                <th className="px-4 py-3 font-medium">Deals</th>
                <th className="px-4 py-3 font-medium">Sist aktiv</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orgs.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/crm/bedrifter/${o.id}`} className="font-medium text-blue-700 hover:underline">
                      {o.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{o.domain ?? '—'}</td>
                  <td className="px-4 py-3">{STAGE_LABELS[o.stage] ?? o.stage}</td>
                  <td className="px-4 py-3">{o.contactCount}</td>
                  <td className="px-4 py-3">{o.dealCount}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {o.lastActivityAt ? new Date(o.lastActivityAt).toLocaleDateString('nb-NO') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !loadError && orgs.length > 0 && (
        <Pagination total={total} page={page} perPage={pageSize} onChange={setPage} />
      )}
    </div>
  );
}
