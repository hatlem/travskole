'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { LoginLinkOffer } from '@/components/LoginLinkOffer';
import { useStrings } from '@/components/SettingsProvider';
import { participantsLabel, payButtonLabel, type PayProvider } from '@/lib/buyer-display';
import { loadReceipt, nextSteps, paymentStatusText, type Receipt } from '@/lib/receipt';

/** Leser kvitteringen etter mount (sessionStorage finnes ikke på serveren). */
export function useStoredReceipt(): { receipt: Receipt | null; ready: boolean } {
  const [state, setState] = useState<{ receipt: Receipt | null; ready: boolean }>({ receipt: null, ready: false });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage kan bare leses i nettleseren
    setState({ receipt: loadReceipt(), ready: true });
  }, []);
  return state;
}

export function ReceiptSummaryCard({ receipt, paid = false }: { receipt: Receipt; paid?: boolean }) {
  const rows: [string, string][] = [
    ['Arrangement', receipt.courseName],
    [receipt.kind === 'booking' ? 'Ønsket tid' : 'Dato', receipt.dateText],
  ];
  if (receipt.place) rows.push(['Sted', receipt.place]);
  if (receipt.participant) rows.push([receipt.kind === 'booking' ? 'Navn' : 'Deltaker', receipt.participant]);
  if (receipt.participants) rows.push(['Antall', participantsLabel(receipt.participants)]);
  rows.push(['Pris', receipt.priceText]);
  rows.push(['Betaling', paymentStatusText(receipt, paid)]);
  return (
    <dl className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 px-4 py-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
          <dt className="text-gray-600">{label}</dt>
          <dd className="font-medium text-gray-900 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Betal-knapper for en fersk, ubetalt påmelding — fungerer uten innlogging via checkout-token. */
export function PayNowButtons({ receipt }: { receipt: Receipt }) {
  const [busy, setBusy] = useState<PayProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (receipt.kind !== 'registration' || receipt.providers.length === 0 || !receipt.amountKr) return null;

  async function pay(provider: PayProvider) {
    setBusy(provider);
    setError(null);
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationId: receipt.id,
          provider,
          ...(receipt.checkoutToken ? { token: receipt.checkoutToken } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) {
        setError(
          res.status === 401 || res.status === 403
            ? 'Betalingslenken har utløpt. Logg inn med en lenke på e-post for å betale fra Min side.'
            : 'Betalingen kunne ikke startes. Prøv igjen om litt.'
        );
        setBusy(null);
        return;
      }
      window.location.assign(body.url);
    } catch {
      setError('Betalingen kunne ikke startes. Sjekk nettforbindelsen og prøv igjen.');
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        {receipt.providers.includes('vipps') && (
          <button
            type="button"
            onClick={() => pay('vipps')}
            disabled={busy !== null}
            className="min-h-12 rounded-lg bg-[#ff5b24] px-6 font-semibold text-white transition-colors hover:bg-[#e64d1a] disabled:opacity-60"
          >
            {busy === 'vipps' ? 'Starter Vipps …' : payButtonLabel('vipps', receipt.amountKr)}
          </button>
        )}
        {receipt.providers.includes('stripe') && (
          <button
            type="button"
            onClick={() => pay('stripe')}
            disabled={busy !== null}
            className="min-h-12 rounded-lg bg-bjerke-blue px-6 font-semibold text-white transition-colors hover:bg-bjerke-blue-dark disabled:opacity-60"
          >
            {busy === 'stripe' ? 'Starter betaling …' : payButtonLabel('stripe', receipt.amountKr)}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** Videre-handlinger: innlogget → Min side; anonym → innloggingslenke (aldri en innloggingsmur). */
export function BuyerNextActions({ email, kind = 'registration' }: { email?: string; kind?: Receipt['kind'] }) {
  const t = useStrings();
  const { status } = useSession();
  const loggedIn = status === 'authenticated';
  return (
    <div className="space-y-6">
      {!loggedIn && status !== 'loading' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900">Se påmeldingene dine senere</h2>
          <div className="mt-2">
            <LoginLinkOffer key={email ?? ''} email={email} hint={t('receipt.login_hint')} label={t('receipt.send_login_link')} />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        {loggedIn && (
          <Link
            href={kind === 'booking' ? '/dashboard#foresporsler' : '/dashboard'}
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-bjerke-blue px-6 font-semibold text-white transition-colors hover:bg-bjerke-blue-dark"
          >
            {kind === 'booking' ? t('request.see_my_requests') : t('receipt.to_my_page')}
          </Link>
        )}
        <Link
          href="/arrangementer"
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-gray-300 bg-white px-6 font-semibold text-gray-800 transition-colors hover:bg-gray-50"
        >
          {t('receipt.to_events')}
        </Link>
      </div>
    </div>
  );
}

export function NextStepsList({ receipt, paid = false }: { receipt: Receipt; paid?: boolean }) {
  const t = useStrings();
  const steps = nextSteps(receipt, t('request.response_time'), paid);
  return (
    <section aria-labelledby="next-steps-heading">
      <h2 id="next-steps-heading" className="text-lg font-semibold text-gray-900">
        {t('receipt.next_heading')}
      </h2>
      <ol className="mt-3 space-y-3">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3 text-gray-700">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-bjerke-blue tabular-nums"
            >
              {i + 1}
            </span>
            <span className="text-pretty">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
