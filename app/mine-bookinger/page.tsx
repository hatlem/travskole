import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { normalizeEmail } from '@/lib/crm/normalize';
import { bookingOwnershipWhere } from '@/lib/bookings/ownership';
import { parsePaymentMethods } from '@/lib/payments';
import { paymentStatusBadge } from '@/lib/payments/badge';
import { BookingCheckout } from '@/components/BookingCheckout';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Mine bookinger' };

const STATUS_LABEL: Record<string, string> = {
  new: 'Til behandling',
  confirmed: 'Bekreftet',
  cancelled: 'Kansellert',
};

export default async function MineBookingerPage() {
  const session = await getServerSession();
  if (!session?.user?.email) redirect('/login?callbackUrl=/mine-bookinger');
  const email = normalizeEmail(session.user.email);
  if (!email) redirect('/login?callbackUrl=/mine-bookinger');

  // session.user.id er en string (NextAuth JWT-sesjon, se types/next-auth.d.ts).
  // Konverter til number for bookingOwnershipWhere — ugyldig/manglende verdi gir
  // null, så eierskap faller tilbake til e-postmatch alene.
  const parsedUserId = Number(session.user.id);
  const sessionUserId = Number.isFinite(parsedUserId) ? parsedUserId : null;

  const bookings = await prisma.bookingRequest.findMany({
    where: bookingOwnershipWhere(email, sessionUserId),
    include: { course: { select: { name: true, price: true, paymentMethods: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Mine bookinger</h1>
      {bookings.length === 0 ? (
        <p className="text-gray-600">Du har ingen bookinger ennå.</p>
      ) : (
        <ul className="space-y-4">
          {bookings.map((b) => {
            const amountKr = b.course?.price != null ? b.course.price * b.participants : null;
            const providers = parsePaymentMethods(b.course?.paymentMethods ?? '').filter(
              (m): m is 'stripe' | 'vipps' => m === 'stripe' || m === 'vipps'
            );
            const badge = paymentStatusBadge(b.paymentStatus);
            const canPay =
              b.status === 'confirmed' &&
              providers.length > 0 &&
              amountKr != null &&
              (b.paymentStatus === 'none' || b.paymentStatus === 'pending');
            return (
              <li key={b.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{b.course?.name ?? 'Booking'}</p>
                    <p className="text-sm text-gray-500">
                      {b.participants} deltaker(e)
                      {amountKr != null ? ` · ${amountKr.toLocaleString('nb-NO')} kr` : ''} ·{' '}
                      {STATUS_LABEL[b.status] ?? b.status}
                    </p>
                  </div>
                  {badge && (
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                </div>
                {canPay && (
                  <div className="mt-3">
                    <BookingCheckout bookingRequestId={b.id} providers={providers} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
