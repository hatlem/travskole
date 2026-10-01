import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { parsePaymentMethods } from '@/lib/payments';
import { parseReceiptSubject } from '@/lib/receipt';
import { PaymentExitActions } from '../payment-exit-actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Betaling avbrutt',
  description: 'Betalingen ble avbrutt',
};

async function courseOffersInvoice(rawCourseId: string | undefined): Promise<boolean> {
  const courseId = Number(rawCourseId);
  if (!Number.isInteger(courseId) || courseId <= 0) return false;
  const course = await prisma.course
    .findUnique({ where: { id: courseId }, select: { paymentMethods: true } })
    .catch(() => null);
  return !!course && parsePaymentMethods(course.paymentMethods).includes('faktura');
}

/** Stripe sin cancel_url. Faktura nevnes bare når kurset faktisk tilbyr det (?kurs=); ?kind=&id= matcher kvitteringen. */
export default async function AvbruttPage({
  searchParams,
}: {
  searchParams: Promise<{ kurs?: string; kind?: string; id?: string }>;
}) {
  const { kurs, kind, id } = await searchParams;
  const offersInvoice = await courseOffersInvoice(kurs);

  return (
    <main className="bg-gray-50">
      <section className="bg-bjerke-blue text-white py-10 sm:py-14">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-3xl sm:text-4xl font-bold">Betaling avbrutt</h1>
        </div>
      </section>

      <section className="py-8 sm:py-12 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div role="status" className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5 sm:p-8">
            <h2 className="text-xl font-bold text-yellow-900 mb-2">
              Ingenting er trukket
            </h2>
            <p className="text-yellow-900 text-pretty">
              Du avbrøt betalingen. Påmeldingen din er likevel registrert – du kan prøve igjen nå, eller betale senere fra Min side.
              {offersInvoice && ' Du kan også betale med faktura – ta kontakt med oss, så ordner vi det.'}
            </p>
          </div>
          <PaymentExitActions offerRetry subject={parseReceiptSubject(kind, id)} />
        </div>
      </section>
    </main>
  );
}
