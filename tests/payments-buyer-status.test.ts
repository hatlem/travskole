import { describe, it, expect } from 'vitest';
import { buyerPaymentBadge, isUnpaidStatus, paymentStatusBadge } from '@/lib/payments/badge';
import { paidThankYouMessage, subjectStatusText } from '@/lib/payments/thank-you';
import { mapVippsEvent } from '@/lib/payments/mapping';

describe('buyerPaymentBadge', () => {
  it('shows paid/refunded/failed as-is', () => {
    expect(buyerPaymentBadge('paid', true)?.label).toBe('Betalt');
    expect(buyerPaymentBadge('refunded', true)?.label).toBe('Refundert');
    expect(buyerPaymentBadge('failed', true)?.label).toBe('Feilet');
  });

  it('collapses unpaid states to «Venter på betaling» when payment is required', () => {
    for (const status of ['none', 'pending', 'expired', 'cancelled']) {
      expect(buyerPaymentBadge(status, true)?.label).toBe('Venter på betaling');
    }
  });

  it('shows no badge for unpaid rows without online payment (faktura)', () => {
    expect(buyerPaymentBadge('none', false)).toBe(null);
  });
});

describe('isUnpaidStatus', () => {
  it('only unsettled statuses allow «Betal nå»', () => {
    expect(isUnpaidStatus('none')).toBe(true);
    expect(isUnpaidStatus('cancelled')).toBe(true);
    expect(isUnpaidStatus('paid')).toBe(false);
    expect(isUnpaidStatus('refunded')).toBe(false);
    expect(isUnpaidStatus('partially_refunded')).toBe(false);
  });
});

describe('user-cancelled Vipps payment', () => {
  it('ABORTED is flagged as user-cancelled and labelled «Avbrutt»', () => {
    expect(mapVippsEvent({ reference: 'r1', name: 'ABORTED' })).toMatchObject({ type: 'payment.failed', userCancelled: true });
    expect(mapVippsEvent({ reference: 'r1', name: 'FAILED' })?.userCancelled).toBeUndefined();
    expect(paymentStatusBadge('cancelled')?.label).toBe('Avbrutt');
  });
});

describe('paidThankYouMessage', () => {
  it('never claims a pending registration is confirmed', () => {
    const text = paidThankYouMessage({ kind: 'registration', status: 'pending' });
    expect(text).toContain('Betalingen er mottatt – du får kvittering på e-post.');
    expect(text).toContain('Påmeldingen din er registrert');
    expect(text).not.toContain('bekreftet');
  });

  it('says confirmed only when it is', () => {
    expect(paidThankYouMessage({ kind: 'registration', status: 'confirmed' })).toContain('Påmeldingen din er bekreftet.');
    expect(subjectStatusText({ kind: 'booking', status: 'confirmed' })).toBe('Bookingen din er bekreftet.');
    expect(subjectStatusText({ kind: 'booking', status: 'new' })).toContain('registrert');
  });

  it('falls back to the receipt note when the row is unknown', () => {
    expect(paidThankYouMessage(null)).toBe('Betalingen er mottatt – du får kvittering på e-post.');
  });
});
