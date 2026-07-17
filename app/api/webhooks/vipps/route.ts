/**
 * POST /api/webhooks/vipps
 *
 * Offentlig endepunkt (ingen sesjon/cookies) — Vipps kaller denne direkte.
 * Signaturen verifiseres FØR noe annet gjøres. Aldri logg rawBody eller
 * headerne (dato/hash/signatur kan avsløre sensitive detaljer).
 *
 * Feilkontrakt: en THROWN feil fra applyPaymentEvent skal IKKE fanges her —
 * den propagerer til catch-en under og gir 500, slik at Vipps gjenforsøker
 * leveransen (se lib/payments/apply.ts for hvorfor kjerneflyten kaster).
 */
import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { verifyVippsWebhook } from '@/lib/payments/vipps';
import { mapVippsEvent } from '@/lib/payments/mapping';
import { applyPaymentEvent } from '@/lib/payments/apply';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const headers = {
    date: request.headers.get('x-ms-date'),
    contentSha256: request.headers.get('x-ms-content-sha256'),
    authorization: request.headers.get('authorization'),
  };

  const verified = verifyVippsWebhook(rawBody, headers);
  if (!verified) {
    return NextResponse.json({ error: 'Ugyldig signatur' }, { status: 401 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }
  if (typeof parsedBody !== 'object' || parsedBody === null) {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const mapped = mapVippsEvent(parsedBody as Record<string, unknown>);
  if (!mapped) {
    return NextResponse.json({ received: true });
  }

  try {
    const result = await applyPaymentEvent(mapped);
    if (result === 'not_found') {
      logger.warn('Vipps webhook: fant ikke rad for betalingsevent', {
        eventId: mapped.eventId,
        type: mapped.type,
      });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error('Vipps webhook: applyPaymentEvent feilet', {
      error,
      eventId: mapped.eventId,
      type: mapped.type,
    });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
