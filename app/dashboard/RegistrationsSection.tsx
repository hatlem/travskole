'use client';

import { useId, useState } from 'react';
import { useStrings } from '@/components/SettingsProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatDateRange, formatKr, formatLongDate, payButtonLabel, type PayProvider } from '@/lib/buyer-display';
import { registrationStatus, STATUS_TONE_CLASS } from '@/lib/buyer-status';
import { buyerPaymentBadge, isUnpaidStatus } from '@/lib/payments/badge';
import type { DashboardRegistration } from './types';

/** Online betaling er aktuelt: pris, betalingsmåte, og plassen er verken avbestilt eller på venteliste. */
export function requiresOnlinePayment(r: DashboardRegistration): boolean {
  return (
    r.priceKr !== null && r.priceKr > 0 && r.payableMethods.length > 0 && r.status !== 'cancelled' && r.status !== 'waitlist'
  );
}

function paymentText(r: DashboardRegistration): string {
  if (r.paymentStatus === 'paid') return 'Betalt';
  if (r.paymentStatus === 'refunded') return 'Refundert';
  if (r.priceKr === null || r.priceKr <= 0) return 'Gratis';
  if (r.status === 'waitlist') return 'Ingen betaling før du får plass';
  if (r.status === 'cancelled') return 'Ingenting å betale';
  if (requiresOnlinePayment(r)) return r.paymentStatus === 'failed' ? 'Betalingen feilet – prøv igjen' : 'Ikke betalt ennå';
  return 'Faktura sendes på e-post';
}

interface RegistrationsSectionProps {
  registrations: DashboardRegistration[];
  onCancelled: (id: number) => void;
  notify: (message: string) => void;
}

export function RegistrationsSection({ registrations, onCancelled, notify }: RegistrationsSectionProps) {
  const t = useStrings();
  const baseId = useId();
  const [openId, setOpenId] = useState<number | null>(null);
  const [payingId, setPayingId] = useState<number | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DashboardRegistration | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function payNow(registrationId: number, provider: PayProvider) {
    setPayingId(registrationId);
    setPayError(null);
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId, provider }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error ?? 'Betalingen kunne ikke startes. Prøv igjen.');
      window.location.assign(body.url);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Betalingen kunne ikke startes. Prøv igjen.');
      setPayingId(null);
    }
  }

  async function confirmCancel() {
    if (!confirming) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/dashboard/registrations/${confirming.id}/cancel`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Kunne ikke avbestille. Prøv igjen.');
      onCancelled(confirming.id);
      setConfirming(null);
      notify(t('dash.cancel_registration_done'));
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Kunne ikke avbestille. Prøv igjen.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <section aria-labelledby={`${baseId}-heading`}>
      <h2 id={`${baseId}-heading`} className="mb-4 text-xl font-semibold text-gray-900">{t('dash.registrations_heading')}</h2>
      {payError && (
        <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {payError}
        </div>
      )}

      {registrations.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 text-gray-600">{t('dash.no_registrations')}</div>
      ) : (
        <ul className="space-y-3">
          {registrations.map((r) => {
            const status = registrationStatus(r.status, r.cancelledBySelf);
            const paymentBadge = buyerPaymentBadge(r.paymentStatus, requiresOnlinePayment(r));
            const canPay = requiresOnlinePayment(r) && isUnpaidStatus(r.paymentStatus);
            const expanded = openId === r.id;
            const panelId = `${baseId}-reg-${r.id}`;
            return (
              <li key={r.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{r.courseName}</p>
                    <p className="text-sm text-gray-600">
                      {r.participantName} · {formatDateRange(r.courseStartDate, r.courseEndDate)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${STATUS_TONE_CLASS[status.tone]}`}>
                      {t(status.key)}
                    </span>
                    {paymentBadge && (
                      <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${paymentBadge.className}`}>
                        {paymentBadge.label}
                      </span>
                    )}
                  </div>
                </div>

                {canPay && (
                  <div className="flex flex-col gap-2 px-4 pb-4 sm:flex-row sm:px-5">
                    {r.payableMethods.includes('vipps') && (
                      <button
                        type="button"
                        onClick={() => payNow(r.id, 'vipps')}
                        disabled={payingId !== null}
                        className="min-h-11 rounded-lg bg-[#ff5b24] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#e64d1a] disabled:opacity-60"
                      >
                        {payingId === r.id ? 'Starter …' : payButtonLabel('vipps', r.priceKr)}
                      </button>
                    )}
                    {r.payableMethods.includes('stripe') && (
                      <button
                        type="button"
                        onClick={() => payNow(r.id, 'stripe')}
                        disabled={payingId !== null}
                        className="min-h-11 rounded-lg bg-bjerke-blue px-4 text-sm font-semibold text-white transition-colors hover:bg-bjerke-blue-dark disabled:opacity-60"
                      >
                        {payingId === r.id ? 'Starter …' : payButtonLabel('stripe', r.priceKr)}
                      </button>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-2 sm:px-3">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setOpenId(expanded ? null : r.id)}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-bjerke-blue hover:bg-blue-50"
                  >
                    {expanded ? t('dash.details_hide') : t('dash.details_show')}
                    <svg aria-hidden="true" className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  {r.cancellable && (
                    <button
                      type="button"
                      onClick={() => { setCancelError(null); setConfirming(r); }}
                      className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                    >
                      {t('dash.cancel_registration')}
                    </button>
                  )}
                </div>

                {expanded && (
                  <dl id={panelId} className="grid gap-3 border-t border-gray-100 px-4 py-4 text-sm sm:grid-cols-2 sm:px-5">
                    <div><dt className="text-gray-500">Pris</dt><dd className="font-medium text-gray-900 tabular-nums">{r.priceKr && r.priceKr > 0 ? formatKr(r.priceKr) : 'Gratis'}</dd></div>
                    <div><dt className="text-gray-500">Betaling</dt><dd className="font-medium text-gray-900">{paymentText(r)}</dd></div>
                    <div><dt className="text-gray-500">{r.childName ? 'Barn' : 'Deltaker'}</dt><dd className="font-medium text-gray-900">{r.participantName}</dd></div>
                    <div><dt className="text-gray-500">Påmeldt</dt><dd className="font-medium text-gray-900">{formatLongDate(r.createdAt)}</dd></div>
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={t('dash.cancel_registration_title')}
        message={confirming ? t('dash.cancel_registration_body', { kurs: confirming.courseName, deltaker: confirming.participantName }) : ''}
        confirmLabel={t('dash.cancel_registration')}
        cancelLabel={t('dash.keep')}
        busy={cancelling}
        busyLabel="Avbestiller …"
        error={cancelError}
        onConfirm={confirmCancel}
        onCancel={() => setConfirming(null)}
      />
    </section>
  );
}
