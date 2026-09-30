import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { parsePaymentMethods } from '@/lib/payments';

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

/** Stripe sin cancel_url. Faktura nevnes bare når kurset faktisk tilbyr det (?kurs=). */
export default async function AvbruttPage({
  searchParams,
}: {
  searchParams: Promise<{ kurs?: string }>;
}) {
  const { kurs } = await searchParams;
  const offersInvoice = await courseOffersInvoice(kurs);

  return (
    <main className="bg-white">
      <section className="bg-bjerke-blue text-white py-14">
        <div className="max-w-3xl mx-auto px-6">
          <h1 className="text-3xl sm:text-4xl font-bold">Betaling avbrutt</h1>
        </div>
      </section>

      <section className="py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-8">
            <h2 className="text-xl font-bold text-yellow-900 mb-2">
              Betalingen ble avbrutt
            </h2>
            <p className="text-yellow-800 mb-6">
              Du har avbrutt betalingen. Du kan prøve igjen fra dashboard eller kontakte oss for andre betalingsalternativer.
              {offersInvoice && ' Faktura er også tilgjengelig som betalingsmåte.'}
            </p>
            <Link
              href="/dashboard"
              className="inline-block px-4 py-2 bg-bjerke-blue text-white rounded-lg font-medium hover:opacity-90"
            >
              Gå til dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
