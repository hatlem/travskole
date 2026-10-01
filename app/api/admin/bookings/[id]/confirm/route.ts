import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { getSettings } from '@/lib/settings';
import { sendAdminEmail } from '@/lib/mail';
import { syncBookingToCrm } from '@/lib/crm/bridge';
import { emitBookingStatusEvent } from '@/lib/bookings/status-event';
import { decideBookingApprovalEmail } from '@/lib/bookings/approval-email';
import { bookingApprovalPayUrl } from '@/lib/bookings/approval-pay-url';
import {
  bookingConfirmationNote,
  buildBookingApprovalEmail,
  formatAgreedTime,
  isAgreedDate,
  isAgreedTime,
} from '@/lib/bookings/approval-email-content';
import { parsePaymentMethods } from '@/lib/payments';
import logger from '@/lib/logger';

const ALREADY_CONFIRMED = 'Forespørselen er allerede bekreftet.';

const schema = z.object({
  date: z.string().trim().refine((v) => v === '' || isAgreedDate(v), 'Ugyldig dato').optional().default(''),
  time: z.string().trim().refine((v) => v === '' || isAgreedTime(v), 'Skriv klokkeslett som 12:00').optional().default(''),
  note: z.string().max(2000, 'Hilsenen kan være maks 2000 tegn').optional().default(''),
  /** preview: e-posten slik den blir, uten å endre noe. confirm: bekreft og send. */
  mode: z.enum(['preview', 'confirm']).default('confirm'),
});

/** Bekreft en forespørsel med avtalt tidspunkt og personlig hilsen (skuffen på Forespørsler). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }

  const { id } = await params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Ugyldige felt' }, { status: 400 });
  }
  const { date, time, note, mode } = parsed.data;

  const booking = await prisma.bookingRequest.findUnique({
    where: { id: bookingId },
    include: { course: { select: { name: true, price: true, paymentMethods: true } } },
  });
  if (!booking) {
    return NextResponse.json({ error: 'Forespørselen finnes ikke' }, { status: 404 });
  }
  if (booking.status === 'confirmed') {
    return NextResponse.json({ error: ALREADY_CONFIRMED }, { status: 409 });
  }

  const amountKr = booking.course?.price != null ? booking.course.price * booking.participants : null;
  const decision = decideBookingApprovalEmail({
    prevStatus: booking.status,
    newStatus: 'confirmed',
    paymentMethods: parsePaymentMethods(booking.course?.paymentMethods ?? ''),
    amountKr,
    paymentStatus: booking.paymentStatus,
  });
  const kind = decision === 'pay' ? 'pay' : 'plain';
  const settings = await getSettings();
  const agreed = formatAgreedTime(date || null, time || null);
  const content = {
    kind,
    name: booking.name,
    courseName: booking.course?.name ?? 'Booking',
    participants: booking.participants,
    agreedDate: date || null,
    agreedTime: time || null,
    preferredDate: booking.preferredDate,
    note: note.trim() || null,
    amountKr,
    siteName: settings.site_name,
    contactEmail: settings.contact_email,
  } as const;

  if (mode === 'preview') {
    const email = buildBookingApprovalEmail({ ...content, payUrl: kind === 'pay' ? '#betal' : null });
    return NextResponse.json({ ...email, to: booking.email, kind });
  }

  try {
    // Betinget overgang: to samtidige bekreftelser gir bare én e-post og ett CRM-notat.
    const { count } = await prisma.bookingRequest.updateMany({
      where: { id: bookingId, status: { not: 'confirmed' } },
      data: { status: 'confirmed', confirmedAt: new Date(), cancelledAt: null },
    });
    if (count === 0) {
      return NextResponse.json({ error: ALREADY_CONFIRMED }, { status: 409 });
    }
    const updated = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: bookingId } });

    logActivity({
      action: 'status_change',
      entity: 'booking',
      entityId: bookingId,
      details: JSON.stringify({ status: 'confirmed', ...(agreed ? { agreed } : {}), personalNote: !!content.note }),
      userEmail: session.user.email,
    }).catch(() => {});

    // CRM først (vent), så vi kan lenke til avtalen og legge notatet på den.
    await syncBookingToCrm(bookingId);
    emitBookingStatusEvent(updated).catch(() => {});

    let emailSent = true;
    try {
      const payUrl = kind === 'pay' ? bookingApprovalPayUrl(bookingId) : null;
      const email = buildBookingApprovalEmail({ ...content, payUrl });
      await sendAdminEmail(booking.email, email.subject, email.html);
    } catch (error) {
      emailSent = false;
      logger.error(`Booking approval email failed for booking ${bookingId}`, { error });
    }

    const deal = await prisma.deal.findUnique({ where: { bookingRequestId: bookingId }, select: { id: true, contactId: true } });
    const noteBody = bookingConfirmationNote(agreed, content.note);
    if (deal && noteBody) {
      await prisma.note
        .create({ data: { body: noteBody, dealId: deal.id, contactId: deal.contactId, authorEmail: session.user.email } })
        .catch((error) => logger.error('Could not add confirmation note to deal', { error }));
    }

    return NextResponse.json({
      booking: updated,
      emailSent,
      crm: { dealId: deal?.id ?? null, contactId: deal?.contactId ?? null },
    });
  } catch (error) {
    logger.error('Error confirming booking', { error });
    return NextResponse.json({ error: 'Forespørselen ble ikke bekreftet. Prøv igjen.' }, { status: 500 });
  }
}
