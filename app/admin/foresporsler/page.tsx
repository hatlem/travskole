'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { useToast } from '@/components/admin/Toast';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button, buttonClass } from '@/components/admin/Button';
import { Badge } from '@/components/admin/StatusBadge';
import { adminBookingStatusLabel } from '@/lib/bookings/withdrawn';
import { paymentStatusBadge } from '@/lib/payments/badge';
import { isSettledPaymentStatus } from '@/lib/payments/transitions';
import { formatPhone } from '@/lib/admin-format';
import { bulkConfirmBody, sharedPreferredDay } from '@/lib/bookings/bulk-confirm';
import { ConfirmBookingDrawer, type BookingConfirmResult } from './ConfirmBookingDrawer';

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
  paymentStatus?: string;
  withdrawnByCustomer?: boolean;
  course?: { name: string } | null;
  crm?: { dealId: number | null; contactId: number | null };
}

type StatusFilter = 'all' | 'new' | 'confirmed' | 'cancelled';

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'new', label: 'Nye' },
  { value: 'confirmed', label: 'Bekreftet' },
  { value: 'cancelled', label: 'Avvist/trukket' },
  { value: 'all', label: 'Alle' },
];

const DESCRIPTION =
  'Folk som har bedt om et tidspunkt, f.eks. til bursdag eller firmatur. Bekreft med avtalt tidspunkt, så får de e-post — eller avvis.';

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-900',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-200 text-gray-700',
};

const inputClass =
  'w-full min-h-10 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-bjerke-blue';

const formatDateTime = (value: string) =>
  new Date(value).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function AdminForesporslerPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('new');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkAction, setBulkAction] = useState<'confirmed' | 'cancelled' | null>(null);
  const [bulkDate, setBulkDate] = useState('');
  const [bulkTime, setBulkTime] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<Booking | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Booking | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Booking | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/bookings');
        if (!res.ok) throw new Error('Kunne ikke hente forespørslene. Last siden på nytt.');
        const data = await res.json();
        const list: Booking[] = data.bookings || [];
        setBookings(list);
        // Ingen nye? Vis alle i stedet for en tom liste.
        if (!list.some((b) => b.status === 'new')) setStatusFilter('all');
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Noe gikk galt.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const counts = useMemo(
    () => ({
      all: bookings.length,
      new: bookings.filter((b) => b.status === 'new').length,
      confirmed: bookings.filter((b) => b.status === 'confirmed').length,
      cancelled: bookings.filter((b) => b.status === 'cancelled').length,
    }),
    [bookings],
  );

  const filteredBookings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (!q) return true;
      return b.name.toLowerCase().includes(q) || b.email.toLowerCase().includes(q) || b.phone.toLowerCase().includes(q);
    });
  }, [bookings, search, statusFilter]);

  const newFilteredIds = useMemo(() => filteredBookings.filter((b) => b.status === 'new').map((b) => b.id), [filteredBookings]);

  function patchBooking(id: number, patch: Partial<Booking>) {
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function onConfirmed(id: number, result: BookingConfirmResult) {
    const booking = bookings.find((b) => b.id === id);
    patchBooking(id, { status: 'confirmed', confirmedAt: result.confirmedAt, cancelledAt: null, crm: result.crm });
    setConfirmTarget(null);
    const pipelineAction = result.crm.dealId ? { label: 'Se avtalen i salgstavlen', href: `/admin/crm/pipeline?deal=${result.crm.dealId}` } : undefined;
    if (result.emailSent) {
      toast(`Forespørselen er bekreftet, og ${booking?.name ?? 'kunden'} har fått e-post.`, 'success', { action: pipelineAction });
    } else {
      toast(
        `Forespørselen er bekreftet, men e-posten til ${booking?.email ?? 'kunden'} ble ikke sendt. Ta kontakt direkte.`,
        'error',
        { action: pipelineAction },
      );
    }
  }

  async function reject() {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const res = await fetch(`/api/admin/bookings/${rejectTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      if (!res.ok) throw new Error('Svaret ble ikke lagret. Prøv igjen.');
      patchBooking(rejectTarget.id, { status: 'cancelled', cancelledAt: new Date().toISOString(), withdrawnByCustomer: false });
      toast(`Forespørselen fra ${rejectTarget.name} er avvist.`, 'success');
      setRejectTarget(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.', 'error');
    } finally {
      setRejecting(false);
    }
  }

  async function deleteBooking() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/bookings/${deleteTarget.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Forespørselen ble ikke slettet. Prøv igjen.');
      const id = deleteTarget.id;
      setBookings((prev) => prev.filter((b) => b.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast(
        body?.dealsRemoved ? 'Forespørselen og kortet i salgstavla er slettet.' : 'Forespørselen er slettet.',
        'success',
      );
      setDeleteTarget(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.', 'error');
    } finally {
      setDeleting(false);
    }
  }

  const selectedBookings = useMemo(() => bookings.filter((b) => selected.has(b.id)), [bookings, selected]);
  // Ett avtalt tidspunkt for alle gir bare mening når alle har ønsket samme dag.
  const bulkSharedDay = useMemo(() => sharedPreferredDay(selectedBookings.map((b) => b.preferredDate)), [selectedBookings]);

  function openBulk(action: 'confirmed' | 'cancelled') {
    setBulkDate(bulkSharedDay ?? '');
    setBulkTime('');
    setBulkAction(action);
  }

  /** Bekreft: samme rute og e-post som skuffen (uten hilsen). Avvis: vanlig statusendring. */
  function bulkRequest(id: number, action: 'confirmed' | 'cancelled') {
    if (action === 'confirmed') {
      const shared = bulkSharedDay ? { date: bulkDate, time: bulkTime } : null;
      return fetch(`/api/admin/bookings/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bulkConfirmBody(shared)),
      });
    }
    return fetch(`/api/admin/bookings/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
  }

  async function bulkUpdateStatus() {
    const action = bulkAction;
    if (!action || selected.size === 0) return;
    setBulkProcessing(true);
    const ids = Array.from(selected);
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await bulkRequest(id, action);
          if (!res.ok) return null;
          const body = await res.json().catch(() => null);
          return { id, emailSent: body?.emailSent !== false, crm: body?.crm as Booking['crm'] | undefined };
        } catch {
          return null;
        }
      }),
    );
    const ok = results.filter((r): r is NonNullable<typeof r> => r !== null);
    const okIds = new Set(ok.map((r) => r.id));
    const now = new Date().toISOString();
    setBookings((prev) =>
      prev.map((b) => {
        const r = ok.find((x) => x.id === b.id);
        if (!r) return b;
        return action === 'confirmed'
          ? { ...b, status: 'confirmed', confirmedAt: now, cancelledAt: null, crm: r.crm ?? b.crm }
          : { ...b, status: 'cancelled', cancelledAt: now, withdrawnByCustomer: false };
      }),
    );
    setSelected(new Set(ids.filter((id) => !okIds.has(id))));
    const noEmail = ok.filter((r) => !r.emailSent).length;
    const done = ok.length === 1 ? '1 forespørsel' : `${ok.length} forespørsler`;
    if (ok.length < ids.length) {
      toast(`${ids.length - ok.length} av ${ids.length} ble ikke oppdatert. De er fortsatt valgt — prøv igjen.`, 'error');
    } else if (action === 'confirmed' && noEmail > 0) {
      toast(`${done} er bekreftet, men ${noEmail} fikk ikke e-post. Ta kontakt med dem direkte.`, 'error');
    } else if (action === 'confirmed') {
      toast(`${done} er bekreftet, og alle har fått e-post.`, 'success');
    } else {
      toast(`${done} er avvist.`, 'success');
    }
    setBulkAction(null);
    setBulkProcessing(false);
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const all = newFilteredIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      newFilteredIds.forEach((id) => (all ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Forespørsler" description={DESCRIPTION} />
        <TableSkeleton />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Forespørsler" description={DESCRIPTION} />

      {loadError && (
        <p role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </p>
      )}

      {/* Filter med antall — erstatter tallkortene */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div role="group" aria-label="Vis forespørsler" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = statusFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(f.value)}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue focus-visible:ring-offset-1 ${
                  active ? 'border-bjerke-blue bg-bjerke-blue text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {f.label}
                <span className={`tabular-nums ${active ? 'text-white/80' : 'text-gray-500'}`}>{counts[f.value]}</span>
              </button>
            );
          })}
        </div>
        <div className="relative sm:ml-auto sm:w-72">
          <label htmlFor="booking-search" className="sr-only">Søk</label>
          <input
            id="booking-search"
            type="search"
            placeholder="Søk etter navn, e-post eller telefon …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-bjerke-blue"
          />
        </div>
      </div>

      {/* Massehandlinger */}
      {newFilteredIds.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
          <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={newFilteredIds.every((id) => selected.has(id))}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-gray-300 text-bjerke-blue focus:ring-bjerke-blue"
            />
            Velg alle nye ({newFilteredIds.length})
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-sm font-medium text-gray-700">{selected.size} valgt</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => openBulk('confirmed')} disabled={bulkProcessing}>
                  Bekreft valgte
                </Button>
                <Button size="sm" variant="secondary" onClick={() => openBulk('cancelled')} disabled={bulkProcessing}>
                  Avvis valgte
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ul className="space-y-4">
        {filteredBookings.map((booking) => (
          <li key={booking.id}>
            <BookingCard
              booking={booking}
              onConfirm={setConfirmTarget}
              onReject={setRejectTarget}
              onDelete={setDeleteTarget}
              isSelected={selected.has(booking.id)}
              onToggleSelect={toggleSelect}
            />
          </li>
        ))}
      </ul>

      {filteredBookings.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <p className="font-medium text-gray-900">
            {bookings.length === 0 ? 'Ingen forespørsler ennå' : statusFilter === 'new' && !search ? 'Ingen nye forespørsler' : 'Ingen treff'}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {bookings.length === 0
              ? 'De kommer hit når noen ber om et tidspunkt på et arrangement med «Forespørsel» som påmeldingsmåte.'
              : statusFilter === 'new' && !search
                ? 'Alt er besvart. Bra jobba!'
                : 'Ingen forespørsler passer med søket eller filteret.'}
          </p>
          {bookings.length > 0 && statusFilter !== 'all' && (
            <Button variant="secondary" className="mt-4" onClick={() => setStatusFilter('all')}>
              Vis alle
            </Button>
          )}
        </div>
      )}

      <ConfirmBookingDrawer booking={confirmTarget} onClose={() => setConfirmTarget(null)} onConfirmed={onConfirmed} />

      <ConfirmModal
        open={rejectTarget !== null}
        title="Avvise forespørselen?"
        message={rejectTarget ? `${rejectTarget.name} får ikke tidspunktet${rejectTarget.course ? ` på «${rejectTarget.course.name}»` : ''}. Ring eller send e-post selv hvis du vil forklare hvorfor.` : ''}
        confirmLabel="Avvis"
        variant="warning"
        loading={rejecting}
        onConfirm={reject}
        onCancel={() => setRejectTarget(null)}
      />

      <ConfirmModal
        open={bulkAction !== null}
        title={bulkAction === 'confirmed' ? `Bekrefte ${selected.size} forespørsler?` : `Avvise ${selected.size} forespørsler?`}
        message={
          bulkAction === 'confirmed'
            ? bulkSharedDay
              ? 'Alle får samme bekreftelse på e-post som når du bekrefter én og én, uten personlig hilsen. Alle ønsket samme dag, så du kan sette ett avtalt tidspunkt for alle.'
              : 'Alle får samme bekreftelse på e-post som når du bekrefter én og én, men uten avtalt tidspunkt og personlig hilsen, siden de har ønsket ulike datoer. Vil du legge til det, bekreft dem én og én.'
            : 'De valgte forespørslene blir avvist.'
        }
        confirmLabel={bulkAction === 'confirmed' ? 'Bekreft alle' : 'Avvis alle'}
        variant={bulkAction === 'confirmed' ? 'info' : 'warning'}
        loading={bulkProcessing}
        onConfirm={bulkUpdateStatus}
        onCancel={() => setBulkAction(null)}
      >
        {bulkAction === 'confirmed' && bulkSharedDay && (
          <fieldset className="mt-4 text-left">
            <legend className="text-sm font-semibold text-gray-900">Avtalt tidspunkt for alle (valgfritt)</legend>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="bulk-date" className="mb-1 block text-sm text-gray-700">Dato</label>
                <input id="bulk-date" type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="bulk-time" className="mb-1 block text-sm text-gray-700">Klokkeslett</label>
                <input id="bulk-time" type="time" value={bulkTime} onChange={(e) => setBulkTime(e.target.value)} className={inputClass} />
              </div>
            </div>
          </fieldset>
        )}
      </ConfirmModal>

      <ConfirmModal
        open={deleteTarget !== null}
        title="Slette forespørselen?"
        message={
          deleteTarget
            ? `Forespørselen fra ${deleteTarget.name}${deleteTarget.course ? ` (${deleteTarget.course.name})` : ''} slettes for godt, sammen med kortet i salgstavla. Dette kan ikke angres.`
            : ''
        }
        confirmLabel="Ja, slett"
        variant="danger"
        loading={deleting}
        onConfirm={deleteBooking}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function BookingCard({
  booking,
  onConfirm,
  onReject,
  onDelete,
  isSelected,
  onToggleSelect,
}: {
  booking: Booking;
  onConfirm: (booking: Booking) => void;
  onReject: (booking: Booking) => void;
  onDelete: (booking: Booking) => void;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
}) {
  const statusLabel = adminBookingStatusLabel(booking.status, !!booking.withdrawnByCustomer);
  const payment = paymentStatusBadge(booking.paymentStatus);
  const paid = isSettledPaymentStatus(booking.paymentStatus ?? 'none');
  const isNew = booking.status === 'new';

  return (
    <article
      aria-labelledby={`booking-${booking.id}`}
      className={`rounded-xl border bg-white p-5 ${isSelected ? 'border-bjerke-blue ring-1 ring-bjerke-blue/30' : 'border-gray-200'}`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {isNew && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(booking.id)}
              aria-label={`Velg forespørselen fra ${booking.name}`}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-bjerke-blue focus:ring-bjerke-blue"
            />
          )}
          <div>
            <h2 id={`booking-${booking.id}`} className="font-semibold text-gray-900">
              {booking.name}
              {booking.course && <span className="font-normal text-gray-600"> · {booking.course.name}</span>}
            </h2>
            <p className="text-sm text-gray-600">Sendt {formatDateTime(booking.createdAt)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {payment && <Badge className={payment.className}>{payment.label}</Badge>}
          <Badge className={booking.withdrawnByCustomer ? 'bg-gray-200 text-gray-700' : STATUS_COLORS[booking.status] || 'bg-gray-100 text-gray-800'}>
            {statusLabel}
          </Badge>
        </div>
      </div>

      <dl className="mb-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <dt className="text-gray-600">E-post</dt>
          <dd><a href={`mailto:${booking.email}`} className="break-all text-bjerke-blue hover:underline">{booking.email}</a></dd>
        </div>
        <div>
          <dt className="text-gray-600">Telefon</dt>
          <dd><a href={`tel:${booking.phone}`} className="whitespace-nowrap text-bjerke-blue hover:underline">{formatPhone(booking.phone)}</a></dd>
        </div>
        <div>
          <dt className="text-gray-600">Deltakere</dt>
          <dd className="font-medium tabular-nums text-gray-900">{booking.participants}</dd>
        </div>
        <div>
          <dt className="text-gray-600">Ønsket dato</dt>
          <dd className="font-medium text-gray-900">
            {booking.preferredDate ? new Date(booking.preferredDate).toLocaleDateString('nb-NO', { timeZone: 'UTC' }) : 'Ikke oppgitt'}
          </dd>
        </div>
      </dl>

      {booking.message && <p className="mb-3 whitespace-pre-line rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{booking.message}</p>}

      {booking.confirmedAt && booking.status === 'confirmed' && (
        <p className="mb-2 text-sm text-gray-600">Bekreftet {formatDateTime(booking.confirmedAt)}</p>
      )}
      {booking.cancelledAt && booking.status === 'cancelled' && (
        <p className="mb-2 text-sm text-gray-600">
          {statusLabel} {formatDateTime(booking.cancelledAt)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 pt-3">
        {isNew && (
          <>
            <Button size="sm" onClick={() => onConfirm(booking)}>
              Bekreft …
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onReject(booking)}>
              Avvis
            </Button>
          </>
        )}
        {booking.crm?.dealId && (
          <Link href={`/admin/crm/pipeline?deal=${booking.crm.dealId}`} className={buttonClass('link', 'sm')}>
            Se avtalen i salgstavlen
          </Link>
        )}
        {booking.crm?.contactId && (
          <Link href={`/admin/crm/kontakter/${booking.crm.contactId}`} className={buttonClass('link', 'sm')}>
            Se kontakt
          </Link>
        )}
        <button
          type="button"
          onClick={() => onDelete(booking)}
          disabled={paid}
          title={paid ? 'Betalte forespørsler kan ikke slettes (regnskap)' : undefined}
          className={buttonClass('dangerText', 'sm', 'ml-auto')}
        >
          Slett
        </button>
      </div>
    </article>
  );
}
