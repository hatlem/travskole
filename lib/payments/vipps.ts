/**
 * Vipps MobilePay ePayment-integrasjon: betaling + webhook-verifisering.
 *
 * Ingen offisiell SDK — tynn wrapper rundt Vipps sitt REST-API med ren fetch.
 * Feiler aldri utad: manglende konfig eller API-feil gir `null` tilbake til
 * kalleren, som logger og faller tilbake (f.eks. faktura). Aldri logg secrets.
 *
 * `verifyVippsWebhook` er en ren funksjon (ingen IO) — secret/now/host/path
 * kan injiseres, noe som gjør den enkel å TDD'e med syntetiske vektorer.
 */
import crypto from 'crypto';
import logger from '@/lib/logger';
import { kronerToOre } from '@/lib/payments';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

// Produksjonsverdier for webhook-signaturens kanoniske streng når opts.host/path
// ikke er oppgitt — dette er VÅR endepunkt-URL (Vipps signerer mot mottakeren),
// ikke Vipps sin egen API-host.
const PROD_WEBHOOK_HOST = 'registrering.bjerke.no';
const PROD_WEBHOOK_PATH = '/api/webhooks/vipps';

export interface VippsEnv {
  clientId?: string;
  clientSecret?: string;
  subscriptionKey?: string;
  msn?: string;
}

/** Resolves Vipps env vars from an object, selecting live or test set based on testMode. */
export function vippsEnvFrom(env: Record<string, string | undefined>, testMode: boolean): VippsEnv {
  if (testMode) {
    return {
      clientId: env.VIPPS_CLIENT_ID_TEST,
      clientSecret: env.VIPPS_CLIENT_SECRET_TEST,
      subscriptionKey: env.VIPPS_SUBSCRIPTION_KEY_TEST,
      msn: env.VIPPS_MSN_TEST,
    };
  }
  return {
    clientId: env.VIPPS_CLIENT_ID,
    clientSecret: env.VIPPS_CLIENT_SECRET,
    subscriptionKey: env.VIPPS_SUBSCRIPTION_KEY,
    msn: env.VIPPS_MSN,
  };
}

/** Resolves Vipps env vars from process.env, selecting live or test set based on testMode. */
export function vippsEnv(testMode: boolean): VippsEnv {
  return vippsEnvFrom(process.env, testMode);
}

/** Er Vipps konfigurert (alle nødvendige env-variabler satt) for valgt modus? */
export function isVippsConfigured(testMode: boolean): boolean {
  const env = vippsEnv(testMode);
  return !!(env.clientId && env.clientSecret && env.subscriptionKey && env.msn);
}

/** Test- eller live-miljø for Vipps API, basert på testMode. */
export function vippsBaseUrl(testMode: boolean): string {
  return testMode ? 'https://apitest.vipps.no' : 'https://api.vipps.no';
}

/** Henter access token fra Vipps. Aldri throw — null ved feil (logget). */
async function getVippsAccessToken(testMode: boolean): Promise<string | null> {
  try {
    const env = vippsEnv(testMode);
    const res = await fetch(`${vippsBaseUrl(testMode)}/accesstoken/get`, {
      method: 'POST',
      headers: {
        client_id: env.clientId as string,
        client_secret: env.clientSecret as string,
        'Ocp-Apim-Subscription-Key': env.subscriptionKey as string,
      },
    });
    if (!res.ok) {
      logger.error('Vipps access-token-forespørsel feilet', { status: res.status });
      return null;
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      logger.error('Vipps access-token mangler i respons');
      return null;
    }
    return json.access_token;
  } catch (error) {
    logger.error('Vipps access-token-forespørsel kastet feil', { error });
    return null;
  }
}

export interface CreateVippsPaymentInput {
  reference: string;
  amountKr: number;
  description: string;
  returnUrl: string;
  testMode: boolean;
}

/** Oppretter en Vipps ePayment for påmelding eller bestillingsforespørsel. */
export async function createVippsPayment(
  input: CreateVippsPaymentInput
): Promise<{ url: string; ref: string } | null> {
  const { reference, amountKr, description, returnUrl, testMode } = input;
  if (!isVippsConfigured(testMode)) {
    logger.error('Vipps ikke konfigurert — kan ikke opprette betaling', { reference });
    return null;
  }

  const accessToken = await getVippsAccessToken(testMode);
  if (!accessToken) return null;

  try {
    const env = vippsEnv(testMode);
    const res = await fetch(`${vippsBaseUrl(testMode)}/epayment/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Ocp-Apim-Subscription-Key': env.subscriptionKey as string,
        'Merchant-Serial-Number': env.msn as string,
        'Idempotency-Key': reference,
      },
      body: JSON.stringify({
        amount: { currency: 'NOK', value: kronerToOre(amountKr) },
        paymentMethod: { type: 'WALLET' },
        reference,
        returnUrl,
        userFlow: 'WEB_REDIRECT',
        paymentDescription: description,
      }),
    });
    if (!res.ok) {
      logger.error('Vipps betalingsopprettelse feilet', { status: res.status, reference });
      return null;
    }
    const json = (await res.json()) as { redirectUrl?: string };
    if (!json.redirectUrl) {
      logger.error('Vipps betaling mangler redirectUrl i respons', { reference });
      return null;
    }
    return { url: json.redirectUrl, ref: reference };
  } catch (error) {
    logger.error('Vipps betalingsopprettelse kastet feil', { error, reference });
    return null;
  }
}

export interface VippsWebhookHeaders {
  date: string | null;
  contentSha256: string | null;
  authorization: string | null;
}

export interface VerifyVippsWebhookOpts {
  secret?: string;
  now?: Date;
  host?: string;
  path?: string;
}

/** Konstant-tid strengsammenligning (unngår timing-lekkasje av signaturer). */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifiserer en Vipps webhook-signatur (ren funksjon, ingen IO).
 *
 * Per Vipps sin webhook-spesifikasjon:
 * - `x-ms-content-sha256` skal være base64(SHA-256(rawBody)).
 * - `Authorization` har formen
 *   `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=<base64>`
 *   der signaturen er HMAC-SHA256(secret, `POST\n{path}\n{date};{host};{contentSha256}`).
 *
 * NB: Vipps sin webhook-secret brukes som RÅ streng-bytes i HMAC-nøkkelen —
 * IKKE base64-dekodet først. Dette er en dokumentert antakelse basert på
 * Vipps' offisielle webhook-eksempler.
 */
export function verifyVippsWebhook(
  rawBody: string,
  headers: VippsWebhookHeaders,
  opts: VerifyVippsWebhookOpts = {}
): boolean {
  const { date, contentSha256, authorization } = headers;
  if (!date || !contentSha256 || !authorization) {
    logger.error('Vipps webhook mangler nødvendige headere');
    return false;
  }

  const secret = opts.secret ?? process.env.VIPPS_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('Vipps webhook-secret ikke konfigurert');
    return false;
  }

  const now = opts.now ?? new Date();
  const host = opts.host ?? PROD_WEBHOOK_HOST;
  const path = opts.path ?? PROD_WEBHOOK_PATH;

  const requestDate = new Date(date);
  if (Number.isNaN(requestDate.getTime())) {
    logger.error('Vipps webhook har uleselig dato-header');
    return false;
  }
  if (Math.abs(now.getTime() - requestDate.getTime()) > FIVE_MINUTES_MS) {
    logger.error('Vipps webhook avvist — dato utenfor gyldighetsvindu');
    return false;
  }

  const expectedContentSha256 = crypto.createHash('sha256').update(rawBody).digest('base64');
  if (!timingSafeEqualStrings(contentSha256, expectedContentSha256)) {
    logger.error('Vipps webhook avvist — innholdshash stemmer ikke');
    return false;
  }

  const signatureMatch = /Signature=([^&\s]+)/.exec(authorization);
  if (!signatureMatch) {
    logger.error('Vipps webhook avvist — Authorization mangler Signature');
    return false;
  }
  const providedSignature = signatureMatch[1];

  const canonicalString = `POST\n${path}\n${date};${host};${contentSha256}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(canonicalString).digest('base64');

  if (!timingSafeEqualStrings(providedSignature, expectedSignature)) {
    logger.error('Vipps webhook avvist — signatur stemmer ikke');
    return false;
  }

  return true;
}
