import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { normalizeEmail } from '@/lib/crm/normalize';
import { bookingOwnershipWhere } from '@/lib/bookings/ownership';
import { selfCancelBookingError } from '@/lib/registrations/cancel-rules';
import logger from '@/lib/logger';

/**
 * Brukeren trekker sin egen bookingforespørsel.
 *
 * Eierskapet avgjøres av samme regel som resten av booking-flyten
 * (bookingOwnershipWhere): verifisert e-post eller userId.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  const email = normalizeEmail(session.user.email);
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const parsedUserId = Number(session.user.id);
  const sessionUserId = Number.isFinite(parsedUserId) ? parsedUserId : null;

  try {
    const booking = await prisma.bookingRequest.findFirst({
      where: { id, ...bookingOwnershipWhere(email, sessionUserId) },
      select: { id: true, status: true, paymentStatus: true },
    });
    if (!booking) {
      return NextResponse.json({ error: 'Forespørselen ble ikke funnet' }, { status: 404 });
    }

    const blocked = selfCancelBookingError(booking);
    if (blocked) {
      return NextResponse.json({ error: blocked }, { status: 409 });
    }

    await prisma.bookingRequest.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });

    logActivity({
      action: 'status_change',
      entity: 'booking',
      entityId: id,
      details: JSON.stringify({ from: booking.status, to: 'cancelled', selfService: true }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({ ok: true, status: 'cancelled' });
  } catch (error) {
    logger.error('[dashboard:cancel] booking cancel failed', { error });
    return NextResponse.json({ error: 'Kunne ikke avbestille' }, { status: 500 });
  }
}
