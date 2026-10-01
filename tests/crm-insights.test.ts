import { describe, it, expect } from 'vitest';
import {
  computeRates, isoWeekStart, weekStarts, bucketCountsByWeek,
  monthKey, monthKeys, bucketSumByMonth, wonChartMessage,
  aggregateFlowSends, dayMonthShort, dayMonthLong, monthLabel, type FlowSendRow,
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

describe('wonChartMessage', () => {
  const empty = [{ value: 0, count: 0 }, { value: 0, count: 0 }];
  it('explains an empty chart when wins exist outside the window', () => {
    expect(wonChartMessage(empty, 1)).toBe('Ingen vunne avtaler de siste 6 månedene (1 vunnet tidligere).');
    expect(wonChartMessage(empty, 0)).toBe('Ingen vunne avtaler ennå. Når du flytter en avtale til «Vunnet» på salgstavlen, dukker den opp her.');
  });
  it('does not claim there are no wins when the wins have no value', () => {
    expect(wonChartMessage([{ value: 0, count: 1 }], 1)).toBe('1 vunnet avtale de siste 6 månedene, men uten beløp. Fyll inn «Verdi» på avtalene for å se grafen.');
  });
  it('returns null so the chart is shown when there is won value', () => {
    expect(wonChartMessage([{ value: 1234, count: 1 }], 1)).toBeNull();
  });
});

const send = (enrollmentId: number | null, status = 'sent', opened = false): FlowSendRow => ({
  enrollmentId, status,
  openedAt: opened ? new Date() : null, firstClickedAt: null, repliedAt: null, bouncedAt: null,
});

describe('aggregateFlowSends', () => {
  it('teller alle sendte flyt-e-poster, også fra slettede flyter, men ikke tester', () => {
    const map = new Map([[1, 10], [2, 10], [3, 20]]);
    const { perFlow, totals } = aggregateFlowSends([
      send(1, 'sent', true), send(2), send(3), send(99), // 99: løp i slettet flyt
      send(null, 'test'), send(1, 'skipped_no_consent'), send(2, 'skipped_suppressed'), send(3, 'failed'),
    ], map);
    expect(perFlow.get(10)).toEqual({ sent: 2, opened: 1, clicked: 0, replied: 0, bounced: 0 });
    expect(perFlow.get(20)?.sent).toBe(1);
    expect(totals.sent).toBe(4);
    expect(totals.opened).toBe(1);
    expect(totals.deletedFlows.sent).toBe(1);
    expect(totals.skippedNoConsent).toBe(1);
    expect(totals.skippedSuppressed).toBe(1);
  });
});

describe('norske datoetiketter', () => {
  it('dd.mm og «13. juli»', () => {
    expect(dayMonthShort('2026-07-13')).toBe('13.07');
    expect(dayMonthLong('2026-07-03')).toBe('3. juli');
  });
  it('måneder', () => {
    expect(monthLabel('2026-08')).toBe('august 2026');
    expect(monthLabel('2026-08', true)).toBe('aug. 26');
    expect(monthLabel('rart')).toBe('rart');
  });
});
