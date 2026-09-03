'use client';

import { Fragment, useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { useToast } from '@/components/admin/Toast';
import { Pagination } from '@/components/admin/Pagination';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { canManageUser } from '@/lib/user-admin';
import { UserFormModal, type EditableUser } from './UserFormModal';
import { ChildrenEditor, type AdminChild } from './ChildrenEditor';

type AccountStatus = 'active' | 'deactivated' | 'anonymized';

function userStatus(u: { deactivatedAt: string | null; anonymizedAt: string | null }): AccountStatus {
  if (u.anonymizedAt) return 'anonymized';
  if (u.deactivatedAt) return 'deactivated';
  return 'active';
}

interface User {
  id: number;
  email: string;
  role: string;
  createdAt: string;
  deactivatedAt: string | null;
  anonymizedAt: string | null;
  parent: {
    id: number;
    name: string;
    phone: string;
    address: string | null;
    _count: { children: number; registrations: number };
    children: AdminChild[];
    registrations: { id: number; status: string; createdAt: string; course: { id: number; name: string }; child: { name: string } | null }[];
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

const PER_PAGE = 25;
/** Ventetid før et tastetrykk i søkefeltet blir en spørring mot serveren. */
const SEARCH_DEBOUNCE_MS = 300;

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ total: 0, parents: 0, admins: 0 });
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const perPage = PER_PAGE;
  // searchInput er det man ser i feltet; searchQuery er det serveren har fått.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const isSuperAdmin = session?.user?.role === 'superadmin';
  const currentRole = session?.user?.role ?? '';
  const [formModal, setFormModal] = useState<{ mode: 'create' | 'edit'; user: EditableUser | null } | null>(null);
  const [confirm, setConfirm] = useState<{ user: User; action: 'deactivate' | 'reactivate' | 'anonymize' } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [magicLinkId, setMagicLinkId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | AccountStatus>('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<'deactivate' | 'reactivate' | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
      if (searchQuery) params.set('q', searchQuery);
      if (roleFilter !== 'all') params.set('role', roleFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await fetch(`/api/admin/users?${params}`);
      if (!res.ok) throw new Error('Kunne ikke hente brukere');
      const data = await res.json();
      setUsers(data.users);
      setTotal(data.total ?? data.users.length);
      if (data.stats) setStats(data.stats);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, page, searchQuery, roleFilter, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  /** Debouncet søk: skriv fritt, serveren spørres når man tar en pause. */
  function onSearchChange(value: string) {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      setSearchQuery(value.trim());
    }, SEARCH_DEBOUNCE_MS);
  }

  async function updateRole(id: number, role: string) {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Kunne ikke oppdatere rolle');
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

  /** Sender en fersk innloggingslenke til en bruker som ikke kommer seg inn. */
  async function sendMagicLink(user: User) {
    setMagicLinkId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/magic-link`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Kunne ikke sende innloggingslenke');
      toast(`Innloggingslenke sendt til ${user.email}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setMagicLinkId(null);
    }
  }

  /** Speiler barneendringer inn i tabellen uten en full refetch. */
  function applyChildren(userId: number, children: AdminChild[]) {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId && u.parent
          ? {
              ...u,
              parent: {
                ...u.parent,
                children,
                _count: { ...u.parent._count, children: children.length },
              },
            }
          : u
      )
    );
  }

  function openEdit(u: User) {
    setFormModal({
      mode: 'edit',
      user: {
        id: u.id,
        email: u.email,
        role: u.role,
        name: u.parent?.name ?? '',
        phone: u.parent?.phone ?? '',
        address: u.parent?.address ?? null,
      },
    });
  }

  async function runConfirmedAction() {
    if (!confirm) return;
    setActionLoading(true);
    const { user, action } = confirm;
    try {
      const res =
        action === 'anonymize'
          ? await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
          : await fetch(`/api/admin/users/${user.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deactivated: action === 'deactivate' }),
            });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Handlingen feilet');
      toast(
        action === 'anonymize'
          ? 'Bruker anonymisert'
          : action === 'deactivate'
          ? 'Bruker deaktivert'
          : 'Bruker reaktivert',
        'success',
      );
      setConfirm(null);
      fetchUsers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setActionLoading(false);
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

  /** Radene som kan bulk-håndteres på denne siden. */
  const selectableUsers = users.filter(
    (u) => canManageUser(currentRole, u.role) && userStatus(u) !== 'anonymized'
  );
  const allVisibleSelected =
    selectableUsers.length > 0 && selectableUsers.every((u) => selectedIds.has(u.id));

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        selectableUsers.forEach((u) => next.delete(u.id));
        return next;
      }
      return new Set([...prev, ...selectableUsers.map((u) => u.id)]);
    });
  }

  /**
   * Kjører bulk-handlingen. Serveren sjekker hver bruker for seg og forteller
   * hvilke den hoppet over — de rapporteres samlet i stedet for å stoppe alt.
   */
  async function runBulkAction() {
    if (!bulkAction) return;
    setBulkLoading(true);
    try {
      const res = await fetch('/api/admin/users/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), action: bulkAction }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Handlingen feilet');

      const verb = bulkAction === 'deactivate' ? 'deaktivert' : 'reaktivert';
      const skipped = data.skipped?.length ?? 0;
      toast(
        skipped > 0
          ? `${data.updated} ${verb}, ${skipped} hoppet over: ${data.skipped[0].error}`
          : `${data.updated} bruker(e) ${verb}`,
        skipped > 0 ? 'error' : 'success'
      );
      setSelectedIds(new Set());
      setBulkAction(null);
      fetchUsers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setBulkLoading(false);
    }
  }

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
        <div className="flex gap-2">
          <button
            onClick={() => window.open('/api/admin/users/export')}
            className="border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Eksporter CSV
          </button>
          <button
            onClick={() => setFormModal({ mode: 'create', user: null })}
            className="bg-bjerke-blue hover:bg-bjerke-blue-dark text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + Ny bruker
          </button>
        </div>
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

      {users.length === 0 && !searchQuery && roleFilter === 'all' && statusFilter === 'all' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">Ingen brukere funnet.</p>
        </div>
      ) : (
        <>
          {/* Search and filter bar */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Sok etter e-post, navn eller telefon..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
            />
            <select
              value={roleFilter}
              onChange={(e) => {
                setPage(1);
                setRoleFilter(e.target.value);
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent bg-white"
            >
              <option value="all">Alle roller</option>
              <option value="parent">Forelder</option>
              <option value="admin">Admin</option>
              {isSuperAdmin && <option value="superadmin">Superadmin</option>}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => {
                setPage(1);
                setStatusFilter(e.target.value as 'all' | AccountStatus);
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent bg-white"
            >
              <option value="all">Alle statuser</option>
              <option value="active">Aktiv</option>
              <option value="deactivated">Deaktivert</option>
              <option value="anonymized">Anonymisert</option>
            </select>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Viser {users.length} av {total} treff
          </p>

          {selectedIds.size > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-bjerke-blue/30 bg-blue-50 px-4 py-3">
              <span className="text-sm font-medium text-gray-700">
                {selectedIds.size} valgt
              </span>
              <button
                onClick={() => setBulkAction('deactivate')}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Deaktiver
              </button>
              <button
                onClick={() => setBulkAction('reactivate')}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Reaktiver
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs font-medium text-gray-500 hover:underline"
              >
                Fjern valg
              </button>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="px-6 py-3 text-left w-10">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        disabled={selectableUsers.length === 0}
                        aria-label="Velg alle på siden"
                        className="h-4 w-4 cursor-pointer rounded border-gray-300 text-bjerke-blue focus:ring-bjerke-blue"
                      />
                    </th>
                    <th className="px-6 py-3 text-left">Bruker</th>
                    <th className="px-6 py-3 text-left">Kontakt</th>
                    <th className="px-6 py-3 text-left">Barn</th>
                    <th className="px-6 py-3 text-left">Pam.</th>
                    <th className="px-6 py-3 text-left">Rolle</th>
                    <th className="px-6 py-3 text-left">Status</th>
                    <th className="px-6 py-3 text-left">Opprettet</th>
                    <th className="px-6 py-3 text-right">Handlinger</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map((user) => {
                    const isExpanded = expandedIds.has(user.id);
                    const initials = getInitials(user.parent?.name);
                    const status = userStatus(user);
                    const manageable = canManageUser(currentRole, user.role) && status !== 'anonymized';
                    return (
                      <Fragment key={user.id}>
                        <tr
                          onClick={() => toggleExpanded(user.id)}
                          className={`cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                        >
                          <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(user.id)}
                              onChange={() => toggleSelected(user.id)}
                              disabled={!manageable}
                              aria-label={`Velg ${user.email}`}
                              className="h-4 w-4 cursor-pointer rounded border-gray-300 text-bjerke-blue focus:ring-bjerke-blue disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          </td>
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
                              disabled={updatingId === user.id || !manageable}
                              className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 focus:ring-2 focus:ring-bjerke-blue ${
                                manageable ? 'cursor-pointer' : 'cursor-not-allowed'
                              } ${
                                user.role === 'superadmin'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : user.role === 'admin'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-blue-100 text-blue-800'
                              } ${updatingId === user.id || !manageable ? 'opacity-50' : ''}`}
                            >
                              <option value="parent">Forelder</option>
                              <option value="admin">Admin</option>
                              {/* Vis alltid Superadmin-opsjonen når brukeren HAR rollen —
                                  ellers faller select tilbake til «Forelder» og viser feil
                                  rolle for admin-innloggede. Tildeling er fortsatt sperret
                                  (disabled via manageable). */}
                              {(isSuperAdmin || user.role === 'superadmin') && (
                                <option value="superadmin">Superadmin</option>
                              )}
                            </select>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`text-xs font-medium rounded-full px-2.5 py-1 ${
                                status === 'anonymized'
                                  ? 'bg-gray-200 text-gray-600'
                                  : status === 'deactivated'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-green-100 text-green-800'
                              }`}
                            >
                              {status === 'anonymized' ? 'Anonymisert' : status === 'deactivated' ? 'Deaktivert' : 'Aktiv'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-gray-500">
                            {new Date(user.createdAt).toLocaleDateString('nb-NO')}
                          </td>
                          <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                            {manageable ? (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => openEdit(user)}
                                  className="text-xs font-medium text-bjerke-blue hover:underline"
                                >
                                  Rediger
                                </button>
                                {status === 'active' && (
                                  <button
                                    onClick={() => sendMagicLink(user)}
                                    disabled={magicLinkId === user.id}
                                    title="Send en fersk innloggingslenke på e-post"
                                    className="text-xs font-medium text-gray-600 hover:underline disabled:opacity-50"
                                  >
                                    {magicLinkId === user.id ? 'Sender …' : 'Send lenke'}
                                  </button>
                                )}
                                <button
                                  onClick={() =>
                                    setConfirm({ user, action: status === 'deactivated' ? 'reactivate' : 'deactivate' })
                                  }
                                  className="text-xs font-medium text-gray-600 hover:underline"
                                >
                                  {status === 'deactivated' ? 'Reaktiver' : 'Deaktiver'}
                                </button>
                                <button
                                  onClick={() => setConfirm({ user, action: 'anonymize' })}
                                  className="text-xs font-medium text-red-600 hover:underline"
                                >
                                  Anonymiser
                                </button>
                              </div>
                            ) : (
                              <span className="block text-right text-gray-300">–</span>
                            )}
                          </td>
                        </tr>

                        {/* Expanded detail row */}
                        {isExpanded && (
                          <tr className="bg-blue-50/50">
                            <td colSpan={9} className="px-6 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Address */}
                                {user.parent?.address && (
                                  <div className="md:col-span-2">
                                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Adresse</p>
                                    <p className="text-sm text-gray-700">{user.parent.address}</p>
                                  </div>
                                )}

                                {/* Children */}
                                {user.parent ? (
                                  <ChildrenEditor
                                    userId={user.id}
                                    items={user.parent.children ?? []}
                                    onChange={(children) => applyChildren(user.id, children)}
                                  />
                                ) : (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Barn</p>
                                    <p className="text-sm text-gray-400">
                                      Brukeren har ingen profil ennå. Legg inn navn og telefon under «Rediger» først.
                                    </p>
                                  </div>
                                )}

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
                                            <span>{reg.child?.name ?? 'Voksen deltaker'}</span>
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
                      </Fragment>
                    );
                  })}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-12 text-center text-gray-400">
                        Ingen brukere matcher filteret.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination total={total} page={page} perPage={perPage} onChange={setPage} />
        </>
      )}

      {formModal && (
        <UserFormModal
          open
          mode={formModal.mode}
          user={formModal.user}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setFormModal(null)}
          onSaved={(msg) => {
            toast(msg, 'success');
            fetchUsers();
          }}
        />
      )}

      {bulkAction && (
        <ConfirmModal
          open
          loading={bulkLoading}
          variant={bulkAction === 'deactivate' ? 'warning' : 'info'}
          title={bulkAction === 'deactivate' ? 'Deaktiver valgte brukere?' : 'Reaktiver valgte brukere?'}
          message={
            bulkAction === 'deactivate'
              ? `${selectedIds.size} bruker(e) kan ikke logge inn før kontoene reaktiveres. All data beholdes.`
              : `${selectedIds.size} bruker(e) kan logge inn igjen.`
          }
          confirmLabel={bulkAction === 'deactivate' ? 'Deaktiver' : 'Reaktiver'}
          onConfirm={runBulkAction}
          onCancel={() => setBulkAction(null)}
        />
      )}

      {confirm && (
        <ConfirmModal
          open
          loading={actionLoading}
          variant={confirm.action === 'anonymize' ? 'danger' : confirm.action === 'deactivate' ? 'warning' : 'info'}
          title={
            confirm.action === 'anonymize'
              ? 'Anonymiser bruker?'
              : confirm.action === 'deactivate'
              ? 'Deaktiver bruker?'
              : 'Reaktiver bruker?'
          }
          message={
            confirm.action === 'anonymize'
              ? 'Persondata (navn, kontakt, barn) slettes permanent. Påmeldingshistorikk beholdes avidentifisert. Dette kan ikke angres.'
              : confirm.action === 'deactivate'
              ? 'Brukeren kan ikke logge inn før kontoen reaktiveres. All data beholdes.'
              : 'Brukeren kan logge inn igjen.'
          }
          confirmLabel={
            confirm.action === 'anonymize' ? 'Anonymiser' : confirm.action === 'deactivate' ? 'Deaktiver' : 'Reaktiver'
          }
          onConfirm={runConfirmedAction}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
