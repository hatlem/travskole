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

/** Konfigurerte webhook-secrets, uavhengig av dagens test/live-innstilling. */
function stripeWebhookSecrets(): string[] {
  return [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_WEBHOOK_SECRET_TEST].filter(
    (secret): secret is string => !!secret
  );
}

/**
 * Verifiserer signatur og parser Stripe-webhook-eventet. Aldri throw — null ved feil.
 *
 * Prøver både live- og test-secret: hvilken modus betalingen ble startet i
 * trenger ikke være dagens `payment_test_mode` (admin kan ha byttet i
 * mellomtiden). `event.livemode` sier hvilken modus eventet faktisk gjelder.
 */
export function verifyStripeWebhook(rawBody: string, signature: string | null): VerifiedStripeEvent | null {
  if (!signature) {
    logger.error('Stripe webhook mangler signatur');
    return null;
  }
  const secrets = stripeWebhookSecrets();
  if (secrets.length === 0) {
    logger.error('Stripe webhook-secret ikke konfigurert');
    return null;
  }
  for (const secret of secrets) {
    try {
      const event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
      // Verifiseringsgrensen: cast slik at konsumenter kan komponere med mapStripeEvent.
      return event as unknown as VerifiedStripeEvent;
    } catch {
      // Prøv neste secret.
    }
  }
  logger.error('Stripe webhook-verifisering feilet for alle konfigurerte secrets');
  return null;
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
