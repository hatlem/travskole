'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/admin/Toast';
import { Pagination } from '@/components/admin/Pagination';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { TableSkeleton } from '@/components/admin/Skeleton';

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
  startDate?: string;
}

interface ChildForm {
  firstName: string;
  lastName: string;
  birthdate: string;
  allergies: string;
}

const emptyChild: ChildForm = {
  firstName: '',
  lastName: '',
  birthdate: '',
  allergies: '',
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
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseSearch, setCourseSearch] = useState('');
  const [courseDropdownOpen, setCourseDropdownOpen] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [parentForm, setParentForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [children, setChildren] = useState<ChildForm[]>([{ ...emptyChild }]);
  const [submitting, setSubmitting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deletingReg, setDeletingReg] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkTargetStatus, setBulkTargetStatus] = useState<string>("");
  const courseDropdownRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const perPage = 25;

  useEffect(() => {
    fetchRegistrations();
  }, []);

  // Close course dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (courseDropdownRef.current && !courseDropdownRef.current.contains(e.target as Node)) {
        setCourseDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function fetchRegistrations() {
    try {
      const res = await fetch('/api/admin/registrations');
      if (!res.ok) throw new Error('Kunne ikke hente påmeldinger');
      const data = await res.json();
      setRegistrations(data.registrations);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
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
    setParentForm({ firstName: '', lastName: '', email: '', phone: '' });
    setChildren([{ ...emptyChild }]);
    setSelectedCourseId('');
    setCourseSearch('');
    fetchCourses();
    setShowAddForm(true);
  }

  function addChild() {
    setChildren((prev) => [...prev, { ...emptyChild }]);
  }

  function removeChild(index: number) {
    setChildren((prev) => prev.filter((_, i) => i !== index));
  }

  function updateChild(index: number, field: keyof ChildForm, value: string) {
    setChildren((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: selectedCourseId,
          parentFirstName: parentForm.firstName,
          parentLastName: parentForm.lastName,
          parentEmail: parentForm.email,
          parentPhone: parentForm.phone,
          children: children.filter((c) => c.firstName.trim()),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Kunne ikke opprette påmelding');
      }
      const data = await res.json();
      // API returns either { registration } or { registrations }
      const newRegs = data.registrations ?? [data.registration];
      setRegistrations((prev) => [...newRegs, ...prev]);
      setShowAddForm(false);
      toast('Påmelding opprettet', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
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
      toast('Status oppdatert', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setUpdatingId(null);
    }
  }

  function requestDeleteRegistration(id: number) {
    setDeleteTargetId(id);
    setShowDeleteModal(true);
  }

  async function confirmDeleteRegistration() {
    if (!deleteTargetId) return;
    setDeletingReg(true);
    try {
      const res = await fetch(`/api/admin/registrations/${deleteTargetId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Kunne ikke slette påmelding');
      setRegistrations((prev) => prev.filter((r) => r.id !== deleteTargetId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTargetId);
        return next;
      });
      toast('Påmelding slettet', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setDeletingReg(false);
      setShowDeleteModal(false);
      setDeleteTargetId(null);
    }
  }

  async function bulkUpdateStatus(status: string) {
    if (selectedIds.size === 0) return;
    setBulkTargetStatus(status);
    setShowBulkModal(true);
    return;
  }

  async function confirmBulkUpdate() {
    const status = bulkTargetStatus;
    if (!status) return;
    setShowBulkModal(false);
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
      toast(`${selectedIds.size} påmelding(er) oppdatert`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt ved masseoppdatering', 'error');
    } finally {
      setBulkUpdating(false);
    }
  }

  // Course dropdown: sorted by startDate descending (newest first), filtered by search
  const filteredCourses = useMemo(() => {
    const sorted = [...courses].sort((a, b) => {
      if (a.startDate && b.startDate) return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
      return 0;
    });
    if (!courseSearch.trim()) return sorted;
    const q = courseSearch.toLowerCase();
    return sorted.filter((c) => c.name.toLowerCase().includes(q));
  }, [courses, courseSearch]);

  const selectedCourseName = courses.find((c) => String(c.id) === selectedCourseId)?.name || '';

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

  // Reset page when filters change
  useEffect(() => setPage(1), [searchQuery, statusFilter, courseFilter]);

  const paginatedRegistrations = filteredRegistrations.slice((page - 1) * perPage, page * perPage);

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
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Påmeldinger</h1>
        <TableSkeleton rows={8} cols={9} />
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

      {/* Inline add form */}
      {showAddForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Legg til ny påmelding</h2>
          </div>
          <form onSubmit={handleAdd} className="p-6">
            <div className="space-y-6">
              {/* Course picker with search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kurs *</label>
                <div className="relative" ref={courseDropdownRef}>
                  <input
                    type="text"
                    placeholder="Søk etter kurs..."
                    value={courseDropdownOpen ? courseSearch : selectedCourseName}
                    onChange={(e) => {
                      setCourseSearch(e.target.value);
                      if (!courseDropdownOpen) setCourseDropdownOpen(true);
                    }}
                    onFocus={() => {
                      setCourseDropdownOpen(true);
                      setCourseSearch('');
                    }}
                    className={inputClass}
                  />
                  {selectedCourseId && !courseDropdownOpen && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCourseId('');
                        setCourseSearch('');
                        setCourseDropdownOpen(true);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                  {courseDropdownOpen && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {filteredCourses.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-gray-400">Ingen kurs funnet</div>
                      ) : (
                        filteredCourses.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setSelectedCourseId(String(c.id));
                              setCourseDropdownOpen(false);
                              setCourseSearch('');
                            }}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 flex items-center justify-between ${
                              String(c.id) === selectedCourseId ? 'bg-blue-50 font-medium' : ''
                            }`}
                          >
                            <span>{c.name}</span>
                            <span className="text-xs text-gray-400 ml-2">
                              {c.startDate ? new Date(c.startDate).toLocaleDateString('nb-NO') : ''}
                              {c.status !== 'open' && (
                                <span className={`ml-2 ${c.status === 'full' ? 'text-red-500' : 'text-gray-500'}`}>
                                  ({c.status === 'full' ? 'Fullt' : c.status === 'closed' ? 'Stengt' : c.status})
                                </span>
                              )}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {/* Hidden required input for form validation */}
                <input type="hidden" required value={selectedCourseId} />
              </div>

              {/* Parent section */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 border-b border-gray-100 pb-2">Foresatt</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Fornavn *</label>
                    <input
                      required
                      type="text"
                      value={parentForm.firstName}
                      onChange={(e) => setParentForm({ ...parentForm, firstName: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Etternavn</label>
                    <input
                      type="text"
                      value={parentForm.lastName}
                      onChange={(e) => setParentForm({ ...parentForm, lastName: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">E-post *</label>
                    <input
                      required
                      type="email"
                      value={parentForm.email}
                      onChange={(e) => setParentForm({ ...parentForm, email: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Telefon</label>
                    <input
                      type="tel"
                      value={parentForm.phone}
                      onChange={(e) => setParentForm({ ...parentForm, phone: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              {/* Children section */}
              <div>
                <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-2">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Barn ({children.length})
                  </h3>
                  <button
                    type="button"
                    onClick={addChild}
                    className="text-sm text-[#003B7A] hover:text-[#002855] font-medium"
                  >
                    + Legg til barn
                  </button>
                </div>
                <div className="space-y-4">
                  {children.map((child, idx) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Fornavn {idx === 0 ? '*' : ''}
                        </label>
                        <input
                          required={idx === 0}
                          type="text"
                          value={child.firstName}
                          onChange={(e) => updateChild(idx, 'firstName', e.target.value)}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Etternavn</label>
                        <input
                          type="text"
                          value={child.lastName}
                          onChange={(e) => updateChild(idx, 'lastName', e.target.value)}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Fødselsdato</label>
                        <input
                          type="date"
                          value={child.birthdate}
                          onChange={(e) => updateChild(idx, 'birthdate', e.target.value)}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Allergier</label>
                        <input
                          type="text"
                          value={child.allergies}
                          onChange={(e) => updateChild(idx, 'allergies', e.target.value)}
                          className={inputClass}
                          placeholder="Valgfritt"
                        />
                      </div>
                      <div>
                        {children.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeChild(idx)}
                            className="text-red-500 hover:text-red-700 text-xs font-medium py-2"
                          >
                            Fjern
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
              <button
                type="submit"
                disabled={submitting || !selectedCourseId}
                className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  submitting || !selectedCourseId
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-[#003B7A] hover:bg-[#002855] text-white'
                }`}
              >
                {submitting
                  ? 'Legger til...'
                  : children.length > 1
                  ? `Legg til ${children.filter((c) => c.firstName.trim()).length} deltakere`
                  : 'Legg til deltaker'}
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
                {paginatedRegistrations.map((reg, idx) => (
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
                        onClick={() => requestDeleteRegistration(reg.id)}
                        className="text-red-500 hover:text-red-700 text-xs font-medium transition-colors"
                      >
                        Slett
                      </button>
                    </td>
                  </tr>
                ))}
                {paginatedRegistrations.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                      Ingen påmeldinger matcher filteret.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={filteredRegistrations.length} page={page} perPage={perPage} onChange={setPage} />
        </div>
      )}
      {/* Delete confirmation modal */}
      <ConfirmModal
        open={showDeleteModal}
        title="Slett påmelding"
        message="Er du sikker på at du vil slette denne påmeldingen?"
        confirmLabel="Slett"
        variant="danger"
        loading={deletingReg}
        onConfirm={confirmDeleteRegistration}
        onCancel={() => { setShowDeleteModal(false); setDeleteTargetId(null); }}
      />

      {/* Bulk update confirmation modal */}
      <ConfirmModal
        open={showBulkModal}
        title={bulkTargetStatus === 'confirmed' ? 'Bekreft påmeldinger' : 'Avvis påmeldinger'}
        message={`Er du sikker på at du vil ${bulkTargetStatus === 'confirmed' ? 'bekrefte' : 'avvise'} ${selectedIds.size} påmelding(er)?`}
        confirmLabel={bulkTargetStatus === 'confirmed' ? 'Bekreft alle' : 'Avvis alle'}
        variant={bulkTargetStatus === 'confirmed' ? 'info' : 'danger'}
        loading={bulkUpdating}
        onConfirm={confirmBulkUpdate}
        onCancel={() => setShowBulkModal(false)}
      />
    </div>
  );
}
