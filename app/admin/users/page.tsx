'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { useToast } from '@/components/admin/Toast';
import { Pagination } from '@/components/admin/Pagination';

interface User {
  id: number;
  email: string;
  role: string;
  createdAt: string;
  parent: {
    id: number;
    name: string;
    phone: string;
    address: string | null;
    _count: { children: number; registrations: number };
    children: { id: number; name: string; birthdate: string | null; allergies: string | null }[];
    registrations: { id: number; status: string; createdAt: string; course: { id: number; name: string }; child: { name: string } }[];
  } | null;
}

function getInitials(name: string | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    confirmed: 'Bekreftet',
    pending: 'Venter',
    cancelled: 'Kansellert',
    waitlisted: 'Venteliste',
  };
  return map[status] || status;
}

function statusColor(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'bg-green-100 text-green-800';
    case 'pending':
      return 'bg-yellow-100 text-yellow-800';
    case 'cancelled':
      return 'bg-red-100 text-red-800';
    case 'waitlisted':
      return 'bg-orange-100 text-orange-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const perPage = 25;
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const isSuperAdmin = session?.user?.role === 'superadmin';

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error('Kunne ikke hente brukere');
      const data = await res.json();
      setUsers(data.users);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function updateRole(id: number, role: string) {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error('Kunne ikke oppdatere rolle');
      setUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, role } : u))
      );
      toast('Rolle oppdatert', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setUpdatingId(null);
    }
  }

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        user.email.toLowerCase().includes(query) ||
        (user.parent?.name?.toLowerCase().includes(query) ?? false) ||
        (user.parent?.phone?.includes(query) ?? false)
      );
    });
  }, [users, searchQuery, roleFilter]);

  // Reset page when filters change
  useEffect(() => setPage(1), [searchQuery, roleFilter]);

  const paginatedUsers = filteredUsers.slice((page - 1) * perPage, page * perPage);

  const stats = useMemo(() => {
    const total = users.length;
    const parents = users.filter((u) => u.role === 'parent').length;
    const admins = users.filter((u) => u.role === 'admin' || u.role === 'superadmin').length;
    return { total, parents, admins };
  }, [users]);

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Brukere</h1>
        <TableSkeleton />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Brukere</h1>
        <button
          onClick={() => window.open('/api/admin/users/export')}
          className="border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Eksporter CSV
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-5 py-4">
          <p className="text-sm text-gray-500">Totalt</p>
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-5 py-4">
          <p className="text-sm text-gray-500">Foreldre</p>
          <p className="text-2xl font-bold text-blue-700">{stats.parents}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-5 py-4">
          <p className="text-sm text-gray-500">Admin</p>
          <p className="text-2xl font-bold text-purple-700">{stats.admins}</p>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">Ingen brukere funnet.</p>
        </div>
      ) : (
        <>
          {/* Search and filter bar */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Sok etter e-post, navn eller telefon..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
            />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent bg-white"
            >
              <option value="all">Alle roller</option>
              <option value="parent">Forelder</option>
              <option value="admin">Admin</option>
              {isSuperAdmin && <option value="superadmin">Superadmin</option>}
            </select>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Viser {filteredUsers.length} av {users.length} brukere
          </p>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="px-6 py-3 text-left">Bruker</th>
                    <th className="px-6 py-3 text-left">Kontakt</th>
                    <th className="px-6 py-3 text-left">Barn</th>
                    <th className="px-6 py-3 text-left">Pam.</th>
                    <th className="px-6 py-3 text-left">Rolle</th>
                    <th className="px-6 py-3 text-left">Opprettet</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedUsers.map((user) => {
                    const isExpanded = expandedIds.has(user.id);
                    const initials = getInitials(user.parent?.name);
                    return (
                      <>
                        <tr
                          key={user.id}
                          onClick={() => toggleExpanded(user.id)}
                          className={`cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-full bg-bjerke-blue flex items-center justify-center text-white text-xs font-bold shrink-0">
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 truncate">{user.parent?.name || '-'}</p>
                                <p className="text-gray-500 text-xs truncate">{user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-gray-500">{user.parent?.phone || '-'}</td>
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-gray-100 text-xs font-medium text-gray-700">
                              {user.parent?._count?.children ?? 0}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-gray-100 text-xs font-medium text-gray-700">
                              {user.parent?._count?.registrations ?? 0}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <select
                              value={user.role}
                              onChange={(e) => {
                                e.stopPropagation();
                                updateRole(user.id, e.target.value);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              disabled={updatingId === user.id}
                              className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer focus:ring-2 focus:ring-bjerke-blue ${
                                user.role === 'superadmin'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : user.role === 'admin'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-blue-100 text-blue-800'
                              } ${updatingId === user.id ? 'opacity-50' : ''}`}
                            >
                              <option value="parent">Forelder</option>
                              <option value="admin">Admin</option>
                              {isSuperAdmin && <option value="superadmin">Superadmin</option>}
                            </select>
                          </td>
                          <td className="px-6 py-4 text-gray-500">
                            {new Date(user.createdAt).toLocaleDateString('nb-NO')}
                          </td>
                        </tr>

                        {/* Expanded detail row */}
                        {isExpanded && (
                          <tr key={`${user.id}-detail`} className="bg-blue-50/50">
                            <td colSpan={6} className="px-6 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Address */}
                                {user.parent?.address && (
                                  <div className="md:col-span-2">
                                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Adresse</p>
                                    <p className="text-sm text-gray-700">{user.parent.address}</p>
                                  </div>
                                )}

                                {/* Children */}
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                                    Barn ({user.parent?.children?.length ?? 0})
                                  </p>
                                  {user.parent?.children && user.parent.children.length > 0 ? (
                                    <div className="space-y-2">
                                      {user.parent.children.map((child) => (
                                        <div key={child.id} className="bg-white rounded-lg border border-gray-200 px-3 py-2">
                                          <p className="font-medium text-sm text-gray-900">{child.name}</p>
                                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                                            {child.birthdate && (
                                              <span>
                                                Fodt: {new Date(child.birthdate).toLocaleDateString('nb-NO')}
                                              </span>
                                            )}
                                            {child.allergies && (
                                              <span className="text-orange-600">
                                                Allergier: {child.allergies}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-sm text-gray-400">Ingen barn registrert</p>
                                  )}
                                </div>

                                {/* Recent registrations */}
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                                    Siste pameldinger ({user.parent?._count?.registrations ?? 0} totalt)
                                  </p>
                                  {user.parent?.registrations && user.parent.registrations.length > 0 ? (
                                    <div className="space-y-2">
                                      {user.parent.registrations.map((reg) => (
                                        <div key={reg.id} className="bg-white rounded-lg border border-gray-200 px-3 py-2">
                                          <div className="flex items-center justify-between">
                                            <p className="font-medium text-sm text-gray-900 truncate">{reg.course.name}</p>
                                            <span className={`text-xs font-medium rounded-full px-2 py-0.5 shrink-0 ml-2 ${statusColor(reg.status)}`}>
                                              {statusLabel(reg.status)}
                                            </span>
                                          </div>
                                          <div className="flex gap-x-4 text-xs text-gray-500 mt-0.5">
                                            <span>{reg.child.name}</span>
                                            <span>{new Date(reg.createdAt).toLocaleDateString('nb-NO')}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-sm text-gray-400">Ingen pameldinger</p>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination total={filteredUsers.length} page={page} perPage={perPage} onChange={setPage} />
        </>
      )}
    </div>
  );
}
