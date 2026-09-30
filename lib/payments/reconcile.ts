/**
 * Takk-sidens avstemming mot betalingsleverandøren.
 *
 * Webhooken er hovedveien, men kan utebli (manglende secret, nedetid) eller
 * komme etter at kunden lander på /betaling/takk. Da spør vi Stripe/Vipps
 * direkte og kjører SAMME idempotente applyPaymentEvent som webhooken, så en
 * senere webhook ikke dobbeltføres (se paymentEventDedupeKey). Refen er en
 * uforutsigbar leverandør-ID, og kun det leverandøren selv bekrefter anvendes.
 */
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { getSetting } from '@/lib/settings';
import { isTestMode } from '@/lib/payments';
import { applyPaymentEvent } from './apply';
import { mapStripeEvent, mapVippsEvent } from './mapping';
import { retrieveStripeCheckoutSession, stripeSessionTestMode } from './stripe';
import { getVippsPayment, isVippsConfigured, type VippsPaymentSnapshot } from './vipps';
import { STATUS_RANK, type PaymentStatus } from './transitions';
import type { PaymentSubject } from './thank-you';

export type ThankYouStatus =
  | 'paid'
  | 'pending'
  | 'aborted'
  | 'expired'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'
  | 'not_found';

const TERMINAL_VIPPS_STATES = new Set(['AUTHORIZED', 'ABORTED', 'EXPIRED', 'TERMINATED']);

function isUnsettled(status: string): boolean {
  return (STATUS_RANK[status as PaymentStatus] ?? 0) < STATUS_RANK.paid;
}

async function findPayment(ref: string): Promise<{ status: string; provider: string | null } | null> {
  const select = { paymentStatus: true, paymentProvider: true } as const;
  const row =
    (await prisma.registration.findUnique({ where: { paymentRef: ref }, select })) ??
    (await prisma.bookingRequest.findUnique({ where: { paymentRef: ref }, select }));
  return row ? { status: row.paymentStatus, provider: row.paymentProvider } : null;
}

async function applySafely(input: Parameters<typeof applyPaymentEvent>[0]): Promise<void> {
  try {
    await applyPaymentEvent(input);
  } catch (error) {
    // Webhooken gjenforsøker; siden viser da status fra DB.
    logger.error('Betalingsavstemming: applyPaymentEvent feilet', { error, ref: input.ref });
  }
}

/** Anvender en betalt Stripe-sesjon. Returnerer true når Stripe bekrefter betalt. */
export async function reconcileStripeCheckout(sessionId: string): Promise<boolean> {
  const session = await retrieveStripeCheckoutSession(sessionId);
  if (!session || session.paymentStatus !== 'paid') return false;
  const mapped = mapStripeEvent({
    id: `reconcile:${session.id}`,
    type: 'checkout.session.completed',
    data: { object: session.object },
  });
  if (!mapped) return false;
  await applySafely(mapped);
  return true;
}

/** Vipps-referansen bærer ikke modus — prøv gjeldende innstilling først, så den andre. */
async function lookupVippsPayment(reference: string): Promise<VippsPaymentSnapshot | null> {
  const preferTest = isTestMode(await getSetting('payment_test_mode'));
  for (const testMode of [preferTest, !preferTest]) {
    if (!isVippsConfigured(testMode)) continue;
    const result = await getVippsPayment(reference, testMode);
    if (result === 'not_found') continue;
    return result;
  }
  return null;
}

/** Henter Vipps-status, anvender avsluttede tilstander og returnerer tilstanden (null = ukjent). */
export async function reconcileVippsPayment(reference: string): Promise<string | null> {
  const payment = await lookupVippsPayment(reference);
  if (!payment) return null;
  if (TERMINAL_VIPPS_STATES.has(payment.state)) {
    const mapped = mapVippsEvent({
      reference,
      name: payment.state,
      ...(payment.amountOre !== null && { amount: { value: payment.amountOre } }),
    });
    if (mapped) await applySafely(mapped);
  }
  return payment.state;
}

function toThankYouStatus(status: string): ThankYouStatus {
  if (status === 'none') return 'pending';
  if (status === 'cancelled') return 'aborted';
  const known: ThankYouStatus[] = ['paid', 'pending', 'expired', 'failed', 'refunded', 'partially_refunded'];
  return known.includes(status as ThankYouStatus) ? (status as ThankYouStatus) : 'not_found';
}

/** Status som vises på /betaling/takk for en leverandør-ref. */
export async function resolveThankYouStatus(ref: string | undefined): Promise<ThankYouStatus> {
  if (!ref) return 'not_found';
  const payment = await findPayment(ref);
  if (!payment) return 'not_found';
  if (!isUnsettled(payment.status)) return toThankYouStatus(payment.status);

  if (payment.provider === 'vipps') {
    const state = await reconcileVippsPayment(ref);
    if (state === 'ABORTED' || state === 'TERMINATED') return 'aborted';
    if (state === 'CREATED') return 'pending';
  } else if (stripeSessionTestMode(ref) !== null) {
    await reconcileStripeCheckout(ref);
  }

  const updated = await findPayment(ref);
  return toThankYouStatus(updated?.status ?? payment.status);
}

/** Påmeldingen/bookingen bak en leverandør-ref, for sannferdig tekst på takk-siden. */
export async function findPaymentSubject(ref: string | undefined): Promise<PaymentSubject | null> {
  if (!ref) return null;
  const select = { status: true } as const;
  const registration = await prisma.registration.findUnique({ where: { paymentRef: ref }, select });
  if (registration) return { kind: 'registration', status: registration.status };
  const booking = await prisma.bookingRequest.findUnique({ where: { paymentRef: ref }, select });
  return booking ? { kind: 'booking', status: booking.status } : null;
}
