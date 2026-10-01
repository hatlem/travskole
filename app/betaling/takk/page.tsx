import type { Metadata } from 'next';
import { findPaymentSubject, resolveThankYouStatus } from '@/lib/payments/reconcile';
import { paidThankYouMessage } from '@/lib/payments/thank-you';
import { parseReceiptSubject, type ReceiptSubject } from '@/lib/receipt';
import { PaymentExitActions } from '../payment-exit-actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Betaling',
  description: 'Status for din betaling',
};

interface StatusBoxProps {
  title: string;
  message: string;
  color: 'green' | 'blue' | 'orange' | 'gray';
  paid?: boolean;
  offerRetry?: boolean;
  subject: ReceiptSubject | null;
}

function StatusBox({ title, message, color, paid = false, offerRetry = false, subject }: StatusBoxProps) {
  const colors = {
    green: {
      border: 'border-green-200',
      bg: 'bg-green-50',
      heading: 'text-green-900',
      text: 'text-green-800',
    },
    blue: {
      border: 'border-blue-200',
      bg: 'bg-blue-50',
      heading: 'text-blue-900',
      text: 'text-blue-800',
    },
    orange: {
      border: 'border-orange-200',
      bg: 'bg-orange-50',
      heading: 'text-orange-900',
      text: 'text-orange-800',
    },
    gray: {
      border: 'border-gray-200',
      bg: 'bg-gray-50',
      heading: 'text-gray-900',
      text: 'text-gray-700',
    },
  };

  const c = colors[color];

  return (
    <div>
      <div role="status" className={`rounded-2xl border ${c.border} ${c.bg} p-5 sm:p-8`}>
        <h2 className={`text-xl font-bold ${c.heading} mb-2 text-balance`}>
          {title}
        </h2>
        <p className={`${c.text} text-pretty`}>
          {message}
        </p>
      </div>
      <PaymentExitActions paid={paid} offerRetry={offerRetry} subject={subject} />
    </div>
  );
}

/**
 * Betalingsstatus for `?ref=` (Stripe-sesjon eller Vipps-referanse). Har ikke
 * webhooken kommet ennå, spør vi leverandøren direkte og anvender resultatet
 * idempotent (se lib/payments/reconcile.ts).
 */
export default async function TakkPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; kind?: string; id?: string }>;
}) {
  const { ref, kind, id } = await searchParams;
  const status = await resolveThankYouStatus(ref);
  const subject = await findPaymentSubject(ref).catch(() => null);
  // Refen er fasit; kind/id i URL-en dekker en ref som er overskrevet av et nyere betalingsforsøk.
  const receiptSubject: ReceiptSubject | null = subject ? { kind: subject.kind, id: subject.id } : parseReceiptSubject(kind, id);

  return (
    <main className="bg-gray-50">
      <section className="bg-bjerke-blue text-white py-10 sm:py-14">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-3xl sm:text-4xl font-bold">Betaling</h1>
        </div>
      </section>

      <section className="py-8 sm:py-12 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          {status === 'paid' && (
            <StatusBox
              title="Betalingen er mottatt — takk!"
              message={paidThankYouMessage(subject)}
              color="green"
              paid
              subject={receiptSubject}
            />
          )}

          {status === 'pending' && (
            <StatusBox
              title="Betalingen behandles"
              message="Oppdater siden om et øyeblikk. Betalingen kan ta en liten stund å behandle."
              color="blue"
              subject={receiptSubject}
            />
          )}

          {status === 'aborted' && (
            <StatusBox
              title="Betalingen ble avbrutt"
              message="Ingenting er trukket. Påmeldingen din er likevel registrert – du kan prøve igjen nå eller betale senere fra Min side."
              color="gray"
              offerRetry
              subject={receiptSubject}
            />
          )}

          {status === 'refunded' && (
            <StatusBox
              title="Betalingen er refundert"
              message="Betalingen er refundert. Kontakt oss hvis du har spørsmål."
              color="orange"
              subject={receiptSubject}
            />
          )}

          {status === 'expired' && (
            <StatusBox
              title="Betalingslenken er utløpt"
              message="Betalingen ble ikke fullført i tide. Påmeldingen er likevel registrert – prøv igjen, eller betal senere fra Min side."
              color="gray"
              offerRetry
              subject={receiptSubject}
            />
          )}

          {status === 'failed' && (
            <StatusBox
              title="Betalingen mislyktes"
              message="Noe gikk galt med betalingen, og ingenting er trukket. Prøv igjen, eller kontakt oss hvis problemet vedvarer."
              color="orange"
              offerRetry
              subject={receiptSubject}
            />
          )}

          {status === 'partially_refunded' && (
            <StatusBox
              title="Delvis refundert"
              message="Deler av betalingen er refundert. Kontakt oss hvis du har spørsmål."
              color="orange"
              subject={receiptSubject}
            />
          )}

          {status === 'not_found' && (
            <StatusBox
              title="Vi fant ikke betalingsstatusen"
              message="Vi kunne ikke finne informasjon om betalingen. Du ser statusen på påmeldingen din på Min side."
              color="gray"
              subject={receiptSubject}
            />
          )}
        </div>
      </section>
    </main>
  );
}
