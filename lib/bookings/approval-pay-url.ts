import { signCheckoutToken } from '@/lib/payments/checkout-token';
import { getBaseUrl } from '@/lib/site';
import { BOOKING_CHECKOUT_TOKEN_TTL_MS } from '@/lib/bookings/approval-email';

/** Betalingslenken i godkjennings-e-posten (gyldig i 14 dager). */
export function bookingApprovalPayUrl(bookingId: number, now: number = Date.now()): string {
  const token = signCheckoutToken({ kind: 'booking', id: bookingId, expMs: now + BOOKING_CHECKOUT_TOKEN_TTL_MS });
  return `${getBaseUrl()}/betaling/booking?token=${encodeURIComponent(token)}`;
}
