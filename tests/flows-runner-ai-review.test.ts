/**
 * Runner-wiring for KI-godkjenning: parkering på e-post-noden mens utkastet
 * venter, videre flyt etter «Hopp over», og målrettet vekking etter beslutning.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, queryRaw } = vi.hoisted(() => {
  const queryRaw = vi.fn(async () => [{ id: 1 }]);
  return {
    queryRaw,
    prisma: {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({ $queryRaw: queryRaw, flowEnrollment: { updateMany: vi.fn() } }),
      ),
      flowEnrollment: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      flowNode: { findMany: vi.fn() },
      flowEdge: { findMany: vi.fn() },
      segment: { findMany: vi.fn(async () => []) },
      contact: { findUnique: vi.fn() },
      registration: { findUnique: vi.fn() },
      messageSend: { findFirst: vi.fn() },
      aiSuggestion: { findUnique: vi.fn() },
    },
  };
});
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/flows/send', () => ({ sendFlowEmail: vi.fn() }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/mail', () => ({ sendAdminEmail: vi.fn() }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn() }));

import { runEnrollmentNow, runFlowBatch } from '@/lib/flows/runner';
import { sendFlowEmail } from '@/lib/flows/send';

const mockedSend = vi.mocked(sendFlowEmail);
const NOW = new Date('2026-10-01T10:00:00Z');
const RESUME = new Date('2026-10-03T10:00:00Z');

const PENDING_DETAIL = JSON.stringify({
  enrollmentId: 1, nodeId: 11, contactId: 7, subject: 'S', originalBody: '<p>B</p>', aiBody: '<p>AI</p>',
  factLines: [], expiresAt: '2026-10-03T10:00:00.000Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.aiSuggestion.findUnique.mockResolvedValue({ id: 1, kind: 'personalization_review', status: 'pending', detail: PENDING_DETAIL });
  prisma.contact.findUnique.mockResolvedValue({
    id: 7, name: 'Kari', email: 'k@example.invalid', stage: 'lead', source: 'manual',
    organizationId: null, lastActivityAt: null, tags: '[]', deals: [],
  });
  prisma.flowEnrollment.findMany.mockResolvedValue([
    { id: 1, flowId: 5, contactId: 7, currentNodeId: null, registrationId: null, flow: { status: 'active', isMarketing: true } },
  ]);
  prisma.flowNode.findMany.mockResolvedValue([
    { id: 10, flowId: 5, type: 'start', config: '{}' },
    { id: 11, flowId: 5, type: 'email', config: JSON.stringify({ subject: 'S', bodyHtml: '<p>B</p>', senderIdentityId: 4, aiPersonalize: true, aiReview: 'approve' }) },
    { id: 12, flowId: 5, type: 'end', config: '{}' },
  ]);
  prisma.flowEdge.findMany.mockResolvedValue([
    { id: 1, flowId: 5, fromNodeId: 10, toNodeId: 11, branch: null },
    { id: 2, flowId: 5, fromNodeId: 11, toNodeId: 12, branch: null },
  ]);
});

describe('runFlowBatch med KI-godkjenning', () => {
  it('sender flowId, aiReview og klokken videre til send-laget', async () => {
    mockedSend.mockResolvedValue('sent');
    await runFlowBatch(NOW);
    expect(mockedSend.mock.calls[0][0]).toMatchObject({ flowId: 5, nodeId: 11, aiPersonalize: true, aiReview: 'approve', now: NOW });
  });

  it('pending_review ⇒ parkerer PÅ e-post-noden til fristen, går ikke videre', async () => {
    mockedSend.mockResolvedValue({ kind: 'pending_review', resumeAt: RESUME });
    const result = await runFlowBatch(NOW);
    expect(prisma.flowEnrollment.update).toHaveBeenCalledTimes(1);
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { currentNodeId: 11, nextRunAt: RESUME },
    });
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 0, completed: 0 });
  });

  it('pending_review, men admin besluttet i mellomtiden ⇒ kjøres igjen straks, ikke ved fristen', async () => {
    mockedSend.mockResolvedValue({ kind: 'pending_review', resumeAt: RESUME });
    prisma.aiSuggestion.findUnique.mockResolvedValueOnce({ id: 1, kind: 'personalization_review', status: 'approved', detail: PENDING_DETAIL });
    await runFlowBatch(NOW);
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { currentNodeId: 11, nextRunAt: NOW },
    });
  });

  it('skipped_review ⇒ flyten går videre (her til slutt-noden)', async () => {
    mockedSend.mockResolvedValue('skipped_review');
    const result = await runFlowBatch(NOW);
    expect(result).toMatchObject({ sent: 0, completed: 1, failed: 0 });
    expect(prisma.flowEnrollment.update.mock.calls[0][0].data).toMatchObject({ status: 'completed', currentNodeId: 12 });
  });
});

describe('runEnrollmentNow', () => {
  it('vekker kun et enrollment som fortsatt står parkert på noden med samme frist, og claimer det', async () => {
    prisma.flowEnrollment.updateMany.mockResolvedValue({ count: 1 });
    prisma.flowEnrollment.findMany.mockResolvedValue([
      { id: 1, flowId: 5, contactId: 7, currentNodeId: 11, registrationId: null, flow: { status: 'active', isMarketing: true } },
    ]);
    mockedSend.mockResolvedValue('sent');

    const result = await runEnrollmentNow(1, 11, RESUME, NOW);

    expect(prisma.flowEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'active', currentNodeId: 11, nextRunAt: RESUME },
      data: { nextRunAt: NOW },
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ processed: 1, sent: 1, completed: 1 });
  });

  it('gjør ingenting når enrollmentet er claimet av en batch eller har flyttet seg', async () => {
    prisma.flowEnrollment.updateMany.mockResolvedValue({ count: 0 });
    const result = await runEnrollmentNow(1, 11, RESUME, NOW);
    expect(result).toEqual({ processed: 0, sent: 0, failed: 0, completed: 0 });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('SKIP LOCKED-claimet tapt (ingen id tilbake) ⇒ ingen behandling', async () => {
    prisma.flowEnrollment.updateMany.mockResolvedValue({ count: 1 });
    queryRaw.mockResolvedValueOnce([]);
    const result = await runEnrollmentNow(1, 11, RESUME, NOW);
    expect(result.processed).toBe(0);
    expect(mockedSend).not.toHaveBeenCalled();
  });
});
