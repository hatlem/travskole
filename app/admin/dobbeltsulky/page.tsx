'use client';

import { useState, useEffect, useMemo } from 'react';
import { TableSkeleton, StatCardsSkeleton } from '@/components/admin/Skeleton';
import { useToast } from '@/components/admin/Toast';

interface Booking {
  id: number;
  name: string;
  email: string;
  phone: string;
  participants: number;
  preferredDate: string | null;
  message: string | null;
  status: string;
  createdAt: string;
  confirmedAt?: string | null;
  cancelledAt?: string | null;
}

type StatusFilter = 'all' | 'new' | 'confirmed' | 'cancelled';

export default function AdminDobbeltsulkyPage() {
  const [enabled, setEnabled] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    async function load() {
      const [settingsRes, bookingsRes] = await Promise.all([
        fetch('/api/admin/settings'),
        fetch('/api/admin/bookings'),
      ]);
      const settingsData = await settingsRes.json();
      const bookingsData = await bookingsRes.json();
      setEnabled(settingsData.settings?.dobbeltsulky_enabled === 'true');
      setBookings(bookingsData.bookings || []);
      setLoading(false);
    }
    load();
  }, []);

  const filteredBookings = useMemo(() => {
    return bookings.filter(b => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          b.name.toLowerCase().includes(q) ||
          b.email.toLowerCase().includes(q) ||
          b.phone.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [bookings, search, statusFilter]);

  const stats = useMemo(() => ({
    total: bookings.length,
    new: bookings.filter(b => b.status === 'new').length,
    confirmed: bookings.filter(b => b.status === 'confirmed').length,
    cancelled: bookings.filter(b => b.status === 'cancelled').length,
  }), [bookings]);

  const newFilteredIds = useMemo(
    () => filteredBookings.filter(b => b.status === 'new').map(b => b.id),
    [filteredBookings]
  );

  async function toggleEnabled() {
    setToggling(true);
    try {
      const newValue = !enabled;
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'dobbeltsulky_enabled', value: String(newValue) }),
      });
      if (!res.ok) throw new Error('Kunne ikke oppdatere innstilling');
      setEnabled(newValue);
      toast(newValue ? 'Dobbeltsulky aktivert' : 'Dobbeltsulky deaktivert', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setToggling(false);
    }
  }

  async function updateStatus(id: number, status: string) {
    try {
      const res = await fetch(`/api/admin/bookings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Kunne ikke oppdatere status');
      const now = new Date().toISOString();
      setBookings(bookings.map(b =>
        b.id === id
          ? {
              ...b,
              status,
              ...(status === 'confirmed' ? { confirmedAt: now } : {}),
              ...(status === 'cancelled' ? { cancelledAt: now } : {}),
            }
          : b
      ));
      setSelected(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast(status === 'confirmed' ? 'Booking bekreftet' : 'Booking avvist', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    }
  }

  async function bulkUpdateStatus(status: string) {
    if (selected.size === 0) return;
    setBulkProcessing(true);
    try {
      const ids = Array.from(selected);
      await Promise.all(
        ids.map(id =>
          fetch(`/api/admin/bookings/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          })
        )
      );
      const now = new Date().toISOString();
      setBookings(bookings.map(b =>
        ids.includes(b.id)
          ? {
              ...b,
              status,
              ...(status === 'confirmed' ? { confirmedAt: now } : {}),
              ...(status === 'cancelled' ? { cancelledAt: now } : {}),
            }
          : b
      ));
      toast(`${ids.length} booking(er) oppdatert`, 'success');
      setSelected(new Set());
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setBulkProcessing(false);
    }
  }

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (newFilteredIds.every(id => selected.has(id))) {
      setSelected(prev => {
        const next = new Set(prev);
        newFilteredIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        newFilteredIds.forEach(id => next.add(id));
        return next;
      });
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Dobbeltsulky</h1>
        <StatCardsSkeleton count={4} />
        <div className="mt-6">
          <TableSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header with toggle */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dobbeltsulky</h1>
          <p className="text-gray-600 text-sm mt-1">Administrer booking og foresporsler</p>
        </div>
        <button
          onClick={toggleEnabled}
          disabled={toggling}
          className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
            enabled ? 'bg-green-500' : 'bg-gray-300'
          } ${toggling ? 'opacity-50' : ''}`}
        >
          <span
            className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-7' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Status banner */}
      <div className={`rounded-lg px-4 py-3 mb-6 text-sm font-medium ${
        enabled ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-gray-50 text-gray-600 border border-gray-200'
      }`}>
        {enabled
          ? 'Dobbeltsulky-booking er synlig for besokende pa arrangementer-siden.'
          : 'Dobbeltsulky-booking er skjult. Besokende kan ikke booke.'}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          <p className="text-xs text-gray-500 mt-1">Totalt</p>
        </div>
        <div className="bg-white rounded-lg border border-blue-200 p-4 text-center">
          <p className="text-2xl font-bold text-blue-700">{stats.new}</p>
          <p className="text-xs text-blue-600 mt-1">Nye</p>
        </div>
        <div className="bg-white rounded-lg border border-green-200 p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{stats.confirmed}</p>
          <p className="text-xs text-green-600 mt-1">Bekreftet</p>
        </div>
        <div className="bg-white rounded-lg border border-red-200 p-4 text-center">
          <p className="text-2xl font-bold text-red-700">{stats.cancelled}</p>
          <p className="text-xs text-red-600 mt-1">Avvist</p>
        </div>
      </div>

      {/* Search and filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Sok etter navn, e-post eller telefon..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A]/20 focus:border-[#003B7A]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#003B7A]/20 focus:border-[#003B7A]"
        >
          <option value="all">Alle statuser</option>
          <option value="new">Ny</option>
          <option value="confirmed">Bekreftet</option>
          <option value="cancelled">Avvist</option>
        </select>
      </div>

      {/* Bulk actions */}
      {newFilteredIds.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={newFilteredIds.length > 0 && newFilteredIds.every(id => selected.has(id))}
              onChange={toggleSelectAll}
              className="rounded border-gray-300 text-[#003B7A] focus:ring-[#003B7A]"
            />
            Velg alle nye ({newFilteredIds.length})
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-sm text-gray-500">|</span>
              <span className="text-sm font-medium text-gray-700">{selected.size} valgt</span>
              <button
                onClick={() => bulkUpdateStatus('confirmed')}
                disabled={bulkProcessing}
                className="ml-auto text-sm font-medium text-white bg-green-600 hover:bg-green-700 px-4 py-1.5 rounded-md transition disabled:opacity-50"
              >
                Bekreft valgte
              </button>
              <button
                onClick={() => bulkUpdateStatus('cancelled')}
                disabled={bulkProcessing}
                className="text-sm font-medium text-white bg-red-600 hover:bg-red-700 px-4 py-1.5 rounded-md transition disabled:opacity-50"
              >
                Avvis valgte
              </button>
            </>
          )}
        </div>
      )}

      {/* Bookings list */}
      <div className="space-y-4">
        {filteredBookings.map(booking => (
          <BookingCard
            key={booking.id}
            booking={booking}
            onUpdateStatus={updateStatus}
            isSelected={selected.has(booking.id)}
            onToggleSelect={toggleSelect}
          />
        ))}
      </div>

      {filteredBookings.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">
            {bookings.length === 0
              ? 'Ingen foresporsler enna.'
              : 'Ingen foresporsler matcher filteret.'}
          </p>
        </div>
      )}
    </div>
  );
}

function BookingCard({
  booking,
  onUpdateStatus,
  isSelected,
  onToggleSelect,
}: {
  booking: Booking;
  onUpdateStatus: (id: number, status: string) => void;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
}) {
  const statusColors: Record<string, string> = {
    new: 'bg-blue-100 text-blue-800',
    confirmed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
  };
  const statusLabels: Record<string, string> = {
    new: 'Ny',
    confirmed: 'Bekreftet',
    cancelled: 'Avvist',
  };

  return (
    <div className={`bg-white rounded-xl shadow-sm border p-5 transition ${
      isSelected ? 'border-[#003B7A] ring-1 ring-[#003B7A]/20' : 'border-gray-200'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          {booking.status === 'new' && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(booking.id)}
              className="mt-1 rounded border-gray-300 text-[#003B7A] focus:ring-[#003B7A]"
            />
          )}
          <div>
            <h3 className="font-semibold text-gray-900">{booking.name}</h3>
            <p className="text-sm text-gray-500">
              Opprettet{' '}
              {new Date(booking.createdAt).toLocaleDateString('nb-NO', {
                day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </div>
        </div>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[booking.status] || 'bg-gray-100 text-gray-800'}`}>
          {statusLabels[booking.status] || booking.status}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
        <div>
          <p className="text-gray-500">E-post</p>
          <a href={`mailto:${booking.email}`} className="text-[#003B7A] hover:underline">{booking.email}</a>
        </div>
        <div>
          <p className="text-gray-500">Telefon</p>
          <a href={`tel:${booking.phone}`} className="text-[#003B7A] hover:underline">{booking.phone}</a>
        </div>
        <div>
          <p className="text-gray-500">Deltakere</p>
          <p className="font-medium">{booking.participants}</p>
        </div>
        <div>
          <p className="text-gray-500">Onsket dato</p>
          <p className="font-medium">
            {booking.preferredDate
              ? new Date(booking.preferredDate).toLocaleDateString('nb-NO')
              : 'Ikke spesifisert'}
          </p>
        </div>
      </div>

      {booking.message && (
        <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 mb-3">{booking.message}</p>
      )}

      {/* Timestamps for confirmed/cancelled */}
      {booking.confirmedAt && (
        <p className="text-xs text-green-600 mb-2">
          Bekreftet {new Date(booking.confirmedAt).toLocaleDateString('nb-NO', {
            day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </p>
      )}
      {booking.cancelledAt && (
        <p className="text-xs text-red-600 mb-2">
          Avvist {new Date(booking.cancelledAt).toLocaleDateString('nb-NO', {
            day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </p>
      )}

      {booking.status === 'new' && (
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <button
            onClick={() => onUpdateStatus(booking.id, 'confirmed')}
            className="text-sm font-medium text-white bg-green-600 hover:bg-green-700 px-4 py-1.5 rounded-md transition"
          >
            Bekreft
          </button>
          <button
            onClick={() => onUpdateStatus(booking.id, 'cancelled')}
            className="text-sm font-medium text-white bg-red-600 hover:bg-red-700 px-4 py-1.5 rounded-md transition"
          >
            Avvis
          </button>
        </div>
      )}
    </div>
  );
}
