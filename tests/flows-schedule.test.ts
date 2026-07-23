import { describe, it, expect } from 'vitest';
import { computeAnchorDay, osloDayStartUtc, osloDay } from '@/lib/flows/schedule';

const d = (iso: string) => new Date(iso);

describe('computeAnchorDay', () => {
  const start = d('2026-06-01T10:00:00Z'); // Oslo-dag 2026-06-01
  const end = d('2026-06-11T10:00:00Z');   // Oslo-dag 2026-06-11
  it('course_start + offset (reminder_before/welcome_start)', () => {
    expect(computeAnchorDay('course_start', -3, start, end)).toBe('2026-05-29');
    expect(computeAnchorDay('course_start', 0, start, end)).toBe('2026-06-01');
  });
  it('course_end + offset (after_end)', () => {
    expect(computeAnchorDay('course_end', 1, start, end)).toBe('2026-06-12');
  });
  it('course_midway = halvveis start→slutt', () => {
    expect(computeAnchorDay('course_midway', 0, start, end)).toBe('2026-06-06'); // 10 dager / 2 = 5
  });
  it('manglende dato → null', () => {
    expect(computeAnchorDay('course_start', 0, null, end)).toBeNull();
    expect(computeAnchorDay('course_end', 0, start, null)).toBeNull();
    expect(computeAnchorDay('course_midway', 0, start, null)).toBeNull();
  });
});

describe('osloDay / osloDayStartUtc', () => {
  it('osloDay gir Oslo-kalenderdag', () => {
    // 2026-01-01T23:30Z er 2026-01-02 00:30 i Oslo (vinter, UTC+1)
    expect(osloDay(d('2026-01-01T23:30:00Z'))).toBe('2026-01-02');
  });
  it('osloDayStartUtc: vinter 00:00 Oslo = 23:00Z dagen før (UTC+1)', () => {
    expect(osloDayStartUtc('2026-01-15').toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });
  it('osloDayStartUtc: sommer 00:00 Oslo = 22:00Z dagen før (UTC+2, DST)', () => {
    expect(osloDayStartUtc('2026-07-15').toISOString()).toBe('2026-07-14T22:00:00.000Z');
  });
});
