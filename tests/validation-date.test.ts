import { describe, it, expect } from 'vitest';
import { isRealIsoDate, preferredDateError, todayIsoDate } from '@/lib/validation/date';

// 2026-09-30 23:30 UTC = 1. oktober 01:30 i Oslo.
const LATE_EVENING_UTC = new Date('2026-09-30T23:30:00Z');

describe('todayIsoDate', () => {
  it('bruker norsk tid', () => {
    expect(todayIsoDate(LATE_EVENING_UTC)).toBe('2026-10-01');
    expect(todayIsoDate(new Date('2026-06-15T10:00:00Z'))).toBe('2026-06-15');
  });
});

describe('isRealIsoDate', () => {
  it('godtar ekte datoer og avviser tull', () => {
    expect(isRealIsoDate('2028-02-29')).toBe(true);
    expect(isRealIsoDate('2027-02-29')).toBe(false);
    expect(isRealIsoDate('2026-13-01')).toBe(false);
    expect(isRealIsoDate('01.10.2026')).toBe(false);
    expect(isRealIsoDate('2026-10-01T00:00')).toBe(false);
  });
});

describe('preferredDateError', () => {
  const now = new Date('2026-06-15T10:00:00Z');

  it('tom dato er ok', () => {
    expect(preferredDateError(null, now)).toBeNull();
    expect(preferredDateError('', now)).toBeNull();
  });

  it('i dag og fremtid er ok', () => {
    expect(preferredDateError('2026-06-15', now)).toBeNull();
    expect(preferredDateError('2027-01-01', now)).toBeNull();
  });

  it('avviser fortid og ugyldig format', () => {
    expect(preferredDateError('2026-06-14', now)).toBe('Ønsket dato kan ikke være tilbake i tid');
    expect(preferredDateError('i morgen', now)).toBe('Ugyldig dato');
  });
});
