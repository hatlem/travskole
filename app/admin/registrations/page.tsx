'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

interface Registration {
  id: number;
  status: string;
  consentActivities: boolean;
  consentMedia: boolean;
  consentRisk: boolean;
  createdAt: string;
  course: { id: number; name: string };
  child: { id: number; name: string };
  parent: { id: number; name: string; phone: string; user: { email: string } };
}

interface Course {
  id: number;
  name: string;
  status: string;
}

const emptyForm = {
  courseId: '',
  childFirstName: '',
  childLastName: '',
  childBirthdate: '',
  childAllergies: '',
  parentFirstName: '',
  parentLastName: '',
  parentEmail: '',
  parentPhone: '',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Venter',
  confirmed: 'Bekreftet',
  waitlist: 'Venteliste',
  cancelled: 'Avlyst',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  waitlist: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
};

export default function AdminRegistrationsPage() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchRegistrations();
  }, []);

  async function fetchRegistrations() {
    try {
      const res = await fetch('/api/admin/registrations');
      if (!res.ok) throw new Error('Kunne ikke hente påmeldinger');
      const data = await res.json();
      setRegistrations(data.registrations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setLoading(false);
    }
  }

  async function fetchCourses() {
    try {
      const res = await fetch('/api/admin/courses');
      if (!res.ok) return;
      const data = await res.json();
      setCourses(data.courses ?? data);
    } catch {
      // ignore
    }
  }

  function openAddForm() {
    setForm(emptyForm);
    fetchCourses();
    setShowAddForm(true);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Kunne ikke opprette påmelding');
      }
      const data = await res.json();
      setRegistrations((prev) => [data.registration, ...prev]);
      setShowAddForm(false);
      setForm(emptyForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(id: number, status: string) {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/admin/registrations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Kunne ikke oppdatere status');
      setRegistrations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status } : r))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setUpdatingId(null);
    }
  }

  async function deleteRegistration(id: number) {
    if (!confirm('Er du sikker på at du vil slette denne påmeldingen?')) return;
    try {
      const res = await fetch(`/api/admin/registrations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Kunne ikke slette påmelding');
      setRegistrations((prev) => prev.filter((r) => r.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    }
  }

  async function bulkUpdateStatus(status: string) {
    if (selectedIds.size === 0) return;
    const label = status === 'confirmed' ? 'bekrefte' : 'avvise';
    if (!confirm(`Er du sikker på at du vil ${label} ${selectedIds.size} påmelding(er)?`)) return;

    setBulkUpdating(true);
    try {
      const promises = Array.from(selectedIds).map((id) =>
        fetch(`/api/admin/registrations/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        })
      );
      await Promise.all(promises);
      setRegistrations((prev) =>
        prev.map((r) => (selectedIds.has(r.id) ? { ...r, status } : r))
      );
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt ved masseoppdatering');
    } finally {
      setBulkUpdating(false);
    }
  }

  // Derived data
  const uniqueCourses = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of registrations) {
      map.set(r.course.id, r.course.name);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [registrations]);

  const filteredRegistrations = useMemo(() => {
    return registrations.filter((reg) => {
      if (statusFilter !== 'all' && reg.status !== statusFilter) return false;
      if (courseFilter !== 'all' && reg.course.id !== Number(courseFilter)) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          reg.course.name.toLowerCase().includes(query) ||
          reg.child.name.toLowerCase().includes(query) ||
          reg.parent.name.toLowerCase().includes(query) ||
          reg.parent.user?.email?.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [registrations, statusFilter, courseFilter, searchQuery]);

  const stats = useMemo(() => {
    const s = { total: registrations.length, pending: 0, confirmed: 0, waitlist: 0, cancelled: 0 };
    for (const r of registrations) {
      if (r.status in s) (s as Record<string, number>)[r.status]++;
    }
    return s;
  }, [registrations]);

  const filteredIds = useMemo(() => new Set(filteredRegistrations.map((r) => r.id)), [filteredRegistrations]);
  const allVisibleSelected = filteredRegistrations.length > 0 && filteredRegistrations.every((r) => selectedIds.has(r.id));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of filteredRegistrations) next.delete(r.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of filteredRegistrations) next.add(r.id);
        return next;
      });
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#003B7A] border-r-transparent mb-3" />
          <p className="text-gray-500">Laster påmeldinger...</p>
        </div>
      </div>
    );
  }

  const inputClass =
    'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#003B7A] focus:border-transparent outline-none';

  const visibleSelectedCount = Array.from(selectedIds).filter((id) => filteredIds.has(id)).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Påmeldinger</h1>
        <div className="flex gap-3">
          <button
            onClick={showAddForm ? () => setShowAddForm(false) : openAddForm}
            className="bg-[#003B7A] hover:bg-[#002855] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {showAddForm ? 'Lukk skjema' : '+ Legg til deltaker'}
          </button>
          <button
            onClick={() => window.open('/api/admin/registrations/export')}
            className="border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Eksporter CSV
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4 font-medium text-red-800 hover:underline text-sm">
            Lukk
          </button>
        </div>
      )}

      {/* Inline add form */}
      {showAddForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Legg til ny deltaker</h2>
          </div>
          <form onSubmit={handleAdd} className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Course */}
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Kurs *</label>
                <select
                  required
                  value={form.courseId}
                  onChange={(e) => setForm({ ...form, courseId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Velg kurs...</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Parent section */}
              <div className="md:col-span-3">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 border-b border-gray-100 pb-2">Foresatt</h3>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fornavn *</label>
                <input
                  required
                  type="text"
                  value={form.parentFirstName}
                  onChange={(e) => setForm({ ...form, parentFirstName: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Etternavn *</label>
                <input
                  required
                  type="text"
                  value={form.parentLastName}
                  onChange={(e) => setForm({ ...form, parentLastName: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">E-post *</label>
                <input
                  required
                  type="email"
                  value={form.parentEmail}
                  onChange={(e) => setForm({ ...form, parentEmail: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Telefon *</label>
                <input
                  required
                  type="tel"
                  value={form.parentPhone}
                  onChange={(e) => setForm({ ...form, parentPhone: e.target.value })}
                  className={inputClass}
                />
              </div>

              {/* Child section */}
              <div className="md:col-span-3">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 border-b border-gray-100 pb-2">Barn</h3>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fornavn *</label>
                <input
                  required
                  type="text"
                  value={form.childFirstName}
                  onChange={(e) => setForm({ ...form, childFirstName: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Etternavn *</label>
                <input
                  required
                  type="text"
                  value={form.childLastName}
                  onChange={(e) => setForm({ ...form, childLastName: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fødselsdato</label>
                <input
                  type="date"
                  value={form.childBirthdate}
                  onChange={(e) => setForm({ ...form, childBirthdate: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Allergier</label>
                <input
                  type="text"
                  value={form.childAllergies}
                  onChange={(e) => setForm({ ...form, childAllergies: e.target.value })}
                  className={inputClass}
                  placeholder="Valgfritt"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
              <button
                type="submit"
                disabled={submitting}
                className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  submitting
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-[#003B7A] hover:bg-[#002855] text-white'
                }`}
              >
                {submitting ? 'Legger til...' : 'Legg til deltaker'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-6 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors"
              >
                Avbryt
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Stats bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-4 mb-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="font-semibold text-gray-900">
            Totalt: {stats.total}
          </span>
          <span className="text-gray-300">|</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
            Bekreftet: {stats.confirmed}
          </span>
          <span className="text-gray-300">|</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
            Venter: {stats.pending}
          </span>
          <span className="text-gray-300">|</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
            Venteliste: {stats.waitlist}
          </span>
          <span className="text-gray-300">|</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            Avlyst: {stats.cancelled}
          </span>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Søk etter kurs, barn, forelder eller e-post..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
          />
        </div>
        <select
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent bg-white"
        >
          <option value="all">Alle kurs</option>
          {uniqueCourses.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent bg-white"
        >
          <option value="all">Alle statuser</option>
          <option value="pending">Venter</option>
          <option value="confirmed">Bekreftet</option>
          <option value="waitlist">Venteliste</option>
          <option value="cancelled">Avlyst</option>
        </select>
      </div>

      {/* Result count */}
      <p className="text-sm text-gray-500 mb-3">
        Viser {filteredRegistrations.length} av {registrations.length} påmeldinger
      </p>

      {/* Bulk action bar */}
      {visibleSelectedCount > 0 && (
        <div className="bg-[#003B7A] text-white rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm font-medium">{visibleSelectedCount} valgt</span>
          <div className="flex gap-2">
            <button
              onClick={() => bulkUpdateStatus('confirmed')}
              disabled={bulkUpdating}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
            >
              {bulkUpdating ? 'Oppdaterer...' : 'Bekreft alle'}
            </button>
            <button
              onClick={() => bulkUpdateStatus('cancelled')}
              disabled={bulkUpdating}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
            >
              {bulkUpdating ? 'Oppdaterer...' : 'Avvis alle'}
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-white/80 hover:text-white px-3 py-1.5 text-sm transition-colors"
            >
              Fjern valg
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {registrations.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500 mb-4">Ingen påmeldinger ennå.</p>
          <button
            onClick={openAddForm}
            className="bg-[#003B7A] hover:bg-[#002855] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + Legg til deltaker
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-gray-300 text-[#003B7A] focus:ring-[#003B7A] cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">Kurs</th>
                  <th className="px-4 py-3 text-left">Barn</th>
                  <th className="px-4 py-3 text-left">Forelder</th>
                  <th className="px-4 py-3 text-left">E-post</th>
                  <th className="px-4 py-3 text-left">Telefon</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Dato</th>
                  <th className="px-4 py-3 text-left">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {filteredRegistrations.map((reg, idx) => (
                  <tr
                    key={reg.id}
                    className={`border-b border-gray-100 hover:bg-blue-50/50 transition-colors ${
                      idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                    } ${selectedIds.has(reg.id) ? 'bg-blue-50' : ''}`}
                  >
                    <td className="px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(reg.id)}
                        onChange={() => toggleSelect(reg.id)}
                        className="h-4 w-4 rounded border-gray-300 text-[#003B7A] focus:ring-[#003B7A] cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3.5 text-gray-400 font-mono text-xs">#{reg.id}</td>
                    <td className="px-4 py-3.5 font-medium text-gray-900">
                      <Link
                        href={`/admin/courses/${reg.course.id}/edit`}
                        className="hover:text-[#003B7A] hover:underline"
                      >
                        {reg.course.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-gray-700">{reg.child.name}</td>
                    <td className="px-4 py-3.5 text-gray-700">{reg.parent.name}</td>
                    <td className="px-4 py-3.5 text-gray-500 text-xs">{reg.parent.user?.email}</td>
                    <td className="px-4 py-3.5 text-gray-500 text-xs">{reg.parent.phone}</td>
                    <td className="px-4 py-3.5">
                      <select
                        value={reg.status}
                        onChange={(e) => updateStatus(reg.id, e.target.value)}
                        disabled={updatingId === reg.id}
                        className={`text-xs font-semibold rounded-full px-3 py-1 border-0 cursor-pointer focus:ring-2 focus:ring-[#003B7A] ${
                          STATUS_COLORS[reg.status] || 'bg-gray-100 text-gray-800'
                        } ${updatingId === reg.id ? 'opacity-50 cursor-wait' : ''}`}
                      >
                        <option value="pending">Venter</option>
                        <option value="confirmed">Bekreftet</option>
                        <option value="waitlist">Venteliste</option>
                        <option value="cancelled">Avlyst</option>
                      </select>
                    </td>
                    <td className="px-4 py-3.5 text-gray-400 text-xs">
                      {new Date(reg.createdAt).toLocaleDateString('nb-NO')}
                    </td>
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => deleteRegistration(reg.id)}
                        className="text-red-500 hover:text-red-700 text-xs font-medium transition-colors"
                      >
                        Slett
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredRegistrations.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                      Ingen påmeldinger matcher filteret.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
