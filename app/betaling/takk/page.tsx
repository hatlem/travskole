import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Betaling',
  description: 'Status for din betaling',
};

/**
 * Payment success page: looks up payment status from DB by paymentRef.
 *
 * Handles Stripe session-id rewrite: when the Stripe webhook fires,
 * paymentRef may be rewritten from session-id (cs_...) to payment-intent-id
 * via the nextRef handoff in apply.ts. If lookup by URL ref misses but
 * ref looks like a Stripe session ID, we assume the webhook is still
 * processing and show the "behandles" message. This is a known seam to
 * revisit: ideally apply.ts would preserve the original ref for takk-page
 * lookup, but that's outside this task's scope.
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

  // Handle the Stripe session-id rewrite: if lookup missed but ref looks
  // like a Stripe session ID, assume webhook is still processing
  if (status === 'not_found' && ref?.startsWith('cs_')) {
    status = 'pending';
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
            <div className="rounded-lg border border-green-200 bg-green-50 p-8">
              <h2 className="text-xl font-bold text-green-900 mb-2">
                Betalingen er mottatt — takk!
              </h2>
              <p className="text-green-800 mb-6">
                Din registrering er bekreftet og betalingen er behandlet.
              </p>
              <Link
                href="/dashboard"
                className="inline-block px-4 py-2 bg-bjerke-blue text-white rounded-lg font-medium hover:opacity-90"
              >
                Gå til dashboard
              </Link>
            </div>
          )}

          {status === 'pending' && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-8">
              <h2 className="text-xl font-bold text-blue-900 mb-2">
                Betalingen behandles
              </h2>
              <p className="text-blue-800 mb-6">
                Oppdater siden om et øyeblikk. Betalingen kan ta en liten stund å behandle.
              </p>
              <Link
                href="/dashboard"
                className="inline-block px-4 py-2 bg-bjerke-blue text-white rounded-lg font-medium hover:opacity-90"
              >
                Gå til dashboard
              </Link>
            </div>
          )}

          {(status === 'not_found' || status === 'failed' || status === 'none') && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Vi fant ikke betalingsstatusen
              </h2>
              <p className="text-gray-700 mb-6">
                Vi kunne ikke finne informasjon om betalingen. Gå til dashboard for å se statusen på din registrering.
              </p>
              <Link
                href="/dashboard"
                className="inline-block px-4 py-2 bg-bjerke-blue text-white rounded-lg font-medium hover:opacity-90"
              >
                Gå til dashboard
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
