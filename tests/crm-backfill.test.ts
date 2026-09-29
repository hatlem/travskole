import { describe, it, expect, vi } from 'vitest';

// Kun den rene batch-løkka testes; DB-laget er mocket bort.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/crm/bridge', () => ({ syncBookingToCrm: vi.fn(), syncRegistrationToCrm: vi.fn() }));

import { runBackfillBatches, type BackfillPhase, type BatchRunnerDeps } from '@/lib/crm/backfill';

function fakeDeps(data: Record<BackfillPhase, number[]>, opts: { failIds?: number[]; tickMs?: number } = {}) {
  let clock = 0;
  const synced: [BackfillPhase, number][] = [];
  const deps: BatchRunnerDeps = {
    fetchIds: vi.fn(async (phase: BackfillPhase, afterId: number, take: number) => data[phase].filter((id) => id > afterId).slice(0, take)),
    syncOne: vi.fn(async (phase: BackfillPhase, id: number) => {
      synced.push([phase, id]);
      clock += opts.tickMs ?? 0;
      return !(opts.failIds ?? []).includes(id);
    }),
    now: () => clock,
  };
  return { deps, synced };
}

describe('runBackfillBatches', () => {
  it('processes bookings then registrations in batches until done', async () => {
    const { deps, synced } = fakeDeps({ bookings: [1, 2, 3, 5, 8], registrations: [2, 4] });
    const res = await runBackfillBatches(deps, { batchSize: 2, deadline: Infinity });
    expect(res).toEqual({ done: true, cursor: null, processed: { bookings: 5, registrations: 2, failed: 0 } });
    expect(synced).toEqual([
      ['bookings', 1], ['bookings', 2], ['bookings', 3], ['bookings', 5], ['bookings', 8],
      ['registrations', 2], ['registrations', 4],
    ]);
    expect(deps.fetchIds).toHaveBeenCalledWith('bookings', 2, 2);
  });

  it('stops at the deadline with a resumable cursor, and resumes without repeats', async () => {
    const data = { bookings: [1, 2, 3, 4], registrations: [10, 11] };
    const first = fakeDeps(data, { tickMs: 10 });
    const r1 = await runBackfillBatches(first.deps, { batchSize: 50, deadline: 25 });
    expect(r1).toEqual({ done: false, cursor: { phase: 'bookings', afterId: 3 }, processed: { bookings: 3, registrations: 0, failed: 0 } });

    const second = fakeDeps(data);
    const r2 = await runBackfillBatches(second.deps, { cursor: r1.cursor, batchSize: 50, deadline: Infinity });
    expect(r2.done).toBe(true);
    expect(second.synced).toEqual([['bookings', 4], ['registrations', 10], ['registrations', 11]]);
  });

  it('always makes progress even if the deadline has passed', async () => {
    const { deps } = fakeDeps({ bookings: [1, 2], registrations: [] });
    const res = await runBackfillBatches(deps, { batchSize: 10, deadline: -1 });
    expect(res).toEqual({ done: false, cursor: { phase: 'bookings', afterId: 1 }, processed: { bookings: 1, registrations: 0, failed: 0 } });
  });

  it('counts failures and moves past them (no endless loop)', async () => {
    const { deps } = fakeDeps({ bookings: [1, 2], registrations: [3] }, { failIds: [2, 3] });
    const res = await runBackfillBatches(deps, { batchSize: 1, deadline: Infinity });
    expect(res).toEqual({ done: true, cursor: null, processed: { bookings: 2, registrations: 1, failed: 2 } });
  });

  it('empty database finishes immediately', async () => {
    const { deps } = fakeDeps({ bookings: [], registrations: [] });
    expect(await runBackfillBatches(deps, { batchSize: 10, deadline: Infinity }))
      .toEqual({ done: true, cursor: null, processed: { bookings: 0, registrations: 0, failed: 0 } });
  });
});
