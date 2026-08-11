/**
 * Ren beslutning for hvilken godkjenning-e-post en booking skal få når admin
 * bekrefter den. Ingen IO — testbar. Se spec 2026-07-26-booking-checkout-ui.
 */
export const BOOKING_CHECKOUT_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 dager

export type BookingApprovalEmailDecision = 'pay' | 'plain' | 'none';

export function decideBookingApprovalEmail(input: {
  prevStatus: string;
  newStatus: string;
  paymentMethods: string[];
  amountKr: number | null;
  paymentStatus: string;
}): BookingApprovalEmailDecision {
  // Kun ved overgang INN I confirmed (unngår re-send ved gjentatte lagringer).
  if (input.newStatus !== 'confirmed' || input.prevStatus === 'confirmed') return 'none';
  const onlineAllowed = input.paymentMethods.includes('stripe') || input.paymentMethods.includes('vipps');
  const payable = input.amountKr != null && input.amountKr > 0;
  const unpaid = input.paymentStatus === 'none' || input.paymentStatus === 'pending';
  return onlineAllowed && payable && unpaid ? 'pay' : 'plain';
}
