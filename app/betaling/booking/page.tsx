import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { verifyCheckoutToken } from '@/lib/payments/checkout-token';
import { parsePaymentMethods } from '@/lib/payments';
import { BookingCheckout } from '@/components/BookingCheckout';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Betal booking', description: 'Fullfør betaling for din booking' };

function Box({ title, message, tone }: { title: string; message: string; tone: 'green' | 'gray' }) {
  const c = tone === 'green' ? 'border-green-200 bg-green-50 text-green-900' : 'border-gray-200 bg-gray-50 text-gray-800';
  return (
    <div className={`rounded-lg border ${c} p-8`}>
      <h2 className="text-xl font-bold mb-2">{title}</h2>
      <p className="mb-6">{message}</p>
      <Link href="/mine-bookinger" className="inline-block px-4 py-2 bg-bjerke-blue text-white rounded-lg font-medium hover:opacity-90">Mine bookinger</Link>
    </div>
  );
}

export default async function BookingBetalPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const payload = token ? verifyCheckoutToken(token) : null;

  let content: React.ReactNode;
  if (!payload || payload.kind !== 'booking') {
    content = <Box tone="gray" title="Lenken er ugyldig eller utløpt" message="Vi kunne ikke bekrefte betalingslenken. Logg inn på Mine bookinger for å betale, eller kontakt oss." />;
  } else {
    const booking = await prisma.bookingRequest.findUnique({
      where: { id: payload.id },
      include: { course: { select: { name: true, price: true, paymentMethods: true } } },
    });
    if (!booking || !booking.course) {
      content = <Box tone="gray" title="Fant ikke bookingen" message="Vi fant ikke bookingen. Kontakt oss hvis dette er feil." />;
    } else if (booking.paymentStatus === 'paid') {
      content = <Box tone="green" title="Betalingen er allerede mottatt — takk!" message="Bookingen din er betalt og bekreftet." />;
    } else if (booking.status === 'cancelled') {
      content = <Box tone="gray" title="Bookingen er kansellert" message="Denne bookingen er kansellert, og kan ikke betales." />;
    } else {
      const amountKr = booking.course.price != null ? booking.course.price * booking.participants : null;
      const providers = parsePaymentMethods(booking.course.paymentMethods).filter((m): m is 'stripe' | 'vipps' => m === 'stripe' || m === 'vipps');
      content = (
        <div className="rounded-lg border border-gray-200 bg-white p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Fullfør betaling</h2>
          <table className="mb-6 text-sm"><tbody>
            <tr><td className="pr-6 py-1 text-gray-500">Arrangement</td><td className="font-medium">{booking.course.name}</td></tr>
            <tr><td className="pr-6 py-1 text-gray-500">Deltakere</td><td>{booking.participants}</td></tr>
            {amountKr != null && <tr><td className="pr-6 py-1 text-gray-500">Beløp</td><td className="font-semibold">{amountKr.toLocaleString('nb-NO')} kr</td></tr>}
          </tbody></table>
          {providers.length > 0 && amountKr != null && amountKr > 0
            ? <BookingCheckout bookingRequestId={booking.id} providers={providers} token={token} />
            : <p className="text-sm text-gray-600">Dette arrangementet har ingen online betaling. Vi tar kontakt om det praktiske.</p>}
        </div>
      );
    }
  }

  return (
    <main className="bg-white">
      <section className="bg-bjerke-blue text-white py-14"><div className="max-w-3xl mx-auto px-6"><h1 className="text-3xl sm:text-4xl font-bold">Betal booking</h1></div></section>
      <section className="py-12 px-6"><div className="max-w-3xl mx-auto">{content}</div></section>
    </main>
  );
}
