import type { Prisma } from '@prisma/client';

/** Eierskaps-where for en brukers bookinger — samme regel som checkout-API-et:
 *  case-insensitiv e-postmatch ELLER userId-match. E-postene er verifiserte. */
export function bookingOwnershipWhere(sessionEmail: string, sessionUserId: number | null): Prisma.BookingRequestWhereInput {
  return {
    OR: [
      { email: { equals: sessionEmail, mode: 'insensitive' } },
      ...(sessionUserId != null ? [{ userId: sessionUserId }] : []),
    ],
  };
}
