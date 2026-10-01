/**
 * Salgstavle-kort (Deal) som er laget automatisk fra en påmelding eller forespørsel.
 * Når kilden slettes, slettes kortet også — ellers står det igjen et kort uten noe bak.
 * Kilder med betaling kan ikke slettes (regnskap), så kort med betaling blir aldri berørt her.
 * Notater og oppgaver på kortet beholdes (relasjonen settes til null).
 */
import { prisma } from '@/lib/prisma';

export function deleteDealsForRegistrations(registrationIds: number[]) {
  return prisma.deal.deleteMany({ where: { registrationId: { in: registrationIds } } });
}

export function deleteDealsForBooking(bookingRequestId: number) {
  return prisma.deal.deleteMany({ where: { bookingRequestId } });
}
