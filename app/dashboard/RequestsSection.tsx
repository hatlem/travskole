'use client';

import { useState } from 'react';
import { useStrings } from '@/components/SettingsProvider';
import { BookingCheckout } from '@/components/BookingCheckout';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatKr, formatLongDate, participantsLabel } from '@/lib/buyer-display';
import { bookingStatus, STATUS_TONE_CLASS } from '@/lib/buyer-status';
import { buyerPaymentBadge } from '@/lib/payments/badge';
import type { DashboardBooking } from './types';

interface RequestsSectionProps {
  bookings: DashboardBooking[];
  onWithdrawn: (id: number) => void;
  notify: (message: string) => void;
}

/** «Mine forespørsler» (tidligere /mine-bookinger) som en del av Min side. */
export function RequestsSection({ bookings, onWithdrawn, notify }: RequestsSectionProps) {
  const t = useStrings();
  const [confirming, setConfirming] = useState<DashboardBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmWithdraw() {
    if (!confirming) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/bookings/${confirming.id}/cancel`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Kunne ikke trekke forespørselen. Prøv igjen.');
      onWithdrawn(confirming.id);
      setConfirming(null);
      notify(t('dash.withdraw_request_done'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke trekke forespørselen. Prøv igjen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="foresporsler" aria-labelledby="foresporsler-heading" className="scroll-mt-24">
      <h2 id="foresporsler-heading" className="mb-4 text-xl font-semibold text-gray-900">{t('dash.requests_heading')}</h2>
      {bookings.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 text-gray-600">{t('dash.no_requests')}</div>
      ) : (
        <ul className="space-y-3">
          {bookings.map((b) => {
            const status = bookingStatus(b.status, b.withdrawnBySelf);
            const badge = buyerPaymentBadge(b.paymentStatus, b.requiresPayment);
            const details = [
              participantsLabel(b.participants),
              b.amountKr != null && b.amountKr > 0 ? formatKr(b.amountKr) : null,
              b.preferredDate ? `ønsket ${formatLongDate(b.preferredDate)}` : null,
            ].filter(Boolean);
            return (
              <li key={b.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{b.courseName}</p>
                    <p className="text-sm text-gray-600">{details.join(' · ')}</p>
                    <p className="text-sm text-gray-500">Sendt {formatLongDate(b.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${STATUS_TONE_CLASS[status.tone]}`}>
                      {t(status.key)}
                    </span>
                    {badge && (
                      <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${badge.className}`}>{badge.label}</span>
                    )}
                  </div>
                </div>
                {b.providers.length > 0 && (
                  <div className="mt-3">
                    <BookingCheckout bookingRequestId={b.id} providers={b.providers} amountKr={b.amountKr} />
                  </div>
                )}
                {b.cancellable && (
                  <div className="mt-2 flex justify-end border-t border-gray-100 pt-1">
                    <button
                      type="button"
                      onClick={() => { setError(null); setConfirming(b); }}
                      className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                    >
                      {t('dash.withdraw_request')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={t('dash.withdraw_request_title')}
        message={confirming ? t('dash.withdraw_request_body', { kurs: confirming.courseName }) : ''}
        confirmLabel={t('dash.withdraw_request')}
        cancelLabel={t('dash.keep')}
        busy={busy}
        busyLabel="Trekker …"
        error={error}
        onConfirm={confirmWithdraw}
        onCancel={() => setConfirming(null)}
      />
    </section>
  );
}
