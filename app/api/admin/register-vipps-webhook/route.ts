import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import {
  getVippsAccessToken,
  isVippsConfigured,
  vippsBaseUrl,
  vippsEnv,
  vippsWebhookUrl,
} from '@/lib/payments/vipps';

/**
 * Engangs go-live-registrering av Vipps-webhooken mot LIVE-miljø.
 *
 * Vipps' utviklerportal er read-only for webhooks ("bruk Webhooks API") — det
 * finnes ingen "Legg til"-knapp der, i motsetning til Stripe. Appen har
 * allerede de nødvendige credentials som Azure-env-vars (samme sett den
 * bruker til å opprette ePayments), så vi kaller Vipps sitt Webhooks API
 * server-side i stedet for å be Basefarm gjøre det med sin egen kopi av
 * hemmelighetene.
 *
 * Idempotent: sjekker først GET /webhooks/v1/webhooks og hopper over
 * opprettelse hvis en webhook mot vår URL allerede finnes.
 *
 * Beskyttet av SEED_SECRET. Responsen inneholder Vipps sin genererte
 * webhook-secret ÉN gang — fang den opp herfra og legg den i
 * VIPPS_WEBHOOK_SECRET i Azure (via sikker lenke til Basefarm, aldri i klartekst).
 *
 * Kall: POST /api/admin/register-vipps-webhook  { "secret": "<SEED_SECRET>" }
 * Valgfritt: { "rotate": true } sletter en eksisterende webhook mot vår URL
 * FØRST, deretter oppretter en ny (ny secret) — bruk hvis forrige secret ble
 * eksponert (f.eks. limt inn et sted den ikke burde vært).
 */

// Event-typer som faktisk håndteres av lib/payments/mapping.ts sin VIPPS_MAP
// + REFUNDED-spesialhåndteringen. "created" er bevisst utelatt — appen
// oppretter selv betalingen via API-kallet og trenger ingen notifikasjon om
// egen opprettelse.
const EVENTS = [
  'epayments.payment.authorized.v1',
  'epayments.payment.captured.v1',
  'epayments.payment.cancelled.v1',
  'epayments.payment.aborted.v1',
  'epayments.payment.expired.v1',
  'epayments.payment.terminated.v1',
  'epayments.payment.refunded.v1',
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
  if (!isVippsConfigured(testMode)) {
    return NextResponse.json({ error: 'Vipps ikke konfigurert (mangler env-vars)' }, { status: 503 });
  }

  const token = await getVippsAccessToken(testMode);
  if (!token) {
    return NextResponse.json({ error: 'Kunne ikke hente Vipps access token' }, { status: 502 });
  }

  const env = vippsEnv(testMode);
  const baseUrl = vippsBaseUrl(testMode);
  const callbackUrl = vippsWebhookUrl();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Ocp-Apim-Subscription-Key': env.subscriptionKey as string,
    'Merchant-Serial-Number': env.msn as string,
    'Content-Type': 'application/json',
  };

  try {
    const listRes = await fetch(`${baseUrl}/webhooks/v1/webhooks`, { headers });
    let deletedId: string | null = null;
    if (listRes.ok) {
      const list = (await listRes.json()) as { webhooks?: { id: string; url: string; events: string[] }[] };
      const existing = list.webhooks?.find((w) => w.url === callbackUrl);
      if (existing && !rotate) {
        return NextResponse.json({
          ok: true,
          created: false,
          id: existing.id,
          events: existing.events,
          note: 'Webhook fantes allerede mot denne URL-en — ingen ny opprettet, secret vises kun ved opprettelse. Send { "rotate": true } for å erstatte med en ny secret.',
        });
      }
      if (existing && rotate) {
        const delRes = await fetch(`${baseUrl}/webhooks/v1/webhooks/${existing.id}`, { method: 'DELETE', headers });
        if (!delRes.ok) {
          return NextResponse.json(
            { error: 'Kunne ikke slette eksisterende webhook før rotasjon', status: delRes.status },
            { status: 502 }
          );
        }
        deletedId = existing.id;
      }
    } else {
      logger.warn('Vipps webhook-liste-kall feilet, fortsetter med opprettelse', { status: listRes.status });
    }

    const createRes = await fetch(`${baseUrl}/webhooks/v1/webhooks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: callbackUrl, events: EVENTS }),
    });

    if (!createRes.ok) {
      const errorBody = await createRes.text().catch(() => '');
      logger.error('Vipps webhook-registrering feilet', { status: createRes.status });
      return NextResponse.json(
        { error: 'Vipps webhook-registrering feilet', status: createRes.status, body: errorBody },
        { status: 502 }
      );
    }

    const created = (await createRes.json()) as { id: string; secret: string };
    return NextResponse.json({
      ok: true,
      created: true,
      rotatedFrom: deletedId,
      id: created.id,
      secret: created.secret,
      events: EVENTS,
    });
  } catch (error) {
    logger.error('Vipps webhook-registrering kastet feil', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
