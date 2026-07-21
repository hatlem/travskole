// Read-through betalingsoppslag for kanban-deals: Deal har ingen egen
// paymentStatus — den resolves fra lenket BookingRequest/Registration.
type PaymentBits = { paymentStatus: string; paymentProvider: string | null };

export function resolveDealPayment(
  deal: { bookingRequestId: number | null; registrationId: number | null },
  bookingMap: Map<number, PaymentBits>,
  registrationMap: Map<number, PaymentBits>,
): { paymentStatus: string | null; paymentProvider: string | null } {
  const pay =
    deal.bookingRequestId != null
      ? bookingMap.get(deal.bookingRequestId)
      : deal.registrationId != null
        ? registrationMap.get(deal.registrationId)
        : undefined;
  return {
    paymentStatus: pay?.paymentStatus ?? null,
    paymentProvider: pay?.paymentProvider ?? null,
  };
}
