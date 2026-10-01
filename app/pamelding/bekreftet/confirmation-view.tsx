'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useStrings } from '@/components/SettingsProvider';
import {
  BuyerNextActions,
  NextStepsList,
  PayNowButtons,
  ReceiptSummaryCard,
  useStoredReceipt,
} from '@/components/ReceiptView';

/** Kvitteringssiden for alle vellykkede påmeldinger og forespørsler — innlogget eller ikke. */
export function ConfirmationView() {
  const t = useStrings();
  const { receipt, ready } = useStoredReceipt();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!ready) return;
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [ready]);

  if (!ready) {
    return <main className="min-h-[60vh] bg-gray-50" aria-busy="true" />;
  }

  if (!receipt) {
    return (
      <main className="min-h-[60vh] bg-gray-50 py-10 sm:py-16">
        <div className="mx-auto max-w-2xl space-y-6 px-4">
          <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold text-gray-900 outline-none text-balance">
            Takk!
          </h1>
          <p className="text-gray-700 text-pretty">{t('receipt.missing')}</p>
          <BuyerNextActions />
        </div>
      </main>
    );
  }

  const isBooking = receipt.kind === 'booking';
  const heading = isBooking
    ? t('request.done_heading')
    : receipt.waitlist
      ? t('receipt.heading_waitlist')
      : t('receipt.heading');
  const canPayNow = !isBooking && !receipt.waitlist && receipt.payment === 'online';

  return (
    <main className="min-h-[60vh] bg-gray-50 py-8 sm:py-14">
      <div className="mx-auto max-w-2xl space-y-8 px-4">
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-800">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <div>
            <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold text-gray-900 outline-none text-balance">
              {heading}
            </h1>
            <p className="mt-2 text-gray-700 text-pretty">
              {isBooking
                ? t('request.done_text', { kurs: receipt.courseName, epost: receipt.email })
                : t('receipt.email_sent', { epost: receipt.email })}{' '}
              Finner du den ikke, sjekk søppelpost-mappen.
            </p>
          </div>
        </div>

        <ReceiptSummaryCard receipt={receipt} />

        {canPayNow && (
          <section aria-labelledby="pay-heading" className="rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
            <h2 id="pay-heading" className="font-semibold text-gray-900">Betal nå, eller senere fra Min side</h2>
            <div className="mt-3">
              <PayNowButtons receipt={receipt} />
            </div>
          </section>
        )}

        <NextStepsList receipt={receipt} />

        <BuyerNextActions email={receipt.email} kind={receipt.kind} hasAccount={receipt.hasAccount} />

        {receipt.courseHref && (
          <p className="text-sm text-gray-600">
            <Link href={receipt.courseHref} className="inline-flex min-h-11 items-center text-bjerke-blue underline underline-offset-2">
              Se informasjon om {receipt.courseName}
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
