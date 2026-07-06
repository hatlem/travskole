/**
 * Betalingskonfigurasjon — ren logikk (ingen IO), unit-testbar.
 *
 * Per kurs velger admin tillatte betalingsmåter (Faktura og/eller Stripe).
 * Test vs. live styres av admin-innstillingen `payment_test_mode`, som avgjør
 * hvilket nøkkelsett som brukes. De publiserbare Stripe-nøklene er OFFENTLIGE og
 * bakes inn her (de vises uansett i nettleseren); secret-nøklene leses fra env.
 */

export type PaymentMethod = 'faktura' | 'stripe';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'faktura', label: 'Faktura' },
  { value: 'stripe', label: 'Stripe (kort)' },
];

const VALID = new Set<PaymentMethod>(['faktura', 'stripe']);

/** Parser lagret verdi ("faktura,stripe") → liste. Faller tilbake til faktura. */
export function parsePaymentMethods(raw: string | null | undefined): PaymentMethod[] {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is PaymentMethod => VALID.has(s as PaymentMethod));
  return list.length ? Array.from(new Set(list)) : ['faktura'];
}

/** Normaliserer en liste til lagringsformat. Faktura er alltid minst mulig fallback. */
export function serializePaymentMethods(methods: string[] | null | undefined): string {
  const list = (methods ?? []).filter((m): m is PaymentMethod => VALID.has(m as PaymentMethod));
  return (list.length ? Array.from(new Set(list)) : ['faktura']).join(',');
}

// Publiserbare nøkler — offentlige, trygge i repo/bundle.
export const STRIPE_PUBLISHABLE_KEYS = {
  live: 'pk_live_51TogqXFr8zej7iQSj0usaP5JKQ4yLlg3YUOLIq4iWctvAAMvzghLyHlO9vLoZJbf2CdMCKaHuWC5NVFvo1jhpeJH00PjyiriIK',
  test: 'pk_test_51Togqj2E7fA7lF6oOrqGFVNBuZ6WYtYZZgECrMn92GGJ0gF5RsrsxVyLP8aYCxYS04pkyS8e162w2tbe1KTT97jK00Dx3lhgRL',
} as const;

export function isTestMode(setting: string | null | undefined): boolean {
  return setting === 'true';
}

/** Secret-nøkkel fra env, valgt etter modus. Undefined = ikke konfigurert (Orange). */
export function stripeSecretKey(testMode: boolean): string | undefined {
  return testMode ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY;
}

export function stripePublishableKey(testMode: boolean): string {
  return testMode ? STRIPE_PUBLISHABLE_KEYS.test : STRIPE_PUBLISHABLE_KEYS.live;
}

/** Er Stripe faktisk brukbar i valgt modus (secret-nøkkel satt)? */
export function isStripeConfigured(testMode: boolean): boolean {
  return !!stripeSecretKey(testMode);
}

/** Kroner (kan ha ører som desimal) → heltall ører for Stripe. */
export function kronerToOre(price: number): number {
  return Math.round(price * 100);
}
