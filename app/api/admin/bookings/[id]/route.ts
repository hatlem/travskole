import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { syncBookingToCrm } from '@/lib/crm/bridge';
import { emitBookingStatusEvent } from '@/lib/bookings/status-event';
import { decideBookingApprovalEmail } from '@/lib/bookings/approval-email';
import { buildBookingApprovalEmail } from '@/lib/bookings/approval-email-content';
import { bookingApprovalPayUrl } from '@/lib/bookings/approval-pay-url';
import { sendAdminEmail } from '@/lib/mail';
import { getSettings } from '@/lib/settings';
import { parsePaymentMethods } from '@/lib/payments';
import { isSettledPaymentStatus } from '@/lib/payments/transitions';
import { deleteDealsForBooking } from '@/lib/crm/source-deals';

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

  emitBookingStatusEvent(booking).catch(() => {});

  // Godkjenning-e-post (fire-safe): kun ved overgang inn i confirmed. Samme mal som
  // «Bekreft»-skuffen, bare uten avtalt tidspunkt og hilsen.
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
    const settings = await getSettings();
    const email = buildBookingApprovalEmail({
      kind: decision,
      name: booking.name,
      courseName: course?.name ?? 'Booking',
      participants: booking.participants,
      agreedDate: null,
      agreedTime: null,
      preferredDate: booking.preferredDate,
      note: null,
      amountKr,
      payUrl: decision === 'pay' ? bookingApprovalPayUrl(booking.id) : null,
      siteName: settings.site_name,
      contactEmail: settings.contact_email,
    });
    await sendAdminEmail(booking.email, email.subject, email.html);
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
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  const booking = await prisma.bookingRequest.findUnique({ where: { id: bookingId }, select: { paymentStatus: true } });
  if (!booking) {
    return NextResponse.json({ error: 'Forespørselen finnes ikke' }, { status: 404 });
  }
  // Betalte bookinger er regnskapsbilag — de kan avvises, men ikke slettes.
  if (isSettledPaymentStatus(booking.paymentStatus)) {
    return NextResponse.json(
      { error: 'Betalte forespørsler kan ikke slettes fordi de trengs i regnskapet. Avvis den i stedet.' },
      { status: 409 },
    );
  }

  // Kortet på salgstavla hører til forespørselen og slettes sammen med den.
  const [deals] = await prisma.$transaction([
    deleteDealsForBooking(bookingId),
    prisma.bookingRequest.delete({ where: { id: bookingId } }),
  ]);

  logActivity({
    action: 'delete',
    entity: 'booking',
    entityId: bookingId,
    details: JSON.stringify({ dealsRemoved: deals.count }),
    userEmail: session.user.email,
  }).catch(() => {});

  return NextResponse.json({ success: true, dealsRemoved: deals.count });
}
