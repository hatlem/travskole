import { describe, it, expect } from 'vitest';
import { bookingOwnershipWhere } from '@/lib/bookings/ownership';

describe('bookingOwnershipWhere', () => {
  it('e-post (case-insensitiv) + userId', () => {
    expect(bookingOwnershipWhere('k@x.no', 7)).toEqual({
      OR: [{ email: { equals: 'k@x.no', mode: 'insensitive' } }, { userId: 7 }],
    });
  });
  it('kun e-post når userId null', () => {
    expect(bookingOwnershipWhere('k@x.no', null)).toEqual({
      OR: [{ email: { equals: 'k@x.no', mode: 'insensitive' } }],
    });
  });
});
