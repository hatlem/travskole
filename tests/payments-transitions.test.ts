import { describe, it, expect } from 'vitest';
import { STATUS_RANK, planStatusTransition, type PaymentStatus } from '@/lib/payments/transitions';

const STATUSES = Object.keys(STATUS_RANK) as PaymentStatus[];

describe('planStatusTransition — full rank matrix', () => {
  for (const current of STATUSES) {
    for (const next of STATUSES) {
      const currentRank = STATUS_RANK[current];
      const nextRank = STATUS_RANK[next];
      const expected = {
        write: nextRank > currentRank,
        downgrade: nextRank < currentRank,
      };
      it(`${current} (${currentRank}) → ${next} (${nextRank}): write=${expected.write}, downgrade=${expected.downgrade}`, () => {
        expect(planStatusTransition(current, next)).toEqual(expected);
      });
    }
  }
});

describe('planStatusTransition — unknown current (defensive, treated as rank 0)', () => {
  it('unknown current → pending: writes (rank 0 → 1)', () => {
    expect(planStatusTransition('bogus', 'pending')).toEqual({ write: true, downgrade: false });
  });

  it('unknown current → none: no-op, not a downgrade (rank 0 → 0)', () => {
    expect(planStatusTransition('bogus', 'none')).toEqual({ write: false, downgrade: false });
  });
});

describe('planStatusTransition — named scenarios', () => {
  it('refunded → paid is blocked as a downgrade', () => {
    expect(planStatusTransition('refunded', 'paid')).toEqual({ write: false, downgrade: true });
  });

  it('paid → failed is blocked', () => {
    expect(planStatusTransition('paid', 'failed')).toEqual({ write: false, downgrade: true });
  });

  it('pending → paid writes', () => {
    expect(planStatusTransition('pending', 'paid')).toEqual({ write: true, downgrade: false });
  });

  it('failed → paid writes', () => {
    expect(planStatusTransition('failed', 'paid')).toEqual({ write: true, downgrade: false });
  });

  it('paid → refunded writes', () => {
    expect(planStatusTransition('paid', 'refunded')).toEqual({ write: true, downgrade: false });
  });

  it('paid → paid is a no-op, not a downgrade', () => {
    expect(planStatusTransition('paid', 'paid')).toEqual({ write: false, downgrade: false });
  });
});
