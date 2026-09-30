/**
 * Stripe-integrasjon: Checkout-sesjon, sesjonsoppslag og webhook-verifisering.
 *
 * Tynn wrapper rundt Stripe SDK — ingen forretningslogikk her (den ligger i
 * mapping.ts). Klienten instansieres per kall siden secret-nøkkelen avhenger
 * av test/live-modus. Feiler aldri utad: manglende konfig eller SDK-feil gir
 * `null` tilbake til kalleren, som logger og faller tilbake (f.eks. faktura).
 */
import Stripe from 'stripe';
import logger from '@/lib/logger';
import { stripeSecretKey, isStripeConfigured, kronerToOre } from '@/lib/payments';

/** Verifisert Stripe-event med utvidet typ for komposisjon med mapStripeEvent. */
export interface VerifiedStripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

function stripeClient(testMode: boolean): Stripe | null {
  const secretKey = stripeSecretKey(testMode);
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

export interface CreateStripeCheckoutInput {
  kind: 'registration' | 'booking';
  id: number;
  title: string;
  amountKr: number;
  successUrl: string;
  cancelUrl: string;
  testMode: boolean;
  /** Forhåndsutfyller e-post i Stripe Checkout. */
  customerEmail?: string;
}

/** Oppretter en Stripe Checkout Session for påmelding eller bestillingsforespørsel. */
export async function createStripeCheckout(
  input: CreateStripeCheckoutInput
): Promise<{ url: string; ref: string } | null> {
  const { kind, id, title, amountKr, successUrl, cancelUrl, testMode, customerEmail } = input;
  if (!isStripeConfigured(testMode)) {
    logger.error('Stripe ikke konfigurert — kan ikke opprette checkout', { testMode });
    return null;
  }
  const client = stripeClient(testMode);
  if (!client) return null;

  const metadata: Record<string, string> =
    kind === 'registration' ? { registrationId: String(id) } : { bookingRequestId: String(id) };

  try {
    const session = await client.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'nok',
            unit_amount: kronerToOre(amountKr),
            product_data: { name: title },
          },
          quantity: 1,
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      ...(customerEmail && { customer_email: customerEmail }),
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    if (!session.url) {
      logger.error('Stripe checkout-sesjon mangler url', { ref: session.id });
      return null;
    }
    return { url: session.url, ref: session.id };
  } catch (error) {
    logger.error('Stripe checkout-opprettelse feilet', { error, kind, id });
    return null;
  }
}

/** Konfigurerte webhook-secrets med modusen events signert med dem må ha. */
function stripeWebhookSecrets(): { secret: string; livemode: boolean }[] {
  const entries = [
    { secret: process.env.STRIPE_WEBHOOK_SECRET, livemode: true },
    { secret: process.env.STRIPE_WEBHOOK_SECRET_TEST, livemode: false },
  ];
  return entries.filter((e): e is { secret: string; livemode: boolean } => !!e.secret);
}

export type StripeWebhookVerification =
  | { ok: true; event: VerifiedStripeEvent }
  | { ok: false; reason: 'invalid_signature' | 'mode_mismatch' };

/**
 * Verifiserer signatur og parser Stripe-webhook-eventet. Aldri throw.
 *
 * Prøver både live- og test-secret: hvilken modus betalingen ble startet i
 * trenger ikke være dagens `payment_test_mode` (admin kan ha byttet i
 * mellomtiden). Et event må ha `livemode` som matcher secreten det er signert
 * med, ellers kunne en lekket test-secret brukes til å forfalske live-betalinger.
 */
export function verifyStripeWebhook(rawBody: string, signature: string | null): StripeWebhookVerification {
  if (!signature) {
    logger.error('Stripe webhook mangler signatur');
    return { ok: false, reason: 'invalid_signature' };
  }
  const secrets = stripeWebhookSecrets();
  if (secrets.length === 0) {
    logger.error('Stripe webhook-secret ikke konfigurert');
    return { ok: false, reason: 'invalid_signature' };
  }
  let modeMismatch = false;
  for (const { secret, livemode } of secrets) {
    let event: VerifiedStripeEvent;
    try {
      // Verifiseringsgrensen: cast slik at konsumenter kan komponere med mapStripeEvent.
      event = Stripe.webhooks.constructEvent(rawBody, signature, secret) as unknown as VerifiedStripeEvent;
    } catch {
      continue;
    }
    if (event.livemode === livemode) return { ok: true, event };
    modeMismatch = true;
  }
  if (modeMismatch) {
    logger.error('Stripe webhook: livemode matcher ikke secreten eventet er signert med');
    return { ok: false, reason: 'mode_mismatch' };
  }
  logger.error('Stripe webhook-verifisering feilet for alle konfigurerte secrets');
  return { ok: false, reason: 'invalid_signature' };
}

/** Test/live ut fra checkout-sesjonens ID (cs_test_… / cs_live_…). Null = ikke en sesjons-ID. */
export function stripeSessionTestMode(sessionId: string): boolean | null {
  if (sessionId.startsWith('cs_test_')) return true;
  if (sessionId.startsWith('cs_live_')) return false;
  return null;
}

/**
 * Henter en checkout-sesjon direkte fra Stripe med nøkkelen for sesjonens egen
 * modus. Brukes som fallback på takk-siden når webhooken ikke har kommet.
 * Aldri throw — null ved feil/manglende konfig.
 */
export async function retrieveStripeCheckoutSession(
  sessionId: string
): Promise<{ id: string; paymentStatus: string; object: Record<string, unknown> } | null> {
  const testMode = stripeSessionTestMode(sessionId);
  if (testMode === null) return null;
  const client = stripeClient(testMode);
  if (!client) {
    logger.error('Stripe ikke konfigurert — kan ikke hente checkout-sesjon', { testMode });
    return null;
  }
  try {
    const session = await client.checkout.sessions.retrieve(sessionId);
    return {
      id: session.id,
      paymentStatus: session.payment_status,
      object: session as unknown as Record<string, unknown>,
    };
  } catch (error) {
    logger.error('Stripe: henting av checkout-sesjon feilet', { error, sessionId });
    return null;
  }
}
