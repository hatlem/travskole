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

  it('checkout.session.expired → payment.expired keyed on session id', () => {
    const r = mapStripeEvent({
      id: 'evt_x', type: 'checkout.session.expired',
      data: { object: { id: 'cs_999', payment_intent: null } },
    });
    expect(r).toMatchObject({ type: 'payment.expired', provider: 'stripe', ref: 'cs_999', refKind: 'paymentRef', eventId: 'evt_x' });
  });

  it('charge.refunded FULL (amount_refunded === amount) → payment.refunded', () => {
    const r = mapStripeEvent({
      id: 'evt_f', type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: 'pi_1', amount: 250000, amount_refunded: 250000 } },
    });
    expect(r).toMatchObject({ type: 'payment.refunded', ref: 'pi_1', amountKr: 2500 });
  });

  it('charge.refunded PARTIAL (amount_refunded < amount) → payment.partially_refunded', () => {
    const r = mapStripeEvent({
      id: 'evt_p', type: 'charge.refunded',
      data: { object: { id: 'ch_2', payment_intent: 'pi_2', amount: 250000, amount_refunded: 50000 } },
    });
    expect(r).toMatchObject({ type: 'payment.partially_refunded', ref: 'pi_2', amountKr: 500 });
  });

  it('charge.refunded uten total (amount mangler) → konservativ full refunded', () => {
    const r = mapStripeEvent({
      id: 'evt_u', type: 'charge.refunded',
      data: { object: { id: 'ch_3', payment_intent: 'pi_3', amount_refunded: 50000 } },
    });
    expect(r?.type).toBe('payment.refunded');
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

  it('Vipps PARTIAL refund (refundert < opprinnelig) → partially_refunded', () => {
    const r = mapVippsEvent({ reference: 'reg-1-ab', name: 'REFUNDED', amount: { value: 50000 }, transactionInfo: { refundedAmount: 50000, amount: 250000 } });
    expect(r?.type).toBe('payment.partially_refunded');
  });

  it('Vipps REFUNDED uten total → konservativ full refunded', () => {
    const r = mapVippsEvent({ reference: 'reg-2-cd', name: 'REFUNDED', amount: { value: 250000 } });
    expect(r?.type).toBe('payment.refunded');
  });
});
