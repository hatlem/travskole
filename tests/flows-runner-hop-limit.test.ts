/** Hop-taket per tick: lange kjeder av passerte steg fortsetter neste tick; bare en ring feiler. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        $queryRaw: vi.fn(async () => [{ id: 1 }]),
        flowEnrollment: { updateMany: vi.fn() },
      }),
    ),
    flowEnrollment: { findMany: vi.fn(), update: vi.fn() },
    flowNode: { findMany: vi.fn() },
    flowEdge: { findMany: vi.fn() },
    segment: { findMany: vi.fn(async () => []) },
    contact: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/flows/send', () => ({ sendFlowEmail: vi.fn(async () => 'sent' as const) }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { runFlowBatch } from '@/lib/flows/runner';

const CONTACT = {
  id: 7, name: 'Kari', email: 'k@example.invalid', stage: 'lead', source: 'manual',
  organizationId: null, lastActivityAt: null, tags: '[]', deals: [],
};
const NOW = new Date('2026-06-01T08:00:00Z');

/** start(1) → 30 vent-0-steg (2..31) → slutt(32). */
const WAITS = 30;
const chainNodes = [
  { id: 1, flowId: 1, type: 'start', config: '{}' },
  ...Array.from({ length: WAITS }, (_, i) => ({ id: i + 2, flowId: 1, type: 'wait', config: '{"days":0}' })),
  { id: WAITS + 2, flowId: 1, type: 'end', config: '{}' },
];
const chainEdges = Array.from({ length: WAITS + 1 }, (_, i) => ({
  id: i + 1, flowId: 1, fromNodeId: i + 1, toNodeId: i + 2, branch: null,
}));

const enrollment = (currentNodeId: number | null) => ({
  id: 1, flowId: 1, contactId: 7, currentNodeId, registrationId: null,
  flow: { status: 'active', isMarketing: false },
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.contact.findUnique.mockResolvedValue(CONTACT);
});

describe('runFlowBatch: hop-tak', () => {
  it('lagrer posisjonen og fortsetter neste tick i stedet for å feile', async () => {
    prisma.flowNode.findMany.mockResolvedValue(chainNodes);
    prisma.flowEdge.findMany.mockResolvedValue(chainEdges);
    prisma.flowEnrollment.findMany.mockResolvedValue([enrollment(null)]);

    const first = await runFlowBatch(NOW);

    expect(first.failed).toBe(0);
    expect(prisma.flowEnrollment.update).toHaveBeenCalledTimes(1);
    const { data } = prisma.flowEnrollment.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toEqual({ currentNodeId: 21, nextRunAt: NOW });

    vi.clearAllMocks();
    prisma.contact.findUnique.mockResolvedValue(CONTACT);
    prisma.flowNode.findMany.mockResolvedValue(chainNodes);
    prisma.flowEdge.findMany.mockResolvedValue(chainEdges);
    prisma.flowEnrollment.findMany.mockResolvedValue([enrollment(data.currentNodeId as number)]);

    const second = await runFlowBatch(NOW);

    expect(second).toMatchObject({ failed: 0, completed: 1 });
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed', currentNodeId: WAITS + 2 }),
    }));
  });

  it('feiler fortsatt med hop-limit når grafen har en ring', async () => {
    prisma.flowNode.findMany.mockResolvedValue([
      { id: 1, flowId: 1, type: 'start', config: '{}' },
      { id: 2, flowId: 1, type: 'wait', config: '{"days":0}' },
      { id: 3, flowId: 1, type: 'wait', config: '{"days":0}' },
    ]);
    prisma.flowEdge.findMany.mockResolvedValue([
      { id: 1, flowId: 1, fromNodeId: 1, toNodeId: 2, branch: null },
      { id: 2, flowId: 1, fromNodeId: 2, toNodeId: 3, branch: null },
      { id: 3, flowId: 1, fromNodeId: 3, toNodeId: 2, branch: null },
    ]);
    prisma.flowEnrollment.findMany.mockResolvedValue([enrollment(null)]);

    const result = await runFlowBatch(NOW);

    expect(result.failed).toBe(1);
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', failReason: 'hop-limit' }),
    }));
  });
});
