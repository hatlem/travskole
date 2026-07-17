export interface PaymentEventInput {
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
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
  if (event.type === 'charge.refunded') {
    const amount = num(o.amount_refunded);
    if (typeof o.payment_intent !== 'string') return null;
    return {
      type: 'payment.refunded', provider: 'stripe',
      ref: o.payment_intent, refKind: 'paymentRef',
      amountKr: amount !== null ? amount / 100 : null,
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
  REFUNDED: 'payment.refunded',
};

export function mapVippsEvent(body: Record<string, unknown>): PaymentEventInput | null {
  const reference = typeof body.reference === 'string' ? body.reference : null;
  const name = typeof body.name === 'string' ? body.name : typeof body.eventName === 'string' ? body.eventName : null;
  if (!reference || !name) return null;
  const type = VIPPS_MAP[name];
  if (!type) return null;
  const amountValue = typeof body.amount === 'object' && body.amount !== null ? num((body.amount as Record<string, unknown>).value) : null;
  return {
    type, provider: 'vipps', ref: reference, refKind: 'paymentRef',
    amountKr: amountValue !== null ? amountValue / 100 : null,
    eventId: `${reference}:${name}`,
  };
}
