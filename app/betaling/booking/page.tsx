import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { verifyCheckoutToken } from '@/lib/payments/checkout-token';
import { parsePaymentMethods } from '@/lib/payments';
import { BookingCheckout } from '@/components/BookingCheckout';
import { subjectStatusText } from '@/lib/payments/thank-you';
import { BuyerNextActions } from '@/components/ReceiptView';
import { formatKr, participantsLabel } from '@/lib/buyer-display';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Betal booking', description: 'Fullfør betaling for din booking' };

function Box({ title, message, tone }: { title: string; message: string; tone: 'green' | 'gray' }) {
  const c = tone === 'green' ? 'border-green-200 bg-green-50 text-green-900' : 'border-gray-200 bg-gray-50 text-gray-800';
  return (
    <div>
      <div className={`rounded-2xl border ${c} p-5 sm:p-8`}>
        <h2 className="text-xl font-bold mb-2">{title}</h2>
        <p className="text-pretty">{message}</p>
      </div>
      <div className="mt-6"><BuyerNextActions kind="booking" /></div>
    </div>
  );
}

export default async function BookingBetalPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const payload = token ? verifyCheckoutToken(token) : null;

  let content: React.ReactNode;
  if (!payload || payload.kind !== 'booking') {
    content = <Box tone="gray" title="Lenken er ugyldig eller utløpt" message="Vi kunne ikke bekrefte betalingslenken. Logg inn og betal fra Min side, eller kontakt oss." />;
  } else {
    const booking = await prisma.bookingRequest.findUnique({
      where: { id: payload.id },
      include: { course: { select: { name: true, price: true, paymentMethods: true } } },
    });
    if (!booking || !booking.course) {
      content = <Box tone="gray" title="Fant ikke bookingen" message="Vi fant ikke bookingen. Kontakt oss hvis dette er feil." />;
    } else if (booking.paymentStatus === 'paid') {
      content = <Box tone="green" title="Betalingen er allerede mottatt — takk!" message={`Bookingen din er betalt. ${subjectStatusText({ kind: 'booking', status: booking.status })}`} />;
    } else if (booking.status === 'cancelled') {
      content = <Box tone="gray" title="Forespørselen er avlyst" message="Denne forespørselen er avlyst eller trukket, og kan ikke betales." />;
    } else {
      const amountKr = booking.course.price != null ? booking.course.price * booking.participants : null;
      const providers = parsePaymentMethods(booking.course.paymentMethods).filter((m): m is 'stripe' | 'vipps' => m === 'stripe' || m === 'vipps');
      content = (
        <div className="rounded-lg border border-gray-200 bg-white p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Fullfør betaling</h2>
          <table className="mb-6 text-sm"><tbody>
            <tr><td className="pr-6 py-1 text-gray-500">Arrangement</td><td className="font-medium">{booking.course.name}</td></tr>
            <tr><td className="pr-6 py-1 text-gray-500">Antall</td><td>{participantsLabel(booking.participants)}</td></tr>
            {amountKr != null && <tr><td className="pr-6 py-1 text-gray-500">Beløp</td><td className="font-semibold tabular-nums">{formatKr(amountKr)}</td></tr>}
          </tbody></table>
          {providers.length > 0 && amountKr != null && amountKr > 0
            ? <BookingCheckout bookingRequestId={booking.id} providers={providers} token={token} amountKr={amountKr} />
            : <p className="text-sm text-gray-600">Dette arrangementet har ingen online betaling. Vi tar kontakt om det praktiske.</p>}
        </div>
      );
    }
  }

  return (
    <main className="bg-gray-50">
      <section className="bg-bjerke-blue text-white py-14"><div className="max-w-3xl mx-auto px-6"><h1 className="text-3xl sm:text-4xl font-bold">Betal booking</h1></div></section>
      <section className="py-12 px-6"><div className="max-w-3xl mx-auto">{content}</div></section>
    </main>
  );
}
