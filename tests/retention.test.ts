import { describe, it, expect } from 'vitest';
import { shouldAnonymizeChild, type ChildForRetention } from '@/lib/retention';

// Fixed "now" so the cutoff is deterministic. With retentionDays = 365 the
// cutoff is exactly one year earlier (2025-06-16T12:00:00Z). A course end is
// "old enough" only when it is strictly BEFORE that cutoff.
const NOW = new Date('2026-06-16T12:00:00Z');
const RETENTION_DAYS = 365;
const CUTOFF = new Date('2025-06-16T12:00:00Z'); // NOW - 365 days

function reg(
  endDate: Date | null,
  startDate: Date | null = null,
): ChildForRetention['registrations'][number] {
  return { course: { startDate, endDate } };
}

describe('shouldAnonymizeChild', () => {
  it('anonymizes when every course ended strictly before the cutoff', () => {
    const child: ChildForRetention = {
      deletedAt: null,
      registrations: [
        reg(new Date('2024-01-01T00:00:00Z')),
        reg(new Date('2025-01-01T00:00:00Z')),
      ],
    };
    expect(shouldAnonymizeChild(child, NOW, RETENTION_DAYS)).toBe(true);
  });

  it('does NOT anonymize when one course is recent (ended after cutoff)', () => {
    const child: ChildForRetention = {
      deletedAt: null,
      registrations: [
        reg(new Date('2024-01-01T00:00:00Z')), // old
        reg(new Date('2026-05-01T00:00:00Z')), // recent
      ],
    };
    expect(shouldAnonymizeChild(child, NOW, RETENTION_DAYS)).toBe(false);
  });

  it('falls back to startDate when endDate is null', () => {
    const child: ChildForRetention = {
      deletedAt: null,
      // No endDate, but startDate is old -> eligible
      registrations: [reg(null, new Date('2024-01-01T00:00:00Z'))],
    };
    expect(shouldAnonymizeChild(child, NOW, RETENTION_DAYS)).toBe(true);
  });

  it('does NOT anonymize when a course has no dates at all (request-style)', () => {
    const child: ChildForRetention = {
      deletedAt: null,
      registrations: [
        reg(new Date('2024-01-01T00:00:00Z')), // old, fine
        reg(null, null), // request-style: no start, no end -> blocks anonymization
      ],
    };
    expect(shouldAnonymizeChild(child, NOW, RETENTION_DAYS)).toBe(false);
  });

  it('does NOT anonymize a child with no registrations', () => {
    const child: ChildForRetention = {
      deletedAt: null,
      registrations: [],
    };
    expect(shouldAnonymizeChild(child, NOW, RETENTION_DAYS)).toBe(false);
  });

  it('does NOT anonymize an already-anonymized child (deletedAt set)', () => {
    const child: ChildForRetention = {
      deletedAt: new Date('2025-01-01T00:00:00Z'),
      registrations: [reg(new Date('2024-01-01T00:00:00Z'))],
    };
    expect(shouldAnonymizeChild(child, NOW, RETENTION_DAYS)).toBe(false);
  });

  it('does NOT anonymize when a course ends exactly at the cutoff (not strictly older)', () => {
    const child: ChildForRetention = {
      deletedAt: null,
      registrations: [reg(new Date(CUTOFF))],
    };
    expect(shouldAnonymizeChild(child, NOW, RETENTION_DAYS)).toBe(false);
  });

  it('anonymizes when a course ends one millisecond before the cutoff', () => {
    const child: ChildForRetention = {
      deletedAt: null,
      registrations: [reg(new Date(CUTOFF.getTime() - 1))],
    };
    expect(shouldAnonymizeChild(child, NOW, RETENTION_DAYS)).toBe(true);
  });
});
