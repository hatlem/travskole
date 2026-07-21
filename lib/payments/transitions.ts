/**
 * Ren beslutningslogikk for monoton betalingsstatus-overgang — utskilt fra
 * apply.ts (DB-laget) for testbarhet uten Prisma.
 *
 * Rangeringen hindrer at forsinkede/omspilte webhook-events (Stripe/Vipps
 * gjenforsøker levering, eller leverer ute av rekkefølge) kan degradere en
 * terminal status. Eks.: en omspilt Vipps AUTHORIZED etter REFUNDED skal
 * ALDRI sette raden tilbake til 'paid', og en sent ankommet Stripe
 * payment_intent.payment_failed etter at betalingen allerede lyktes skal
 * ALDRI overskrive 'paid' med 'failed'. Kun strengt økende overganger
 * skriver ny status (se apply.ts sitt kall til planStatusTransition).
 *
 * Etter utvidelse: `expired` (forlatt checkout) og `partially_refunded` (delvis
 * refusjon) er lagt til, med samme monotone garantier.
 */

export const STATUS_RANK = { none: 0, pending: 1, expired: 2, failed: 3, paid: 4, partially_refunded: 5, refunded: 6 } as const;

export type PaymentStatus = keyof typeof STATUS_RANK;

/**
 * Planlegger overgangen fra `current` (rå, mulig ukjent streng fra DB) til
 * `next` (kjent, typet status). Ukjent `current` behandles defensivt som
 * rangering 0 (dvs. laveste rang — enhver kjent `next` vil da skrive).
 *
 * - write ⇔ rang(next) > rang(current)
 * - downgrade ⇔ rang(next) < rang(current)
 * - lik rang ⇒ { write: false, downgrade: false } (no-op, faller gjennom til
 *   emit/deal-flytting i apply.ts sitt kall — IKKE en nedgradering)
 */
export function planStatusTransition(
  current: string,
  next: PaymentStatus,
): { write: boolean; downgrade: boolean } {
  const currentRank = STATUS_RANK[current as PaymentStatus] ?? STATUS_RANK.none;
  const nextRank = STATUS_RANK[next];

  return {
    write: nextRank > currentRank,
    downgrade: nextRank < currentRank,
  };
}
