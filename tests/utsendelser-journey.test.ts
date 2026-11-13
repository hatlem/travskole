/** Løpet per person: sendt, når resten kommer, og hvorfor det stoppet. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn() }));

import { journeyFor } from '@/lib/utsendelser/one-by-one';

const steps = [
  { nodeId: 1, hoursAfterPrevious: 0 },
  { nodeId: 2, hoursAfterPrevious: 7 * 24 },
  { nodeId: 3, hoursAfterPrevious: 11 * 24 },
];
const d = (s: string) => new Date(s);
const sent = (entries: [number, string, Partial<{ openedAt: Date; repliedAt: Date }>?][]) =>
  new Map(entries.map(([id, at, extra]) => [id, { sentAt: d(at), openedAt: extra?.openedAt ?? null, repliedAt: extra?.repliedAt ?? null }]));
const enrollment = (over: Partial<{ status: string; nextRunAt: Date; finishedAt: Date | null; failReason: string | null }> = {}) => ({
  status: 'active', nextRunAt: d('2026-11-20T08:00:00Z'), finishedAt: null, failReason: null, ...over,
});

describe('journeyFor', () => {
  it('ikke meldt inn: ikke startet, ingen datoer', () => {
    const { journey, expected } = journeyFor(steps, null, new Map());
    expect(journey).toEqual({ state: 'ikke-startet', at: null });
    expect(expected.size).toBe(0);
  });

  it('i gang: neste e-post ved nextRunAt, den etter ventetiden senere', () => {
    const { journey, expected } = journeyFor(steps, enrollment(), sent([[1, '2026-11-13T11:05:00Z']]));
    expect(journey.state).toBe('pagar');
    expect(expected.get(1)).toBeUndefined();
    expect(expected.get(2)).toBe('2026-11-20T08:00:00.000Z');
    expect(expected.get(3)).toBe('2026-12-01T08:00:00.000Z');
  });

  it('svarte: ingen flere datoer, og datoen for svaret', () => {
    const { journey, expected } = journeyFor(
      steps,
      enrollment({ status: 'exited', finishedAt: d('2026-11-14T09:00:00Z') }),
      sent([[1, '2026-11-13T11:05:00Z', { repliedAt: d('2026-11-14T08:59:00Z') }]]),
    );
    expect(journey).toEqual({ state: 'svarte', at: '2026-11-14T08:59:00.000Z' });
    expect(expected.size).toBe(0);
  });

  it('meldt av, stoppet, ferdig og feilet', () => {
    const fin = d('2026-11-15T10:00:00Z');
    expect(journeyFor(steps, enrollment({ status: 'exited', failReason: 'suppressed', finishedAt: fin }), new Map()).journey.state).toBe('meldt-av');
    expect(journeyFor(steps, enrollment({ status: 'exited', failReason: 'no_consent', finishedAt: fin }), new Map()).journey.state).toBe('meldt-av');
    expect(journeyFor(steps, enrollment({ status: 'exited', finishedAt: fin }), new Map()).journey).toEqual({ state: 'stoppet', at: fin.toISOString() });
    expect(journeyFor(steps, enrollment({ status: 'completed', finishedAt: fin }), new Map()).journey.state).toBe('ferdig');
    expect(journeyFor(steps, enrollment({ status: 'failed', finishedAt: fin }), new Map()).journey.state).toBe('feilet');
  });
});
