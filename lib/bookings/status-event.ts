import { prisma } from '@/lib/prisma';
import { emitEvent } from '@/lib/events/bus';
import { normalizeEmail } from '@/lib/crm/normalize';

/** booking.status_changed på hendelsesbussen, delt av admin-ruten og selvbetjent avbestilling. */
export async function emitBookingStatusEvent(booking: { id: number; email: string; status: string }): Promise<void> {
  const email = normalizeEmail(booking.email);
  const contact = email
    ? await prisma.contact.findUnique({ where: { email }, select: { id: true } })
    : null;
  // Ingen dedupeKey: statusendringer er tilsiktet append-only.
  await emitEvent({
    type: 'booking.status_changed',
    source: 'server',
    contactId: contact?.id ?? null,
    meta: { bookingRequestId: booking.id, status: booking.status },
  });
}
