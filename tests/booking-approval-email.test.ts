import { describe, it, expect } from 'vitest';
import { decideBookingApprovalEmail, BOOKING_CHECKOUT_TOKEN_TTL_MS } from '@/lib/bookings/approval-email';

const base = { prevStatus: 'new', newStatus: 'confirmed', paymentMethods: ['stripe', 'faktura'], amountKr: 500, paymentStatus: 'none' };

describe('decideBookingApprovalEmail', () => {
  it('overgang inn i confirmed + online + beløp + ubetalt → pay', () => {
    expect(decideBookingApprovalEmail(base)).toBe('pay');
    expect(decideBookingApprovalEmail({ ...base, paymentMethods: ['vipps'] })).toBe('pay');
  });
  it('kun faktura → plain', () => {
    expect(decideBookingApprovalEmail({ ...base, paymentMethods: ['faktura'] })).toBe('plain');
  });
  it('ikke overgang inn i confirmed → none', () => {
    expect(decideBookingApprovalEmail({ ...base, prevStatus: 'confirmed' })).toBe('none');
    expect(decideBookingApprovalEmail({ ...base, newStatus: 'cancelled' })).toBe('none');
    expect(decideBookingApprovalEmail({ ...base, newStatus: 'new' })).toBe('none');
  });
  it('manglende/0 beløp → plain', () => {
    expect(decideBookingApprovalEmail({ ...base, amountKr: null })).toBe('plain');
    expect(decideBookingApprovalEmail({ ...base, amountKr: 0 })).toBe('plain');
  });
  it('allerede betalt/refundert → plain (ingen betal-lenke)', () => {
    expect(decideBookingApprovalEmail({ ...base, paymentStatus: 'paid' })).toBe('plain');
  });
  it('TTL er 14 dager', () => {
    expect(BOOKING_CHECKOUT_TOKEN_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});
