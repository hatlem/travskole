import { describe, it, expect } from 'vitest';
import { mapStripeEvent, mapVippsEvent } from '@/lib/payments/mapping';

describe('mapStripeEvent', () => {
  it('checkout.session.completed → succeeded with session ref and PI nextRef', () => {
    const r = mapStripeEvent({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_123', payment_intent: 'pi_456', amount_total: 250000, metadata: { registrationId: '7' } } },
    });
    expect(r).toMatchObject({
      type: 'payment.succeeded', provider: 'stripe', ref: 'cs_123', refKind: 'paymentRef',
      nextRef: 'pi_456', registrationId: 7, amountKr: 2500, eventId: 'evt_1',
    });
  });

  it('payment_intent.payment_failed → failed via metadata', () => {
    const r = mapStripeEvent({
      id: 'evt_2', type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_456', amount: 250000, metadata: { bookingRequestId: '3' } } },
    });
    expect(r?.type).toBe('payment.failed');
    expect(r?.refKind).toBe('metadata');
    expect(r?.bookingRequestId).toBe(3);
    expect(r?.amountKr).toBe(2500);
  });

  it('charge.refunded → refunded keyed on payment_intent', () => {
    const r = mapStripeEvent({
      id: 'evt_3', type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: 'pi_456', amount_refunded: 250000 } },
    });
    expect(r).toMatchObject({ type: 'payment.refunded', ref: 'pi_456', refKind: 'paymentRef', amountKr: 2500 });
  });

  it('unknown type → null', () => {
    expect(mapStripeEvent({ id: 'e', type: 'invoice.paid', data: { object: {} } })).toBeNull();
  });
});

describe('mapVippsEvent', () => {
  it('AUTHORIZED → succeeded', () => {
    const r = mapVippsEvent({ reference: 'reg-7-abc', name: 'AUTHORIZED', amount: { currency: 'NOK', value: 250000 } });
    expect(r).toMatchObject({ type: 'payment.succeeded', provider: 'vipps', ref: 'reg-7-abc', refKind: 'paymentRef', amountKr: 2500, eventId: 'reg-7-abc:AUTHORIZED' });
  });
  it('EXPIRED → failed; REFUNDED → refunded', () => {
    expect(mapVippsEvent({ reference: 'r', name: 'EXPIRED' })?.type).toBe('payment.failed');
    expect(mapVippsEvent({ reference: 'r', name: 'REFUNDED' })?.type).toBe('payment.refunded');
  });
  it('unknown / missing reference → null', () => {
    expect(mapVippsEvent({ name: 'AUTHORIZED' })).toBeNull();
    expect(mapVippsEvent({ reference: 'r', name: 'CREATED' })).toBeNull();
  });
});
