import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import logger from '@/lib/logger';
import { stripeSecretKey, isStripeConfigured } from '@/lib/payments';

/**
 * Engangs go-live-registrering av Stripe-webhooken mot LIVE-miljø.
 *
 * I motsetning til Vipps HAR Stripe et dashboard-UI for dette (brukt for
 * førstegangs-registrering) — men Stripes offentlige API returnerer kun
 * `secret` ved CREATE, aldri ved retrieve/list/update, og har ingen
 * "roll secret"-operasjon (det er dashboard-only). Denne ruta lar oss
 * likevel rotere secreten fullt selvbetjent: slett + opprett på nytt via
 * API-et, med appens egen allerede-provisjonerte STRIPE_SECRET_KEY — samme
 * mønster som /api/admin/register-vipps-webhook.
 *
 * Idempotent: lister eksisterende endpoints og hopper over opprettelse hvis
 * ett allerede finnes mot vår URL (med mindre rotate:true er satt).
 *
 * Beskyttet av SEED_SECRET. Responsen inneholder Stripe sin genererte
 * webhook-secret ÉN gang — fang den opp herfra og legg den i
 * STRIPE_WEBHOOK_SECRET i Azure (via sikker lenke til Basefarm, aldri i klartekst).
 *
 * Kall: POST /api/admin/register-stripe-webhook  { "secret": "<SEED_SECRET>" }
 * Valgfritt: { "rotate": true } sletter en eksisterende webhook mot vår URL
 * FØRST, deretter oppretter en ny (ny secret).
 */

const CALLBACK_URL = 'https://registrering.bjerke.no/api/webhooks/stripe';

// Event-typer som faktisk håndteres av lib/payments/mapping.ts (mapStripeEvent).
const EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
  'charge.refunded',
];

export async function POST(request: NextRequest) {
  if (!process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Not configured' }, { status: 403 });
  }

  const { secret, rotate } = await request.json().catch(() => ({}));
  if (secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const testMode = false; // go-live registrerer LIVE-webhooken.
  if (!isStripeConfigured(testMode)) {
    return NextResponse.json({ error: 'Stripe ikke konfigurert (mangler STRIPE_SECRET_KEY)' }, { status: 503 });
  }

  const client = new Stripe(stripeSecretKey(testMode) as string);

  try {
    const list = await client.webhookEndpoints.list({ limit: 100 });
    const existing = list.data.find((w) => w.url === CALLBACK_URL);
    let deletedId: string | null = null;

    if (existing && !rotate) {
      return NextResponse.json({
        ok: true,
        created: false,
        id: existing.id,
        events: existing.enabled_events,
        note: 'Webhook fantes allerede mot denne URL-en — ingen ny opprettet, secret vises kun ved opprettelse. Send { "rotate": true } for å erstatte med en ny secret.',
      });
    }
    if (existing && rotate) {
      await client.webhookEndpoints.del(existing.id);
      deletedId = existing.id;
    }

    const created = await client.webhookEndpoints.create({
      url: CALLBACK_URL,
      enabled_events: EVENTS,
    });

    return NextResponse.json({
      ok: true,
      created: true,
      rotatedFrom: deletedId,
      id: created.id,
      secret: created.secret,
      events: created.enabled_events,
    });
  } catch (error) {
    logger.error('Stripe webhook-registrering feilet', { error });
    return NextResponse.json(
      { error: 'Stripe webhook-registrering feilet', message: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
