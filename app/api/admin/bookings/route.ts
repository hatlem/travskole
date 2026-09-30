import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { customerWithdrawnBookingIds } from '@/lib/bookings/withdrawn';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const bookings = await prisma.bookingRequest.findMany({
    orderBy: { createdAt: 'desc' },
    include: { course: { select: { name: true } } },
  });

  const withdrawn = await customerWithdrawnBookingIds(
    bookings.filter((b) => b.status === 'cancelled').map((b) => b.id),
  );

  return NextResponse.json({
    bookings: bookings.map((b) => ({ ...b, withdrawnByCustomer: withdrawn.has(b.id) })),
  });
}
