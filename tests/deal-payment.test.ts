import { describe, it, expect } from 'vitest';
import { resolveDealPayment } from '@/lib/crm/deal-payment';

describe('resolveDealPayment', () => {
  const bookingMap = new Map([
    [1, { paymentStatus: 'paid', paymentProvider: 'stripe' }],
    [2, { paymentStatus: 'none', paymentProvider: null }],
  ]);
  const registrationMap = new Map([
    [10, { paymentStatus: 'pending', paymentProvider: 'vipps' }],
  ]);

  it('deal linked via bookingRequestId resolves from bookingMap', () => {
    const deal = { bookingRequestId: 1, registrationId: null };
    expect(resolveDealPayment(deal, bookingMap, registrationMap)).toEqual({
      paymentStatus: 'paid',
      paymentProvider: 'stripe',
    });
  });

  it('deal linked via registrationId (no bookingRequestId) resolves from registrationMap', () => {
    const deal = { bookingRequestId: null, registrationId: 10 };
    expect(resolveDealPayment(deal, bookingMap, registrationMap)).toEqual({
      paymentStatus: 'pending',
      paymentProvider: 'vipps',
    });
  });

  it('deal with both ids set: bookingRequestId takes precedence', () => {
    const deal = { bookingRequestId: 1, registrationId: 10 };
    expect(resolveDealPayment(deal, bookingMap, registrationMap)).toEqual({
      paymentStatus: 'paid',
      paymentProvider: 'stripe',
    });
  });

  it('manual deal (both ids null) returns nulls', () => {
    const deal = { bookingRequestId: null, registrationId: null };
    expect(resolveDealPayment(deal, bookingMap, registrationMap)).toEqual({
      paymentStatus: null,
      paymentProvider: null,
    });
  });

  it('dangling id not present in map returns nulls (defensive)', () => {
    const deal = { bookingRequestId: 999, registrationId: null };
    expect(resolveDealPayment(deal, bookingMap, registrationMap)).toEqual({
      paymentStatus: null,
      paymentProvider: null,
    });
  });

  it('passes through raw paymentStatus "none" without collapsing (badge helper handles that, not this function)', () => {
    const deal = { bookingRequestId: 2, registrationId: null };
    expect(resolveDealPayment(deal, bookingMap, registrationMap)).toEqual({
      paymentStatus: 'none',
      paymentProvider: null,
    });
  });
});
