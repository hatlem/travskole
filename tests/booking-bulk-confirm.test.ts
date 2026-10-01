import { describe, it, expect } from 'vitest';
import { bulkConfirmBody, isoDay, sharedPreferredDay } from '@/lib/bookings/bulk-confirm';

describe('isoDay', () => {
  it('reads the stored UTC day, and empty for missing or bad values', () => {
    expect(isoDay('2026-11-14T00:00:00.000Z')).toBe('2026-11-14');
    expect(isoDay(null)).toBe('');
    expect(isoDay('tull')).toBe('');
  });
});

describe('sharedPreferredDay', () => {
  it('returns the day when every selected booking wants the same one', () => {
    expect(sharedPreferredDay(['2026-11-14T00:00:00.000Z', '2026-11-14T00:00:00.000Z'])).toBe('2026-11-14');
  });

  it('returns null for different, missing or no dates', () => {
    expect(sharedPreferredDay(['2026-11-14T00:00:00.000Z', '2026-11-15T00:00:00.000Z'])).toBeNull();
    expect(sharedPreferredDay(['2026-11-14T00:00:00.000Z', null])).toBeNull();
    expect(sharedPreferredDay([null, null])).toBeNull();
    expect(sharedPreferredDay([])).toBeNull();
  });
});

describe('bulkConfirmBody', () => {
  it('confirms without agreed time or personal note by default', () => {
    expect(bulkConfirmBody(null)).toEqual({ mode: 'confirm', date: '', time: '', note: '' });
  });

  it('passes a shared agreed time through', () => {
    expect(bulkConfirmBody({ date: '2026-11-14', time: '12:00' })).toEqual({ mode: 'confirm', date: '2026-11-14', time: '12:00', note: '' });
  });
});
