'use client';

import { useEffect, useState } from 'react';
import { Drawer } from '@/components/admin/Drawer';
import { Button } from '@/components/admin/Button';
import { formatPhone } from '@/lib/admin-format';
import { isoDay } from '@/lib/bookings/bulk-confirm';

export interface ConfirmableBooking {
  id: number;
  name: string;
  email: string;
  phone: string;
  participants: number;
  preferredDate: string | null;
  message: string | null;
  course?: { name: string } | null;
}

export interface BookingConfirmResult {
  emailSent: boolean;
  confirmedAt: string;
  crm: { dealId: number | null; contactId: number | null };
}

const inputClass =
  'w-full min-h-10 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-bjerke-blue';

/**
 * Skuffen bak «Bekreft»: avtalt dato/klokkeslett, valgfri personlig hilsen og
 * forhåndsvisning av e-posten kunden får — før noe sendes.
 */
export function ConfirmBookingDrawer({
  booking,
  onClose,
  onConfirmed,
}: {
  booking: ConfirmableBooking | null;
  onClose: () => void;
  onConfirmed: (id: number, result: BookingConfirmResult) => void;
}) {
  return booking ? <DrawerBody key={booking.id} booking={booking} onClose={onClose} onConfirmed={onConfirmed} /> : null;
}

function DrawerBody({
  booking,
  onClose,
  onConfirmed,
}: {
  booking: ConfirmableBooking;
  onClose: () => void;
  onConfirmed: (id: number, result: BookingConfirmResult) => void;
}) {
  const [date, setDate] = useState(isoDay(booking.preferredDate));
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forhåndsvisningen følger feltene (litt forsinket, så den ikke hentes for hvert tastetrykk).
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/bookings/${booking.id}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'preview', date, time, note }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? 'Kunne ikke vise e-posten.');
        setPreview({ subject: data.subject, html: data.html });
        setPreviewError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setPreviewError(err instanceof Error ? err.message : 'Kunne ikke vise e-posten.');
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [booking.id, date, time, note]);

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'confirm', date, time, note }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Forespørselen ble ikke bekreftet. Prøv igjen.');
      onConfirmed(booking.id, {
        emailSent: data.emailSent,
        confirmedAt: data.booking?.confirmedAt ?? new Date().toISOString(),
        crm: data.crm ?? { dealId: null, contactId: null },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.');
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open
      title={`Bekreft forespørselen fra ${booking.name}`}
      description={booking.course?.name ?? undefined}
      busy={submitting}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Avbryt
          </Button>
          <Button onClick={confirm} loading={submitting} loadingLabel="Bekrefter …">
            Bekreft og send e-post
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-gray-50 p-4 text-sm">
          <div>
            <dt className="text-gray-600">Deltakere</dt>
            <dd className="font-medium text-gray-900">{booking.participants}</dd>
          </div>
          <div>
            <dt className="text-gray-600">Ønsket dato</dt>
            <dd className="font-medium text-gray-900">
              {booking.preferredDate ? new Date(booking.preferredDate).toLocaleDateString('nb-NO', { timeZone: 'UTC' }) : 'Ikke oppgitt'}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-gray-600">Kontakt</dt>
            <dd className="break-all text-gray-900">
              {booking.email} · {formatPhone(booking.phone)}
            </dd>
          </div>
          {booking.message && (
            <div className="col-span-2">
              <dt className="text-gray-600">Melding fra kunden</dt>
              <dd className="whitespace-pre-line text-gray-900">{booking.message}</dd>
            </div>
          )}
        </dl>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-gray-900">Avtalt tidspunkt</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="confirm-date" className="mb-1 block text-sm text-gray-700">Dato</label>
              <input id="confirm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="confirm-time" className="mb-1 block text-sm text-gray-700">Klokkeslett</label>
              <input id="confirm-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} />
            </div>
          </div>
          <p className="text-sm text-gray-600">
            Står i e-posten og som notat på avtalen i salgstavlen. Ønsket dato fra kunden endres ikke.
          </p>
        </fieldset>

        <div>
          <label htmlFor="confirm-note" className="mb-1 block text-sm font-semibold text-gray-900">
            Personlig hilsen <span className="font-normal text-gray-600">(valgfritt)</span>
          </label>
          <textarea
            id="confirm-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="F.eks. «Vi gleder oss til å se dere! Oppmøte ved hovedinngangen.»"
            className={`${inputClass} resize-y`}
          />
        </div>

        <section aria-labelledby="confirm-preview">
          <h3 id="confirm-preview" className="mb-2 text-sm font-semibold text-gray-900">
            E-posten {booking.name} får
          </h3>
          {previewError ? (
            <p className="text-sm text-red-700">{previewError}</p>
          ) : preview ? (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <p className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                <span className="text-gray-600">Emne:</span> <span className="font-medium text-gray-900">{preview.subject}</span>
              </p>
              <iframe
                title="Forhåndsvisning av bekreftelsen"
                sandbox=""
                srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:16px">${preview.html}</body>`}
                className="h-80 w-full bg-white"
              />
            </div>
          ) : (
            <div className="h-80 animate-pulse rounded-lg bg-gray-100" aria-hidden="true" />
          )}
        </section>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
      </div>
    </Drawer>
  );
}
