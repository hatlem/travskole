// Felles betalings-badge: norsk etikett + semantisk farge per status.
// Brukt overalt betalingsstatus vises (påmeldings-/booking-lister,
// kontakt-deals, kanban) så expired/partially_refunded ser likt ut alle steder.
// Status pares alltid med tekst (a11y) — aldri bare farge.
const BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: 'Venter', className: 'bg-amber-100 text-amber-800' },
  expired: { label: 'Utløpt', className: 'bg-gray-100 text-gray-600' },
  failed: { label: 'Feilet', className: 'bg-red-100 text-red-800' },
  paid: { label: 'Betalt', className: 'bg-green-100 text-green-800' },
  partially_refunded: { label: 'Delvis refundert', className: 'bg-orange-100 text-orange-800' },
  refunded: { label: 'Refundert', className: 'bg-blue-100 text-blue-800' },
};

export function paymentStatusBadge(status: string | null | undefined): { label: string; className: string } | null {
  if (!status) return null;
  return BADGES[status] ?? null;
}
