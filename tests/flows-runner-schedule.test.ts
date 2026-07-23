/**
 * Unit coverage (mocked Prisma) for the runner ↔ schedule-node ↔ send wiring
 * in lib/flows/runner.ts. This does NOT hit a real database — it drives
 * `runFlowBatch` through a synthetic `start → schedule → email → end` flow
 * with a fully mocked `@/lib/prisma`, `@/lib/flows/send`, and `@/lib/logger`,
 * and asserts the plumbing between `planSchedule`/`planEmail` (lib/flows/step.ts)
 * and the actual prisma calls / send-layer invocation the runner makes.
 *
 * The live end-to-end path (real DB, real course dates, real merge-tag
 * rendering) is covered separately by Task 9's tsx smoke script — this file
 * only proves the runner wires schedule → sleep-to-anchor → email →
 * registrationId correctly, so the rest of the suite can stay DB-independent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { osloDayStartUtc } from '@/lib/flows/schedule';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        $queryRaw: vi.fn(async () => [{ id: 1 }]), // claim: always returns enrollment id 1
        flowEnrollment: { updateMany: vi.fn() }, // lease bump
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

const { sendFlowEmail } = vi.hoisted(() => ({
  sendFlowEmail: vi.fn(async () => 'sent' as const),
}));
vi.mock('@/lib/flows/send', () => ({ sendFlowEmail }));

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ default: logger }));

import { runFlowBatch } from '@/lib/flows/runner';

// node ids: 10=start, 11=schedule, 12=email, 13=end
const NODES = [
  { id: 10, flowId: 1, type: 'start', config: '{}' },
  { id: 11, flowId: 1, type: 'schedule', config: JSON.stringify({ anchor: 'course_start', offsetDays: -3 }) },
  {
    id: 12,
    flowId: 1,
    type: 'email',
    config: JSON.stringify({ subject: 'Hei {{barnets_navn}}', bodyHtml: '<p>{{kurs_navn}}</p>', senderIdentityId: 5 }),
  },
  { id: 13, flowId: 1, type: 'end', config: '{}' },
];
const EDGES = [
  { id: 1, flowId: 1, fromNodeId: 10, toNodeId: 11, branch: null },
  { id: 2, flowId: 1, fromNodeId: 11, toNodeId: 12, branch: null },
  { id: 3, flowId: 1, fromNodeId: 12, toNodeId: 13, branch: null },
];
const CONTACT = {
  id: 7,
  name: 'Kari',
  email: 'k@example.invalid',
  stage: 'lead',
  source: 'manual',
  organizationId: null,
  lastActivityAt: null,
  tags: '[]',
  deals: [],
};

function enrollment(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    flowId: 1,
    contactId: 7,
    currentNodeId: null,
    registrationId: 42,
    flow: { status: 'active', isMarketing: false },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.flowNode.findMany.mockResolvedValue(NODES);
  prisma.flowEdge.findMany.mockResolvedValue(EDGES);
  prisma.contact.findUnique.mockResolvedValue(CONTACT);
  sendFlowEmail.mockResolvedValue('sent');
});

describe('runFlowBatch: schedule-node wiring (mocked Prisma)', () => {
  it('1. schedule node resolves live course dates and sleeps to the computed anchor', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([enrollment()]);
    prisma.registration.findUnique.mockResolvedValue({
      course: { startDate: new Date('2026-06-01T10:00:00Z'), endDate: new Date('2026-06-11T10:00:00Z') },
    });

    await runFlowBatch(new Date());

    // loadCourseDates fired for the schedule node with the enrollment's registrationId
    expect(prisma.registration.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 42 } }),
    );

    // sleep landed on the computed anchor (course_start - 3 days) and points at the email node
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nextRunAt: osloDayStartUtc('2026-05-29'),
          currentNodeId: 12,
        }),
      }),
    );
    expect(sendFlowEmail).not.toHaveBeenCalled();
  });

  it('2. registrationId is passed through to the send layer', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([enrollment({ currentNodeId: 12 })]);

    await runFlowBatch(new Date());

    expect(sendFlowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ registrationId: 42 }),
    );
    // Lazy: no course-date resolution when the hop isn't a schedule node.
    expect(prisma.registration.findUnique).not.toHaveBeenCalled();
  });

  it('3. an uncomputable anchor exits gracefully and logs the reason', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([enrollment()]);
    prisma.registration.findUnique.mockResolvedValue({
      course: { startDate: null, endDate: null },
    });

    await runFlowBatch(new Date());

    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'exited' }),
      }),
    );
    expect(logger.info).toHaveBeenCalled();
    expect(sendFlowEmail).not.toHaveBeenCalled();
  });

  it('4. a marketing enrollment (registrationId null) is unaffected', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([
      enrollment({ currentNodeId: 12, registrationId: null }),
    ]);

    await runFlowBatch(new Date());

    expect(sendFlowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ registrationId: null }),
    );
    expect(prisma.registration.findUnique).not.toHaveBeenCalled();
  });
});
