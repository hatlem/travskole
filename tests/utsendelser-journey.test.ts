/** Løpet per person: sendt, når resten kommer, og hvorfor det stoppet. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn() }));

import { journeyFor, nextEmailNode } from '@/lib/utsendelser/one-by-one';

const steps = [
  { nodeId: 1, hoursAfterPrevious: 0 },
  { nodeId: 2, hoursAfterPrevious: 7 * 24 },
  { nodeId: 3, hoursAfterPrevious: 11 * 24 },
];
const d = (s: string) => new Date(s);
const NOW = d('2026-11-13T12:00:00Z');
const opts = (nextNodeId: number | null, paused = false) => ({ nextNodeId, paused, now: NOW });
const sent = (entries: [number, string, Partial<{ openedAt: Date; repliedAt: Date }>?][]) =>
  new Map(entries.map(([id, at, extra]) => [id, { sentAt: d(at), openedAt: extra?.openedAt ?? null, repliedAt: extra?.repliedAt ?? null }]));
const enrollment = (over: Partial<{ status: string; nextRunAt: Date; finishedAt: Date | null; failReason: string | null }> = {}) => ({
  status: 'active', nextRunAt: d('2026-11-20T08:00:00Z'), finishedAt: null, failReason: null, ...over,
});

describe('nextEmailNode', () => {
  const nodes = [{ id: 10, type: 'start' }, { id: 1, type: 'email' }, { id: 11, type: 'wait' }, { id: 2, type: 'email' }, { id: 12, type: 'condition' }];
  const edges = [[10, 1], [1, 11], [11, 2], [2, 12], [12, 1], [12, 2]].map(([fromNodeId, toNodeId]) => ({ fromNodeId, toNodeId }));
  it('fra start, fra en ventenode, og stopper ved forgrening', () => {
    expect(nextEmailNode(nodes, edges, null)).toBe(1);
    expect(nextEmailNode(nodes, edges, 11)).toBe(2);
    expect(nextEmailNode(nodes, edges, 12)).toBeNull();
  });
});

describe('journeyFor', () => {
  it('ikke meldt inn: ikke startet, ingen datoer', () => {
    const { journey, expected } = journeyFor(steps, null, new Map(), opts(null));
    expect(journey.state).toBe('ikke-startet');
    expect(expected.size).toBe(0);
  });

  it('i gang: neste e-post ved nextRunAt, den etter ventetiden senere', () => {
    const { journey, expected, skipped } = journeyFor(steps, enrollment(), sent([[1, '2026-11-13T11:05:00Z']]), opts(2));
    expect(journey.state).toBe('pagar');
    expect(expected.get(2)).toBe('2026-11-20T08:00:00.000Z');
    expect(expected.get(3)).toBe('2026-12-01T08:00:00.000Z');
    expect(skipped.size).toBe(0);
  });

  it('forfalt nextRunAt vises aldri som en dato bakover i tid', () => {
    const { expected } = journeyFor(steps, enrollment({ nextRunAt: d('2026-11-01T08:00:00Z') }), new Map(), opts(1));
    expect(expected.get(1)).toBe(NOW.toISOString());
  });

  it('hoppet over (ikke sendt, men forbi): «sendes ikke», og datoene forskyves ikke', () => {
    const { expected, skipped } = journeyFor(steps, enrollment(), new Map(), opts(2));
    expect(skipped.has(1)).toBe(true);
    expect(expected.get(1)).toBeUndefined();
    expect(expected.get(2)).toBe('2026-11-20T08:00:00.000Z');
  });

  it('pause: ingen datoer', () => {
    const { journey, expected } = journeyFor(steps, enrollment(), sent([[1, '2026-11-13T11:05:00Z']]), opts(2, true));
    expect(journey.state).toBe('pause');
    expect(expected.size).toBe(0);
  });

  it('forgrening: ingen gjetning for e-poster uten kjent ventetid', () => {
    const branched = [steps[0], { nodeId: 2, hoursAfterPrevious: null }, { nodeId: 3, hoursAfterPrevious: null }];
    const { expected, skipped } = journeyFor(branched, enrollment(), sent([[1, '2026-11-13T11:05:00Z']]), opts(null));
    expect(expected.size).toBe(0);
    expect(skipped.size).toBe(0);
  });

  it('svarte: datoen for svaret', () => {
    const { journey } = journeyFor(
      steps,
      enrollment({ status: 'exited', finishedAt: d('2026-11-14T09:00:00Z') }),
      sent([[1, '2026-11-13T11:05:00Z', { repliedAt: d('2026-11-14T08:59:00Z') }]]),
      opts(null),
    );
    expect(journey).toEqual({ state: 'svarte', at: '2026-11-14T08:59:00.000Z', reason: null });
  });

  it('feil og avmelding vinner over et tidligere svar', () => {
    const replied = sent([[1, '2026-11-13T11:05:00Z', { repliedAt: d('2026-11-14T08:59:00Z') }]]);
    expect(journeyFor(steps, enrollment({ status: 'failed', failReason: 'send-failed' }), replied, opts(null)).journey).toMatchObject({ state: 'feilet', reason: 'send-failed' });
    expect(journeyFor(steps, enrollment({ status: 'exited', failReason: 'suppressed' }), replied, opts(null)).journey.state).toBe('meldt-av');
  });

  it('meldt av, stoppet og ferdig', () => {
    const fin = d('2026-11-15T10:00:00Z');
    expect(journeyFor(steps, enrollment({ status: 'exited', failReason: 'no_consent', finishedAt: fin }), new Map(), opts(null)).journey.state).toBe('meldt-av');
    expect(journeyFor(steps, enrollment({ status: 'exited', finishedAt: fin }), new Map(), opts(null)).journey).toEqual({ state: 'stoppet', at: fin.toISOString(), reason: null });
    expect(journeyFor(steps, enrollment({ status: 'completed', finishedAt: fin }), new Map(), opts(null)).journey.state).toBe('ferdig');
  });
});
