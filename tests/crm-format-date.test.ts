import { describe, expect, it } from 'vitest';
import { formatDateNo, formatDateTimeNo, formatDayMonthNo } from '@/lib/crm/format-date';

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
