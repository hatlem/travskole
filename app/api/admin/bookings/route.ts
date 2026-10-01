import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { customerWithdrawnBookingIds } from '@/lib/bookings/withdrawn';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }

  const bookings = await prisma.bookingRequest.findMany({
    orderBy: { createdAt: 'desc' },
    include: { course: { select: { name: true } } },
  });

  const withdrawn = await customerWithdrawnBookingIds(
    bookings.filter((b) => b.status === 'cancelled').map((b) => b.id),
  );

  // Lenker til salgstavla og kontakten på hvert kort.
  const deals = await prisma.deal.findMany({
    where: { bookingRequestId: { in: bookings.map((b) => b.id) } },
    select: { id: true, contactId: true, bookingRequestId: true },
  });
  const dealByBooking = new Map(deals.map((d) => [d.bookingRequestId, d]));

  return NextResponse.json({
    bookings: bookings.map((b) => {
      const deal = dealByBooking.get(b.id);
      return {
        ...b,
        withdrawnByCustomer: withdrawn.has(b.id),
        crm: { dealId: deal?.id ?? null, contactId: deal?.contactId ?? null },
      };
    }),
  });
}
