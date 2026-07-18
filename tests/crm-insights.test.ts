import { describe, it, expect } from 'vitest';
import {
  computeRates, isoWeekStart, weekStarts, bucketCountsByWeek,
  monthKey, monthKeys, bucketSumByMonth,
} from '@/lib/crm/insights';

const NOW = new Date('2026-07-18T12:00:00Z'); // lørdag; ISO-uke starter mandag 2026-07-13

describe('computeRates', () => {
  it('prosent med én desimal', () => {
    expect(computeRates(200, 47, 12)).toEqual({ openRate: 23.5, clickRate: 6 });
  });
  it('0 sends gir 0-rater, aldri NaN', () => {
    expect(computeRates(0, 0, 0)).toEqual({ openRate: 0, clickRate: 0 });
  });
});

describe('isoWeekStart', () => {
  it('lørdag → mandagen samme uke', () => {
    expect(isoWeekStart(new Date('2026-07-18T12:00:00Z'))).toBe('2026-07-13');
  });
  it('mandag → seg selv', () => {
    expect(isoWeekStart(new Date('2026-07-13T00:00:00Z'))).toBe('2026-07-13');
  });
  it('søndag → mandagen FØR (ikke etter)', () => {
    expect(isoWeekStart(new Date('2026-07-19T23:00:00Z'))).toBe('2026-07-13');
  });
});

describe('weekStarts', () => {
  it('3 uker, eldste først, inkl. inneværende', () => {
    expect(weekStarts(3, NOW)).toEqual(['2026-06-29', '2026-07-06', '2026-07-13']);
  });
});

describe('bucketCountsByWeek', () => {
  it('teller per uke og fyller tomme uker med 0', () => {
    const dates = [
      new Date('2026-07-01T10:00:00Z'), // uke 2026-06-29
      new Date('2026-07-02T10:00:00Z'), // uke 2026-06-29
      new Date('2026-07-14T10:00:00Z'), // uke 2026-07-13
    ];
    expect(bucketCountsByWeek(dates, 3, NOW)).toEqual([
      { weekStart: '2026-06-29', count: 2 },
      { weekStart: '2026-07-06', count: 0 },
      { weekStart: '2026-07-13', count: 1 },
    ]);
  });
  it('datoer utenfor vinduet ignoreres', () => {
    const dates = [new Date('2026-01-01T00:00:00Z')];
    expect(bucketCountsByWeek(dates, 2, NOW)).toEqual([
      { weekStart: '2026-07-06', count: 0 },
      { weekStart: '2026-07-13', count: 0 },
    ]);
  });
  it('tom input gir bare 0-bøtter', () => {
    expect(bucketCountsByWeek([], 1, NOW)).toEqual([{ weekStart: '2026-07-13', count: 0 }]);
  });
});

describe('monthKey / monthKeys', () => {
  it('UTC-månedsnøkkel', () => {
    expect(monthKey(new Date('2026-07-18T12:00:00Z'))).toBe('2026-07');
  });
  it('3 måneder over årsskifte', () => {
    expect(monthKeys(3, new Date('2026-01-15T00:00:00Z'))).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('bucketSumByMonth', () => {
  it('summerer verdi og teller per måned, fyller tomme', () => {
    const rows = [
      { at: new Date('2026-06-05T00:00:00Z'), value: 1000 },
      { at: new Date('2026-06-20T00:00:00Z'), value: 500 },
      { at: new Date('2026-07-01T00:00:00Z'), value: 200 },
    ];
    expect(bucketSumByMonth(rows, 3, NOW)).toEqual([
      { month: '2026-05', sum: 0, count: 0 },
      { month: '2026-06', sum: 1500, count: 2 },
      { month: '2026-07', sum: 200, count: 1 },
    ]);
  });
});
