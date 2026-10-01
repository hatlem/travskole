'use client';

import { useState, useEffect, useMemo, useRef, useCallback, use } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import { useToast } from '@/components/admin/Toast';
import { Pagination } from '@/components/admin/Pagination';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { paymentStatusBadge } from '@/lib/payments/badge';
import { Button, buttonClass } from '@/components/admin/Button';
import { formatPhone } from '@/lib/admin-format';
import { UNFINISHED_PAYMENT_STATUSES } from '@/lib/dashboard-attention';
import { RegistrationEditModal, type EditableRegistration } from './RegistrationEditModal';

interface Registration {
  id: number;
  status: string;
  paymentStatus?: string;
  paymentProvider?: string | null;
  consentActivities: boolean;
  consentMedia: boolean;
  consentRisk: boolean;
  createdAt: string;
  course: { id: number; name: string };
  // null for voksen-arrangementer — deltakeren er parent selv (se schema.prisma childId)
  child: { id: number; name: string; birthdate: string | null; allergies: string | null } | null;
  parent: { id: number; name: string; phone: string; address: string | null; user: { email: string } };
}

interface Course {
  id: number;
  name: string;
  status: string;
  startDate?: string;
  audience?: string;
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

const emptyAddOptions = {
  consentActivities: false,
  consentRisk: false,
  consentMedia: false,
  waitlist: false,
  overrideCapacity: false,
  sendEmails: true,
};

const DESCRIPTION =
  'Alle som har meldt seg på kurs. Bekreft, flytt fra venteliste, eller legg inn en påmelding selv.';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-900',
  confirmed: 'bg-green-100 text-green-800',
  waitlist: 'bg-blue-100 text-blue-900',
  cancelled: 'bg-gray-200 text-gray-700',
};

const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'waitlist', 'cancelled'];

type PaymentFilter = 'all' | 'paid' | 'ikke-fullfort' | 'none';
const PAYMENT_FILTERS: PaymentFilter[] = ['all', 'paid', 'ikke-fullfort', 'none'];

function matchesPaymentFilter(status: string | undefined, filter: PaymentFilter): boolean {
  const s = status ?? 'none';
  switch (filter) {
    case 'paid':
      return s === 'paid' || s === 'partially_refunded' || s === 'refunded';
    case 'ikke-fullfort':
      return (UNFINISHED_PAYMENT_STATUSES as readonly string[]).includes(s);
    case 'none':
      return s === 'none';
    default:
      return true;
  }
}

function StatusSelect({
  reg,
  busy,
  onChange,
}: {
  reg: { id: number; status: string };
  busy: boolean;
  onChange: (status: string) => void;
}) {
  return (
    <select
      value={reg.status}
      onChange={(e) => onChange(e.target.value)}
      disabled={busy}
      aria-label="Status"
      className={`min-h-9 cursor-pointer rounded-full border-0 py-1 pl-3 pr-8 text-xs font-semibold focus:ring-2 focus:ring-bjerke-blue ${
        STATUS_COLORS[reg.status] || 'bg-gray-100 text-gray-800'
      } ${busy ? 'cursor-wait opacity-50' : ''}`}
    >
      <option value="pending">Venter</option>
      <option value="confirmed">Bekreftet</option>
      <option value="waitlist">Venteliste</option>
      <option value="cancelled">Avlyst</option>
    </select>
  );
}

function PaymentBadge({ status }: { status?: string }) {
  const badge = paymentStatusBadge(status);
  if (!badge) return null;
  return (
    <span className={`whitespace-nowrap text-xs font-semibold rounded-full px-3 py-1 ${badge.className}`}>
      {badge.label}
    </span>
  );
}

export default function AdminRegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Lenker fra dashboardet: ?status=pending, ?betaling=ikke-fullfort
  const initialParams = use(searchParams);
  const initialStatus = typeof initialParams.status === 'string' && STATUS_FILTERS.includes(initialParams.status) ? initialParams.status : 'all';
  const initialPayment = PAYMENT_FILTERS.find((f) => f === initialParams.betaling) ?? 'all';
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>(initialPayment);
  const [courseError, setCourseError] = useState<string | null>(null);
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
  const [addOptions, setAddOptions] = useState(emptyAddOptions);
  const [submitting, setSubmitting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deletingReg, setDeletingReg] = useState(false);
  const [editTarget, setEditTarget] = useState<Registration | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkTargetStatus, setBulkTargetStatus] = useState<string>("");
  const courseDropdownRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const perPage = 25;

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

  const fetchRegistrations = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/registrations');
      if (!res.ok) throw new Error('Kunne ikke hente påmeldingene. Last siden på nytt.');
      const data = await res.json();
      setRegistrations(data.registrations);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bevisst klientside lasting ved montering
    fetchRegistrations();
  }, [fetchRegistrations]);

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
    setAddOptions(emptyAddOptions);
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
    if (!selectedCourseId) {
      setCourseError('Velg hvilket kurs deltakeren skal meldes på.');
      document.getElementById('add-course')?.focus();
      return;
    }
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
          children: isAdultCourse ? [] : children.filter((c) => c.firstName.trim()),
          ...addOptions,
          consentActivities: isAdultCourse ? false : addOptions.consentActivities,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Påmeldingen ble ikke lagret. Sjekk feltene og prøv igjen.');
      }
      const data = await res.json();
      // API returns either { registration } or { registrations }
      const newRegs = data.registrations ?? [data.registration];
      setRegistrations((prev) => [...newRegs, ...prev]);
      setShowAddForm(false);
      const waitlisted = newRegs.filter((r: Registration) => r.status === 'waitlist').length;
      toast(
        waitlisted > 0
          ? `Påmeldingen er lagt inn — ${waitlisted} er satt på venteliste fordi kurset er fullt`
          : 'Påmeldingen er lagt inn',
        'success'
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.', 'error');
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
      if (!res.ok) throw new Error('Statusen ble ikke endret. Prøv igjen.');
      setRegistrations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status } : r))
      );
      const labels: Record<string, string> = { pending: 'Venter', confirmed: 'Bekreftet', waitlist: 'Venteliste', cancelled: 'Avlyst' };
      toast(`Statusen er endret til «${labels[status] ?? status}»`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.', 'error');
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
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Påmeldingen ble ikke slettet. Prøv igjen.');
      }
      setRegistrations((prev) => prev.filter((r) => r.id !== deleteTargetId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTargetId);
        return next;
      });
      toast('Påmeldingen er slettet', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.', 'error');
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
      const ids = Array.from(selectedIds);
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/admin/registrations/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          })
            .then((r) => (r.ok ? id : null))
            .catch(() => null),
        ),
      );
      const ok = new Set(results.filter((id): id is number => id !== null));
      setRegistrations((prev) => prev.map((r) => (ok.has(r.id) ? { ...r, status } : r)));
      // De som feilet forblir valgt, så man kan prøve igjen.
      setSelectedIds(new Set(ids.filter((id) => !ok.has(id))));
      if (ok.size === ids.length) {
        toast(ok.size === 1 ? '1 påmelding er oppdatert' : `${ok.size} påmeldinger er oppdatert`, 'success');
      } else {
        toast(`${ids.length - ok.size} av ${ids.length} ble ikke oppdatert. De er fortsatt valgt — prøv igjen.`, 'error');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noen påmeldinger ble kanskje ikke oppdatert. Last siden på nytt og sjekk statusene.', 'error');
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

  const selectedCourse = courses.find((c) => String(c.id) === selectedCourseId);
  const selectedCourseName = selectedCourse?.name || '';
  // Voksenarrangement: deltakeren er den voksne selv — ingen foresatt/barn.
  const isAdultCourse = selectedCourse?.audience === 'voksen';
  const personLabel = isAdultCourse ? 'Deltaker' : 'Foresatt';
  const consentOptions = isAdultCourse
    ? ([
        ['consentRisk', 'Deltakeren har godtatt risiko ved deltakelse'],
        ['consentMedia', 'Deltakeren har samtykket til bilder/video'],
      ] as const)
    : ([
        ['consentRisk', 'Foresatte har godtatt risiko ved deltakelse'],
        ['consentActivities', 'Foresatte har samtykket til aktivitetene'],
        ['consentMedia', 'Foresatte har samtykket til bilder/video'],
      ] as const);

  // Derived data
  const uniqueCourses = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of registrations) {
      map.set(r.course.id, r.course.name);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [registrations]);

  /** Skriver den oppdaterte påmeldingen tilbake i tabellen uten full refetch. */
  function applyEditedRegistration(updated: EditableRegistration, message: string) {
    setRegistrations((prev) =>
      prev.map((r) =>
        r.id === updated.id
          ? {
              ...r,
              child: updated.child,
              parent: {
                ...r.parent,
                name: updated.parent.name,
                phone: updated.parent.phone,
                address: updated.parent.address,
              },
            }
          : r
      )
    );
    toast(message, 'success');
  }

  const filteredRegistrations = useMemo(() => {
    return registrations.filter((reg) => {
      if (statusFilter !== 'all' && reg.status !== statusFilter) return false;
      if (!matchesPaymentFilter(reg.paymentStatus, paymentFilter)) return false;
      if (courseFilter !== 'all' && reg.course.id !== Number(courseFilter)) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          reg.course.name.toLowerCase().includes(query) ||
          reg.child?.name.toLowerCase().includes(query) ||
          reg.parent.name.toLowerCase().includes(query) ||
          reg.parent.user?.email?.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [registrations, statusFilter, paymentFilter, courseFilter, searchQuery]);

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
        <PageHeader title="Påmeldinger" description={DESCRIPTION} />
        <TableSkeleton rows={8} cols={11} />
      </div>
    );
  }

  const inputClass =
    'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent outline-none';

  const visibleSelectedCount = Array.from(selectedIds).filter((id) => filteredIds.has(id)).length;

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Påmeldinger"
        description={DESCRIPTION}
        actions={
          <>
            <Button variant={showAddForm ? 'secondary' : 'primary'} onClick={showAddForm ? () => setShowAddForm(false) : openAddForm}>
              {showAddForm ? 'Lukk skjemaet' : '+ Legg til deltaker'}
            </Button>
            {registrations.length > 0 ? (
              <a
                href="/api/admin/registrations/export"
                download
                title="Alle påmeldingene med betaling, som en fil du kan åpne i Excel"
                className={buttonClass('secondary')}
              >
                Last ned (Excel)
              </a>
            ) : (
              <span aria-disabled="true" title="Ingen påmeldinger å laste ned ennå" className={buttonClass('secondary')}>
                Last ned (Excel)
              </span>
            )}
          </>
        }
      />

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
                <label htmlFor="add-course" className="block text-sm font-medium text-gray-700 mb-1">Kurs</label>
                <div className="relative" ref={courseDropdownRef}>
                  <input
                    id="add-course"
                    aria-invalid={!!courseError}
                    aria-describedby={courseError ? 'add-course-error' : undefined}
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
                              setCourseError(null);
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
                {courseError && (
                  <p id="add-course-error" className="mt-1 text-sm text-red-700">{courseError}</p>
                )}
              </div>

              {/* Parent section */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 border-b border-gray-100 pb-2">{personLabel}</h3>
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

              {!isAdultCourse && (
                <div>
                  <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-2">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Barn ({children.length})
                    </h3>
                    <button
                      type="button"
                      onClick={addChild}
                      className="text-sm text-bjerke-blue hover:text-bjerke-blue-dark font-medium"
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
              )}
              <fieldset>
                <legend className="text-sm font-semibold text-gray-900 mb-1 border-b border-gray-100 pb-2 w-full">
                  Samtykker fra {personLabel.toLowerCase()}
                </legend>
                <p className="text-xs text-gray-500 mb-3">
                  Kryss kun av for samtykker {isAdultCourse ? 'deltakeren' : 'foresatte'} faktisk har gitt (f.eks. på e-post eller telefon).
                  Påmeldingen registreres som lagt inn av admin.
                </p>
                <div className="space-y-2">
                  {consentOptions.map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={addOptions[key]}
                        onChange={(e) => setAddOptions((prev) => ({ ...prev, [key]: e.target.checked }))}
                        className="rounded border-gray-300"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-semibold text-gray-900 mb-3 border-b border-gray-100 pb-2 w-full">
                  Kapasitet og aldersgrense
                </legend>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={addOptions.waitlist}
                      onChange={(e) => setAddOptions((prev) => ({ ...prev, waitlist: e.target.checked }))}
                      className="mt-0.5 rounded border-gray-300"
                    />
                    <span>
                      Sett på venteliste hvis kurset er fullt
                      <span className="block text-xs text-gray-500">Ledige plasser fylles først, resten havner på ventelisten.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={addOptions.overrideCapacity}
                      onChange={(e) => {
                        const overrideCapacity = e.target.checked;
                        // Overstyrte påmeldinger er ofte etterregistreringer — e-post er da av som standard.
                        setAddOptions((prev) => ({ ...prev, overrideCapacity, sendEmails: !overrideCapacity }));
                      }}
                      className="mt-0.5 rounded border-gray-300"
                    />
                    <span>
                      Meld på selv om kurset er fullt eller deltakeren har feil alder
                      <span className="block text-xs text-gray-500">
                        {isAdultCourse
                          ? 'Bekrefter deltakeren selv om kurset er fullt eller stengt.'
                          : 'Bekrefter alle selv om kurset er fullt eller stengt, eller barnet er utenfor aldersgrensen.'}
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-semibold text-gray-900 mb-3 border-b border-gray-100 pb-2 w-full">
                  E-post
                </legend>
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={addOptions.sendEmails}
                    onChange={(e) => setAddOptions((prev) => ({ ...prev, sendEmails: e.target.checked }))}
                    className="mt-0.5 rounded border-gray-300"
                  />
                  <span>
                    Send de vanlige e-postene til {personLabel.toLowerCase()}
                    <span className="block text-xs text-gray-500">Samme e-poster som når noen melder seg på via nettsiden (f.eks. bekreftelse og påminnelse). Slå av hvis du bare fører inn en gammel påmelding.</span>
                  </span>
                </label>
              </fieldset>
            </div>

            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
              <Button type="submit" loading={submitting} loadingLabel="Legger til …">
                {!isAdultCourse && children.length > 1
                  ? `Legg til ${children.filter((c) => c.firstName.trim()).length} deltakere`
                  : 'Legg til deltaker'}
              </Button>
              <Button variant="secondary" onClick={() => setShowAddForm(false)}>
                Avbryt
              </Button>
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
            onChange={(e) => {
              setPage(1);
              setSearchQuery(e.target.value);
            }}
            aria-label="Søk"
            placeholder="Søk etter kurs, barn, forelder eller e-post …"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
          />
        </div>
        <select
          value={courseFilter}
          aria-label="Kurs"
          onChange={(e) => {
            setPage(1);
            setCourseFilter(e.target.value);
          }}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent bg-white"
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
          aria-label="Status"
          onChange={(e) => {
            setPage(1);
            setStatusFilter(e.target.value);
          }}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent bg-white"
        >
          <option value="all">Alle statuser</option>
          <option value="pending">Venter</option>
          <option value="confirmed">Bekreftet</option>
          <option value="waitlist">Venteliste</option>
          <option value="cancelled">Avlyst</option>
        </select>
        <select
          value={paymentFilter}
          aria-label="Betaling"
          onChange={(e) => {
            setPage(1);
            setPaymentFilter(e.target.value as PaymentFilter);
          }}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent bg-white"
        >
          <option value="all">Alle betalinger</option>
          <option value="paid">Betalt på nett</option>
          <option value="ikke-fullfort">Betaling ikke fullført</option>
          <option value="none">Ingen nettbetaling</option>
        </select>
      </div>

      {/* Result count */}
      <p className="text-sm text-gray-500 mb-3">
        Viser {filteredRegistrations.length} av {registrations.length} påmeldinger
      </p>

      {/* Bulk action bar */}
      {visibleSelectedCount > 0 && (
        <div className="sticky top-16 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bjerke-blue/30 bg-blue-50 px-4 py-3">
          <span className="text-sm font-medium text-gray-900">{visibleSelectedCount} valgt</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => bulkUpdateStatus('confirmed')} loading={bulkUpdating && bulkTargetStatus === 'confirmed'} disabled={bulkUpdating}>
              Bekreft valgte
            </Button>
            <Button size="sm" variant="secondary" onClick={() => bulkUpdateStatus('cancelled')} loading={bulkUpdating && bulkTargetStatus === 'cancelled'} disabled={bulkUpdating}>
              Avlys valgte
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSelectedIds(new Set())}>
              Fjern valg
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {registrations.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-900 font-medium">Ingen påmeldinger ennå</p>
          <p className="text-gray-500 mt-1 mb-4">
            Når noen melder seg på via nettsiden, dukker de opp her. Du kan også legge inn en påmelding selv.
          </p>
          <Button onClick={openAddForm}>+ Legg til deltaker</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Mobil: én påmelding per kort */}
          <ul className="divide-y divide-gray-100 md:hidden">
            {paginatedRegistrations.map((reg) => (
              <li key={reg.id} className={`space-y-2 p-4 ${selectedIds.has(reg.id) ? 'bg-blue-50' : ''}`}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(reg.id)}
                    onChange={() => toggleSelect(reg.id)}
                    aria-label={`Velg ${reg.child?.name ?? reg.parent.name}`}
                    className="mt-1 h-5 w-5 rounded border-gray-300 text-bjerke-blue focus:ring-bjerke-blue"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">{reg.child?.name ?? `${reg.parent.name} (voksen)`}</p>
                    <Link href={`/admin/courses/${reg.course.id}`} className="text-sm text-bjerke-blue hover:underline">
                      {reg.course.name}
                    </Link>
                  </div>
                  <StatusSelect reg={reg} busy={updatingId === reg.id} onChange={(status) => updateStatus(reg.id, status)} />
                </div>
                <div className="pl-8 text-sm text-gray-700">
                  {reg.child && <p>Foresatt: {reg.parent.name}</p>}
                  <p className="flex flex-wrap gap-x-3">
                    <a href={`mailto:${reg.parent.user?.email}`} className="break-all text-bjerke-blue hover:underline">{reg.parent.user?.email}</a>
                    {reg.parent.phone && (
                      <a href={`tel:${reg.parent.phone}`} className="whitespace-nowrap text-bjerke-blue hover:underline">{formatPhone(reg.parent.phone)}</a>
                    )}
                  </p>
                  {reg.child?.allergies && <p className="mt-1 text-amber-900">Allergier: {reg.child.allergies}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-8">
                  <PaymentBadge status={reg.paymentStatus} />
                  <span className="text-sm text-gray-600">{new Date(reg.createdAt).toLocaleDateString('nb-NO')}</span>
                  <span className="ml-auto flex gap-4">
                    <button type="button" onClick={() => setEditTarget(reg)} className={buttonClass('link', 'sm')}>Rediger</button>
                    <button type="button" onClick={() => requestDeleteRegistration(reg.id)} className={buttonClass('dangerText', 'sm')}>Slett</button>
                  </span>
                </div>
              </li>
            ))}
            {paginatedRegistrations.length === 0 && (
              <li className="px-4 py-12 text-center text-gray-600">Ingen påmeldinger passer med filteret.</li>
            )}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-gray-300 text-bjerke-blue focus:ring-bjerke-blue cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">Kurs</th>
                  <th className="px-4 py-3 text-left">Barn</th>
                  <th className="px-4 py-3 text-left">Forelder</th>
                  <th className="px-4 py-3 text-left">E-post</th>
                  <th className="px-4 py-3 text-left">Telefon</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Betaling</th>
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
                        className="h-4 w-4 rounded border-gray-300 text-bjerke-blue focus:ring-bjerke-blue cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3.5 text-gray-500 font-mono text-xs">#{reg.id}</td>
                    <td className="px-4 py-3.5 font-medium text-gray-900">
                      <Link
                        href={`/admin/courses/${reg.course.id}`}
                        className="hover:text-bjerke-blue hover:underline"
                      >
                        {reg.course.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-gray-700">{reg.child?.name ?? `${reg.parent.name} (voksen)`}</td>
                    <td className="px-4 py-3.5 text-gray-700">{reg.parent.name}</td>
                    <td className="px-4 py-3.5 text-gray-600">{reg.parent.user?.email}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-gray-600">{formatPhone(reg.parent.phone)}</td>
                    <td className="px-4 py-3.5">
                      <StatusSelect reg={reg} busy={updatingId === reg.id} onChange={(status) => updateStatus(reg.id, status)} />
                    </td>
                    <td className="px-4 py-3.5">
                      <PaymentBadge status={reg.paymentStatus} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-gray-600">
                      {new Date(reg.createdAt).toLocaleDateString('nb-NO')}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => setEditTarget(reg)} className={buttonClass('link', 'sm')}>
                          Rediger
                        </button>
                        <button type="button" onClick={() => requestDeleteRegistration(reg.id)} className={buttonClass('dangerText', 'sm')}>
                          Slett
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {paginatedRegistrations.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-gray-600">
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
      {editTarget && (
        <RegistrationEditModal
          key={editTarget.id}
          registration={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={applyEditedRegistration}
        />
      )}

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={showDeleteModal}
        title="Slette påmeldingen?"
        message="Påmeldingen og kortet i salgstavla fjernes for godt. Vil du bare melde av deltakeren, sett status til «Avlyst» i stedet – da får neste på ventelisten plassen. Betalte påmeldinger kan ikke slettes."
        confirmLabel="Ja, slett"
        variant="danger"
        loading={deletingReg}
        onConfirm={confirmDeleteRegistration}
        onCancel={() => { setShowDeleteModal(false); setDeleteTargetId(null); }}
      />

      {/* Bulk update confirmation modal */}
      <ConfirmModal
        open={showBulkModal}
        title={bulkTargetStatus === 'confirmed' ? 'Bekrefte påmeldingene?' : 'Avlyse påmeldingene?'}
        message={
          bulkTargetStatus === 'confirmed'
            ? `${selectedIds.size === 1 ? '1 påmelding' : `${selectedIds.size} påmeldinger`} får status «Bekreftet». Har dere en aktiv e-postflyt for bekreftede påmeldinger, får de det gjelder e-post.`
            : `${selectedIds.size === 1 ? '1 påmelding' : `${selectedIds.size} påmeldinger`} får status «Avlyst». Ledige plasser går automatisk til de som står på venteliste.`
        }
        confirmLabel={bulkTargetStatus === 'confirmed' ? 'Ja, bekreft' : 'Ja, avlys'}
        variant={bulkTargetStatus === 'confirmed' ? 'info' : 'danger'}
        loading={bulkUpdating}
        onConfirm={confirmBulkUpdate}
        onCancel={() => setShowBulkModal(false)}
      />
    </div>
  );
}
