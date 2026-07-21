import { describe, it, expect } from 'vitest';
import { paymentStatusBadge } from '@/lib/payments/badge';

describe('paymentStatusBadge', () => {
  it('kjente statuser', () => {
    expect(paymentStatusBadge('paid')?.label).toBe('Betalt');
    expect(paymentStatusBadge('pending')?.label).toBe('Venter');
    expect(paymentStatusBadge('failed')?.label).toBe('Feilet');
    expect(paymentStatusBadge('refunded')?.label).toBe('Refundert');
    expect(paymentStatusBadge('expired')?.label).toBe('Utløpt');
    expect(paymentStatusBadge('partially_refunded')?.label).toBe('Delvis refundert');
  });
  it('ukjent/tom → null', () => {
    expect(paymentStatusBadge('none')).toBe(null);
    expect(paymentStatusBadge(undefined)).toBe(null);
    expect(paymentStatusBadge('rart')).toBe(null);
  });
});
