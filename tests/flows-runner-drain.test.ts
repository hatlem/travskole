import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, claims, leases } = vi.hoisted(() => {
  const claims: number[][] = [];
  const leases: Date[] = [];
  const prisma = {
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        $queryRaw: vi.fn(async () => (claims.shift() ?? []).map((id) => ({ id }))),
        flowEnrollment: {
          updateMany: vi.fn(async ({ data }: { data: { nextRunAt: Date } }) => {
            leases.push(data.nextRunAt);
            return { count: 0 };
          }),
        },
      }),
    ),
    flowEnrollment: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: number[] } } }) =>
        where.id.in.map((id) => ({
          id, flowId: 1, contactId: id, currentNodeId: null, registrationId: null, flow: { status: 'active', isMarketing: false },
        })),
      ),
      update: vi.fn(),
    },
    flowNode: { findMany: vi.fn(async () => []) },
    flowEdge: { findMany: vi.fn(async () => []) },
    segment: { findMany: vi.fn(async () => []) },
    setting: { findMany: vi.fn(async () => []) },
    contact: { findUnique: vi.fn(async () => null) },
  };
  return { prisma, claims, leases };
});
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/flows/send', () => ({ sendFlowEmail: vi.fn() }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { BATCH_SIZE, DRAIN_BUDGET_MS, LEASE_MINUTES, drainFlowBatches } from '@/lib/flows/runner';

const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

/** Klokke som går `stepMs` fram for hvert kall. */
function steppingClock(stepMs: number, start = Date.parse('2026-10-02T06:00:00Z')) {
  let t = start;
  return () => {
    const now = new Date(t);
    t += stepMs;
    return now;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  claims.length = 0;
  leases.length = 0;
});

describe('drainFlowBatches', () => {
  it('kjører batch etter batch til en batch er mindre enn batchstørrelsen', async () => {
    claims.push(ids(1, BATCH_SIZE), ids(51, BATCH_SIZE), ids(101, 10));
    const result = await drainFlowBatches(DRAIN_BUDGET_MS, steppingClock(100));
    expect(result).toEqual({ batches: 3, processed: 110, failed: 110, sent: 0, completed: 0 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('stopper når køen er tom', async () => {
    claims.push(ids(1, BATCH_SIZE));
    const result = await drainFlowBatches(DRAIN_BUDGET_MS, steppingClock(100));
    expect(result.batches).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('starter ikke en ny batch som ikke får plass i tidsbudsjettet', async () => {
    for (let i = 0; i < 10; i++) claims.push(ids(i * BATCH_SIZE + 1, BATCH_SIZE));
    // 20 s per klokkelesing: batch 1 ferdig etter 40 s (+20 s ⇒ 60 ≤ 75), batch 2 etter 80 s ⇒ stopp.
    const result = await drainFlowBatches(75_000, steppingClock(20_000));
    expect(result.batches).toBe(2);
    expect(claims).toHaveLength(8);
  });

  it('hver batch claimer med fersk tid og egen lease', async () => {
    claims.push(ids(1, BATCH_SIZE), ids(51, 5));
    const clock = steppingClock(1_000);
    await drainFlowBatches(DRAIN_BUDGET_MS, clock);
    expect(leases).toHaveLength(2);
    expect(leases[1].getTime() - leases[0].getTime()).toBeGreaterThan(0);
    expect(leases[0].getTime()).toBe(Date.parse('2026-10-02T06:00:01Z') + LEASE_MINUTES * 60_000);
  });

  it('tømmer en nattkø på 5 000 i én kjøring når batchene er raske', async () => {
    for (let i = 0; i < 100; i++) claims.push(ids(i * BATCH_SIZE + 1, BATCH_SIZE));
    const result = await drainFlowBatches(DRAIN_BUDGET_MS, steppingClock(200));
    expect(result.batches).toBe(100);
    expect(result.processed).toBe(5000);
  });
});
