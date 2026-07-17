/**
 * Stripe-integrasjon: Checkout-sesjon + webhook-verifisering.
 *
 * Tynn wrapper rundt Stripe SDK — ingen forretningslogikk her (den ligger i
 * mapping.ts). Klienten instansieres per kall siden secret-nøkkelen avhenger
 * av test/live-modus. Feiler aldri utad: manglende konfig eller SDK-feil gir
 * `null` tilbake til kalleren, som logger og faller tilbake (f.eks. faktura).
 */
import Stripe from 'stripe';
import logger from '@/lib/logger';
import { stripeSecretKey, isStripeConfigured, kronerToOre } from '@/lib/payments';

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
}

/** Oppretter en Stripe Checkout Session for påmelding eller bestillingsforespørsel. */
export async function createStripeCheckout(
  input: CreateStripeCheckoutInput
): Promise<{ url: string; ref: string } | null> {
  const { kind, id, title, amountKr, successUrl, cancelUrl, testMode } = input;
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

/** Webhook-secret for gjeldende modus. Undefined = ikke konfigurert. */
function stripeWebhookSecret(testMode: boolean): string | undefined {
  return testMode ? process.env.STRIPE_WEBHOOK_SECRET_TEST : process.env.STRIPE_WEBHOOK_SECRET;
}

/** Verifiserer signatur og parser Stripe-webhook-eventet. Aldri throw — null ved feil. */
export function verifyStripeWebhook(
  rawBody: string,
  signature: string | null,
  testMode: boolean
): Stripe.Event | null {
  if (!signature) {
    logger.error('Stripe webhook mangler signatur');
    return null;
  }
  const webhookSecret = stripeWebhookSecret(testMode);
  if (!webhookSecret) {
    logger.error('Stripe webhook-secret ikke konfigurert', { testMode });
    return null;
  }
  const client = stripeClient(testMode);
  if (!client) {
    logger.error('Stripe ikke konfigurert — kan ikke verifisere webhook', { testMode });
    return null;
  }
  try {
    return client.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    logger.error('Stripe webhook-verifisering feilet', { error });
    return null;
  }
}
