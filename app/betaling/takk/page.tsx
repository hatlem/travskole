import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Betaling',
  description: 'Status for din betaling',
};

interface StatusBoxProps {
  title: string;
  message: string;
  color: 'green' | 'blue' | 'orange' | 'gray';
}

function StatusBox({ title, message, color }: StatusBoxProps) {
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
    <div className={`rounded-lg border ${c.border} ${c.bg} p-8`}>
      <h2 className={`text-xl font-bold ${c.heading} mb-2`}>
        {title}
      </h2>
      <p className={`${c.text} mb-6`}>
        {message}
      </p>
      <Link
        href="/dashboard"
        className="inline-block px-4 py-2 bg-bjerke-blue text-white rounded-lg font-medium hover:opacity-90"
      >
        Gå til dashboard
      </Link>
    </div>
  );
}

/**
 * Payment success page: looks up payment status from DB by paymentRef.
 *
 * paymentRef is stable across the payment lifecycle — the Stripe webhook
 * writes the payment-intent-id to the dedicated paymentIntentRef column
 * (see lib/payments/apply.ts) instead of rewriting paymentRef, so the
 * redirect's `?ref=cs_...` keeps resolving after the webhook runs.
 */
export default async function TakkPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  let status = 'not_found';

  if (ref) {
    // Try lookup by paymentRef in registration first
    const registration = await prisma.registration.findUnique({
      where: { paymentRef: ref },
      select: { paymentStatus: true },
    });

    if (registration) {
      status = registration.paymentStatus;
    } else {
      // Try lookup in bookingRequest
      const booking = await prisma.bookingRequest.findUnique({
        where: { paymentRef: ref },
        select: { paymentStatus: true },
      });

      if (booking) {
        status = booking.paymentStatus;
      }
    }
  }

  return (
    <main className="bg-white">
      <section className="bg-bjerke-blue text-white py-14">
        <div className="max-w-3xl mx-auto px-6">
          <h1 className="text-3xl sm:text-4xl font-bold">Betaling</h1>
        </div>
      </section>

      <section className="py-12 px-6">
        <div className="max-w-3xl mx-auto">
          {status === 'paid' && (
            <StatusBox
              title="Betalingen er mottatt — takk!"
              message="Din registrering er bekreftet og betalingen er behandlet."
              color="green"
            />
          )}

          {status === 'pending' && (
            <StatusBox
              title="Betalingen behandles"
              message="Oppdater siden om et øyeblikk. Betalingen kan ta en liten stund å behandle."
              color="blue"
            />
          )}

          {status === 'refunded' && (
            <StatusBox
              title="Betalingen er refundert"
              message="Betalingen er refundert. Kontakt oss hvis du har spørsmål."
              color="orange"
            />
          )}

          {(status !== 'paid' && status !== 'pending' && status !== 'refunded') && (
            <StatusBox
              title="Vi fant ikke betalingsstatusen"
              message="Vi kunne ikke finne informasjon om betalingen. Gå til dashboard for å se statusen på din registrering."
              color="gray"
            />
          )}
        </div>
      </section>
    </main>
  );
}
