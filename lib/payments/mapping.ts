export interface PaymentEventInput {
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded' | 'payment.expired' | 'payment.partially_refunded';
  provider: 'stripe' | 'vipps';
  ref: string;
  refKind: 'paymentRef' | 'metadata';
  nextRef?: string;
  registrationId?: number;
  bookingRequestId?: number;
  amountKr: number | null;
  eventId: string;
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const idFromMeta = (meta: unknown, key: string): number | undefined => {
  if (typeof meta !== 'object' || meta === null) return undefined;
  const raw = (meta as Record<string, unknown>)[key];
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

export function mapStripeEvent(event: { id: string; type: string; data: { object: Record<string, unknown> } }): PaymentEventInput | null {
  const o = event.data.object;
  if (event.type === 'checkout.session.completed') {
    const amount = num(o.amount_total);
    return {
      type: 'payment.succeeded', provider: 'stripe',
      ref: String(o.id), refKind: 'paymentRef',
      nextRef: typeof o.payment_intent === 'string' ? o.payment_intent : undefined,
      registrationId: idFromMeta(o.metadata, 'registrationId'),
      bookingRequestId: idFromMeta(o.metadata, 'bookingRequestId'),
      amountKr: amount !== null ? amount / 100 : null,
      eventId: event.id,
    };
  }
  if (event.type === 'payment_intent.payment_failed') {
    const amount = num(o.amount);
    return {
      type: 'payment.failed', provider: 'stripe',
      ref: String(o.id), refKind: 'metadata',
      registrationId: idFromMeta(o.metadata, 'registrationId'),
      bookingRequestId: idFromMeta(o.metadata, 'bookingRequestId'),
      amountKr: amount !== null ? amount / 100 : null,
      eventId: event.id,
    };
  }
  if (event.type === 'checkout.session.expired') {
    return {
      type: 'payment.expired', provider: 'stripe',
      ref: String(o.id), refKind: 'paymentRef',
      registrationId: idFromMeta(o.metadata, 'registrationId'),
      bookingRequestId: idFromMeta(o.metadata, 'bookingRequestId'),
      amountKr: null,
      eventId: event.id,
    };
  }
  if (event.type === 'charge.refunded') {
    if (typeof o.payment_intent !== 'string') return null;
    const refunded = num(o.amount_refunded);
    const total = num(o.amount); // charge-total; kan mangle
    // Del vs full: kun når vi HAR totalen og refundert < total er det delvis.
    // Mangler totalen ⇒ konservativt full refunded (dagens oppførsel).
    const isPartial = total !== null && refunded !== null && refunded < total;
    return {
      type: isPartial ? 'payment.partially_refunded' : 'payment.refunded',
      provider: 'stripe', ref: o.payment_intent, refKind: 'paymentRef',
      amountKr: refunded !== null ? refunded / 100 : null,
      eventId: event.id,
    };
  }
  return null;
}

const VIPPS_MAP: Record<string, PaymentEventInput['type']> = {
  AUTHORIZED: 'payment.succeeded',
  CAPTURED: 'payment.succeeded',
  FAILED: 'payment.failed',
  EXPIRED: 'payment.failed',
  CANCELLED: 'payment.failed',
  TERMINATED: 'payment.failed',
  // REFUNDED håndteres spesielt i mapVippsEvent (del vs full).
};

export function mapVippsEvent(body: Record<string, unknown>): PaymentEventInput | null {
  const reference = typeof body.reference === 'string' ? body.reference : null;
  const name = typeof body.name === 'string' ? body.name : typeof body.eventName === 'string' ? body.eventName : null;
  if (!reference || !name) return null;
  const amountValue = typeof body.amount === 'object' && body.amount !== null ? num((body.amount as Record<string, unknown>).value) : null;
  // Vipps-refusjon: skill del vs full når payloaden bærer både refundert beløp
  // og opprinnelig total (transactionInfo). Mangler totalen ⇒ konservativ full.
  if (name === 'REFUNDED') {
    const ti = typeof body.transactionInfo === 'object' && body.transactionInfo !== null
      ? (body.transactionInfo as Record<string, unknown>) : null;
    const refunded = ti ? num(ti.refundedAmount) : null;
    const total = ti ? num(ti.amount) : null;
    const isPartial = total !== null && refunded !== null && refunded < total;
    return {
      type: isPartial ? 'payment.partially_refunded' : 'payment.refunded',
      provider: 'vipps', ref: reference, refKind: 'paymentRef',
      amountKr: amountValue !== null ? amountValue / 100 : null,
      eventId: `${reference}:${name}`,
    };
  }
  const type = VIPPS_MAP[name];
  if (!type) return null;
  return {
    type, provider: 'vipps', ref: reference, refKind: 'paymentRef',
    amountKr: amountValue !== null ? amountValue / 100 : null,
    eventId: `${reference}:${name}`,
  };
}
