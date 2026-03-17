'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/components/admin/Toast';

interface ActivityLog {
  id: number;
  action: string;
  entity: string;
  entityId: number | null;
  details: string | null;
  userEmail: string;
  createdAt: string;
}

const actionLabels: Record<string, string> = {
  create: 'Opprettet',
  update: 'Oppdatert',
  delete: 'Slettet',
  email: 'E-post sendt',
  status_change: 'Status endret',
};

const entityLabels: Record<string, string> = {
  course: 'Kurs',
  registration: 'Pamelding',
  user: 'Bruker',
  booking: 'Booking',
};

const actionIcons: Record<string, string> = {
  create: 'M12 4v16m8-8H4',
  update: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  delete: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  email: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  status_change: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
};

const actionColors: Record<string, string> = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  email: 'bg-purple-100 text-purple-700',
  status_change: 'bg-yellow-100 text-yellow-700',
};

function relativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Akkurat na';
  if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? 'minutt' : 'minutter'} siden`;
  if (diffHour < 24) return `${diffHour} ${diffHour === 1 ? 'time' : 'timer'} siden`;
  if (diffDay === 1) return 'I gar';
  if (diffDay < 7) return `${diffDay} dager siden`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)} ${Math.floor(diffDay / 7) === 1 ? 'uke' : 'uker'} siden`;
  return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
}

const PER_PAGE = 25;

export default function AdminActivityPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const { toast } = useToast();

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('perPage', String(PER_PAGE));
      if (actionFilter) params.set('action', actionFilter);
      if (entityFilter) params.set('entity', entityFilter);
      if (searchDebounced) params.set('search', searchDebounced);

      const res = await fetch(`/api/admin/activity?${params.toString()}`);
      if (!res.ok) throw new Error('Kunne ikke hente aktivitetslogg');
      const data = await res.json();
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, entityFilter, searchDebounced, toast]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [actionFilter, entityFilter, searchDebounced]);

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Aktivitetslogg</h1>
        <p className="text-gray-600 text-sm mt-1">Oversikt over handlinger utfort i adminpanelet</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Sok etter detaljer eller e-post..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A]/20 focus:border-[#003B7A]"
          />
        </div>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#003B7A]/20 focus:border-[#003B7A]"
        >
          <option value="">Alle handlinger</option>
          <option value="create">Opprettet</option>
          <option value="update">Oppdatert</option>
          <option value="delete">Slettet</option>
          <option value="email">E-post sendt</option>
          <option value="status_change">Statusendring</option>
        </select>
        <select
          value={entityFilter}
          onChange={e => setEntityFilter(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#003B7A]/20 focus:border-[#003B7A]"
        >
          <option value="">Alle typer</option>
          <option value="course">Kurs</option>
          <option value="registration">Pamelding</option>
          <option value="user">Bruker</option>
          <option value="booking">Booking</option>
        </select>
      </div>

      {/* Results count */}
      <p className="text-sm text-gray-500 mb-4">
        Viser {logs.length} av {total} hendelser
      </p>

      {/* Activity list */}
      {loading ? (
        <div className="py-20 text-center text-gray-500">Laster...</div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">Ingen aktivitet funnet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Tidspunkt</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Bruker</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Handling</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Detaljer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-gray-900" title={new Date(log.createdAt).toLocaleString('nb-NO')}>
                        {relativeTime(log.createdAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-gray-700">{log.userEmail}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${actionColors[log.action] || 'bg-gray-100 text-gray-700'}`}>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={actionIcons[log.action] || 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'} />
                        </svg>
                        {actionLabels[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-gray-700">
                        {entityLabels[log.entity] || log.entity}
                        {log.entityId != null && (
                          <span className="text-gray-400 ml-1">#{log.entityId}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-gray-600 truncate block max-w-xs" title={log.details || ''}>
                        {log.details || '-'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile list */}
          <div className="md:hidden divide-y divide-gray-100">
            {logs.map(log => (
              <div key={log.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${actionColors[log.action] || 'bg-gray-100 text-gray-700'}`}>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={actionIcons[log.action] || 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'} />
                    </svg>
                    {actionLabels[log.action] || log.action}
                  </span>
                  <span className="text-xs text-gray-500" title={new Date(log.createdAt).toLocaleString('nb-NO')}>
                    {relativeTime(log.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-gray-900 font-medium">
                  {entityLabels[log.entity] || log.entity}
                  {log.entityId != null && <span className="text-gray-400 ml-1">#{log.entityId}</span>}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{log.userEmail}</p>
                {log.details && (
                  <p className="text-sm text-gray-600 mt-1">{log.details}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Forrige
          </button>
          <span className="text-sm text-gray-600">
            Side {page} av {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Neste
          </button>
        </div>
      )}
    </div>
  );
}
