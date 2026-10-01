import { describe, expect, it } from 'vitest';
import { formatDateLong, formatDateNo, formatDateShort, formatDateTimeNo, formatDayMonthNo } from '@/lib/admin-format';

describe('formatDateNo', () => {
  it('formats as dd.mm.yyyy in Norwegian time', () => {
    expect(formatDateNo('2026-07-13T10:00:00Z')).toBe('13.07.2026');
    expect(formatDateNo('2026-07-12T22:30:00Z')).toBe('13.07.2026');
  });
  it('falls back for missing or invalid dates', () => {
    expect(formatDateNo(null)).toBe('—');
    expect(formatDateNo('ikke en dato', '')).toBe('');
  });
});

describe('formatDayMonthNo', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  it('omits the year within the current year', () => {
    expect(formatDayMonthNo('2026-07-13T10:00:00Z', now)).toBe('13. juli');
  });
  it('includes the year for other years', () => {
    expect(formatDayMonthNo('2025-07-13T10:00:00Z', now)).toBe('13. juli 2025');
  });
});

describe('formatDateTimeNo', () => {
  it('adds the clock time', () => {
    expect(formatDateTimeNo('2026-07-13T12:05:00Z')).toBe('13.07.2026 kl. 14:05');
  });
});

describe('formatDateLong / formatDateShort', () => {
  it('formats course dates in Norwegian, Oslo time', () => {
    expect(formatDateLong('2026-11-14T00:00:00Z')).toBe('14. november 2026');
    expect(formatDateShort('2026-11-14T00:00:00Z')).toBe('14. nov. 2026');
  });

  it('uses the empty fallback for missing dates', () => {
    expect(formatDateLong(null)).toBe('—');
    expect(formatDateShort(undefined, '')).toBe('');
  });
});
