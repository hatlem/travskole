import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { syncBookingToCrm } from '@/lib/crm/bridge';
import { emitEvent } from '@/lib/events/bus';
import { normalizeEmail } from '@/lib/crm/normalize';
import { decideBookingApprovalEmail, BOOKING_CHECKOUT_TOKEN_TTL_MS } from '@/lib/bookings/approval-email';
import { sendBookingApprovedPayEmail, sendBookingApprovedEmail } from '@/lib/mail';
import { signCheckoutToken } from '@/lib/payments/checkout-token';
import { parsePaymentMethods } from '@/lib/payments';
import { getBaseUrl } from '@/lib/site';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const VALID_STATUSES = ['new', 'confirmed', 'cancelled'];
  if (!VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 });
  }

  const existing = await prisma.bookingRequest.findUnique({ where: { id: Number(id) }, select: { status: true } });
  const prevStatus = existing?.status ?? '';

  const now = new Date();
  const booking = await prisma.bookingRequest.update({
    where: { id: Number(id) },
    data: {
      status: body.status,
      confirmedAt: body.status === 'confirmed' ? now : null,
      cancelledAt: body.status === 'cancelled' ? now : null,
    },
  });

  logActivity({ action: 'status_change', entity: 'booking', entityId: Number(id), details: JSON.stringify({ status: body.status }), userEmail: session.user.email }).catch(() => {});
  syncBookingToCrm(Number(id)).catch(() => {});

  // Hendelsesbuss: bookingstatus endret (fire-safe)
  (async () => {
    const email = normalizeEmail(booking.email);
    const contact = email
      ? await prisma.contact.findUnique({ where: { email }, select: { id: true } })
      : null;
    // Ingen dedupeKey her: statusendringer er tilsiktet append-only — samme
    // status kan settes flere ganger og skal hver gang gi et eget hendelses-innslag.
    await emitEvent({
      type: 'booking.status_changed',
      source: 'server',
      contactId: contact?.id ?? null,
      meta: { bookingRequestId: booking.id, status: booking.status },
    });
  })().catch(() => {});

  // Godkjenning-e-post (fire-safe): kun ved overgang inn i confirmed.
  (async () => {
    const course = booking.courseId
      ? await prisma.course.findUnique({ where: { id: booking.courseId }, select: { name: true, price: true, paymentMethods: true } })
      : null;
    const amountKr = course?.price != null ? course.price * booking.participants : null;
    const decision = decideBookingApprovalEmail({
      prevStatus,
      newStatus: booking.status,
      paymentMethods: parsePaymentMethods(course?.paymentMethods ?? ''),
      amountKr,
      paymentStatus: booking.paymentStatus,
    });
    if (decision === 'none') return;
    const emailData = {
      courseName: course?.name ?? 'Booking',
      name: booking.name, email: booking.email, phone: booking.phone,
      participants: booking.participants, preferredDate: booking.preferredDate ? booking.preferredDate.toISOString() : null, message: booking.message ?? null,
    };
    if (decision === 'pay' && amountKr != null) {
      const token = signCheckoutToken({ kind: 'booking', id: booking.id, expMs: Date.now() + BOOKING_CHECKOUT_TOKEN_TTL_MS });
      const payUrl = `${getBaseUrl()}/betaling/booking?token=${encodeURIComponent(token)}`;
      await sendBookingApprovedPayEmail({ ...emailData, amountKr, payUrl });
    } else {
      await sendBookingApprovedEmail(emailData);
    }
  })().catch(() => {});

  return NextResponse.json({ booking });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  await prisma.bookingRequest.delete({
    where: { id: Number(id) },
  });

  logActivity({ action: 'delete', entity: 'booking', entityId: Number(id), userEmail: session.user.email }).catch(() => {});

  return NextResponse.json({ success: true });
}
