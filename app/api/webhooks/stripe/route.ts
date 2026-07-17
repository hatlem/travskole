/**
 * POST /api/webhooks/stripe
 *
 * Offentlig endepunkt (ingen sesjon/cookies) — Stripe kaller denne direkte.
 * Signaturen verifiseres FØR noe annet gjøres. Aldri logg rawBody eller
 * signaturen (kan inneholde/avsløre secrets/sensitive betalingsdata).
 *
 * Feilkontrakt: en THROWN feil fra applyPaymentEvent skal IKKE fanges her —
 * den propagerer til catch-en under og gir 500, slik at Stripe gjenforsøker
 * leveransen (se lib/payments/apply.ts for hvorfor kjerneflyten kaster).
 */
import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { getSetting } from '@/lib/settings';
import { isTestMode } from '@/lib/payments';
import { verifyStripeWebhook } from '@/lib/payments/stripe';
import { mapStripeEvent } from '@/lib/payments/mapping';
import { applyPaymentEvent } from '@/lib/payments/apply';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  const testMode = isTestMode(await getSetting('payment_test_mode'));
  const event = verifyStripeWebhook(rawBody, signature, testMode);
  if (!event) {
    return NextResponse.json({ error: 'Ugyldig signatur' }, { status: 401 });
  }

  const mapped = mapStripeEvent(event);
  if (!mapped) {
    return NextResponse.json({ received: true });
  }

  try {
    const result = await applyPaymentEvent(mapped);
    if (result === 'not_found') {
      logger.warn('Stripe webhook: fant ikke rad for betalingsevent', {
        eventId: mapped.eventId,
        type: mapped.type,
      });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error('Stripe webhook: applyPaymentEvent feilet', {
      error,
      eventId: mapped.eventId,
      type: mapped.type,
    });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
