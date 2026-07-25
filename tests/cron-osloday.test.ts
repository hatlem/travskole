import { describe, it, expect } from 'vitest';
import { osloDay } from '@/app/api/cron/email-triggers/route';

describe('osloDay', () => {
  it('returns the Oslo calendar day as YYYY-MM-DD', () => {
    // 2026-06-15T10:00:00Z -> 12:00 in Oslo (CEST, +02:00) -> same day
    expect(osloDay(new Date('2026-06-15T10:00:00Z'))).toBe('2026-06-15');
  });

  it('rolls over to the next Oslo day for late-UTC instants', () => {
    // 2026-06-15T23:30:00Z -> 01:30 next day in Oslo (CEST, +02:00)
    expect(osloDay(new Date('2026-06-15T23:30:00Z'))).toBe('2026-06-16');
  });

  it('handles winter (CET, +01:00) offset', () => {
    // 2026-01-15T23:30:00Z -> 00:30 next day in Oslo (CET, +01:00)
    expect(osloDay(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
  });

  it('produces lexicographically comparable strings matching chronology', () => {
    const a = osloDay(new Date('2026-06-14T22:00:00Z')); // 2026-06-15 Oslo
    const b = osloDay(new Date('2026-06-15T22:00:00Z')); // 2026-06-16 Oslo
    expect(a < b).toBe(true);
  });
});
