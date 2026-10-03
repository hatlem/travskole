/**
 * Runner-wiring (mocked Prisma) for create_task-handlingen og
 * klikk/svar-betingelsene: at engasjement leses fra siste sporede sending og
 * at oppgaven opprettes med riktig kontakt, ansvarlig og frist.
 */
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
    messageSend: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    task: { create: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/flows/send', () => ({ sendFlowEmail: vi.fn(async () => 'sent') }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/mail', () => ({ sendAdminEmail: vi.fn() }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn() }));
const { notifyTaskAssignee } = vi.hoisted(() => ({ notifyTaskAssignee: vi.fn(async () => {}) }));
vi.mock('@/lib/crm/task-notify', () => ({ notifyTaskAssignee }));

import { runFlowBatch } from '@/lib/flows/runner';
import { sendFlowEmail } from '@/lib/flows/send';
import { enrollmentStatusLabel } from '@/lib/flows/enrollment-status';

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

const NOW = new Date('2026-05-01T08:00:00Z');

function mockGraph(nodes: { id: number; type: string; config: Record<string, unknown> }[], edges: [number, number, string | null][]) {
  prisma.flowNode.findMany.mockResolvedValue(
    nodes.map((node) => ({ ...node, flowId: 1, config: JSON.stringify(node.config) })),
  );
  prisma.flowEdge.findMany.mockResolvedValue(
    edges.map(([from, to, branch], i) => ({ id: i + 1, flowId: 1, fromNodeId: from, toNodeId: to, branch })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.contact.findUnique.mockResolvedValue(CONTACT);
  prisma.flowEnrollment.findMany.mockResolvedValue([
    { id: 1, flowId: 1, contactId: 7, currentNodeId: null, registrationId: null, flow: { status: 'active', isMarketing: true } },
  ]);
});

describe('runFlowBatch: create_task', () => {
  beforeEach(() => {
    mockGraph(
      [
        { id: 10, type: 'start', config: {} },
        { id: 11, type: 'action', config: { kind: 'create_task', title: 'Ring Kari', assigneeUserId: 4, dueDays: 2 } },
        { id: 12, type: 'end', config: {} },
      ],
      [[10, 11, null], [11, 12, null]],
    );
  });

  it('oppretter oppgave på kontakten med ansvarlig og frist, og varsler den ansvarlige', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 4 });
    prisma.task.create.mockResolvedValueOnce({ id: 77 });
    await runFlowBatch(NOW);
    expect(prisma.task.create).toHaveBeenCalledWith({
      data: {
        title: 'Ring Kari',
        contactId: 7,
        assigneeId: 4,
        dueAt: new Date('2026-05-03T08:00:00Z'),
      },
    });
    expect(notifyTaskAssignee).toHaveBeenCalledWith({ taskId: 77, actorUserId: null, actorEmail: 'E-postflyt' });
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
    );
  });

  it('ansvarlig som ikke lenger er aktiv admin gir ufordelt oppgave, ikke feilet enrollment', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await runFlowBatch(NOW);
    expect(prisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ assigneeId: null }),
    });
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
    );
  });
});

describe('runFlowBatch: create_task til kontaktens ansvarlige', () => {
  beforeEach(() => {
    mockGraph(
      [
        { id: 10, type: 'start', config: {} },
        { id: 11, type: 'action', config: { kind: 'create_task', title: 'Ring', assignTo: 'owner', assigneeUserId: 9, dueDays: 1 } },
        { id: 12, type: 'end', config: {} },
      ],
      [[10, 11, null], [11, 12, null]],
    );
    prisma.user.findFirst.mockImplementation(async ({ where }: { where: { id: number } }) =>
      [3, 5, 9].includes(where.id) ? { id: where.id } : null,
    );
  });

  const owners = (contactOwner: number | null, orgOwner: number | null) =>
    prisma.contact.findUnique.mockImplementation(async (args: { select?: { ownerId?: boolean } }) =>
      args.select?.ownerId ? { ownerId: contactOwner, organization: orgOwner === null ? null : { ownerId: orgOwner } } : CONTACT,
    );

  it('bruker kontaktens eier først', async () => {
    owners(3, 5);
    await runFlowBatch(NOW);
    expect(prisma.task.create).toHaveBeenCalledWith({ data: expect.objectContaining({ assigneeId: 3 }) });
  });

  it('faller tilbake til bedriftens eier', async () => {
    owners(null, 5);
    await runFlowBatch(NOW);
    expect(prisma.task.create).toHaveBeenCalledWith({ data: expect.objectContaining({ assigneeId: 5 }) });
  });

  it('faller tilbake til fast reserve når ingen eier er aktiv admin', async () => {
    owners(42, null);
    await runFlowBatch(NOW);
    expect(prisma.task.create).toHaveBeenCalledWith({ data: expect.objectContaining({ assigneeId: 9 }) });
  });
});

describe('runFlowBatch: engasjementsbetingelser', () => {
  const graphFor = (kind: string) =>
    mockGraph(
      [
        { id: 10, type: 'start', config: {} },
        { id: 11, type: 'condition', config: { kind } },
        { id: 12, type: 'end', config: {} }, // ja
        { id: 13, type: 'end', config: {} }, // nei
      ],
      [[10, 11, null], [11, 12, 'ja'], [11, 13, 'nei']],
    );

  const completedAt = () =>
    prisma.flowEnrollment.update.mock.calls.map((c) => c[0].data).find((d) => d.status === 'completed')?.currentNodeId;

  it('clicked_email: klikk på siste sending gir ja', async () => {
    graphFor('clicked_email');
    prisma.messageSend.findFirst.mockResolvedValue({ openedAt: null, firstClickedAt: new Date(), clickCount: 1, repliedAt: null });
    await runFlowBatch(NOW);
    expect(prisma.messageSend.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enrollmentId: 1, dedupeKey: { not: null } } }),
    );
    expect(completedAt()).toBe(12);
  });

  it('opened_email: et klikk teller som åpning selv uten registrert åpning', async () => {
    graphFor('opened_email');
    prisma.messageSend.findFirst.mockResolvedValue({ openedAt: null, firstClickedAt: new Date(), clickCount: 1, repliedAt: null });
    await runFlowBatch(NOW);
    expect(completedAt()).toBe(12);
  });

  it('opened_email: verken åpnet eller klikket gir nei', async () => {
    graphFor('opened_email');
    prisma.messageSend.findFirst.mockResolvedValue({ openedAt: null, firstClickedAt: null, clickCount: 0, repliedAt: null });
    await runFlowBatch(NOW);
    expect(completedAt()).toBe(13);
  });

  it('replied_email: åpnet men ikke svart gir nei', async () => {
    graphFor('replied_email');
    prisma.messageSend.findFirst.mockResolvedValue({ openedAt: new Date(), firstClickedAt: null, clickCount: 0, repliedAt: null });
    await runFlowBatch(NOW);
    expect(completedAt()).toBe(13);
  });

  it('replied_email: ingen tidligere sending gir nei', async () => {
    graphFor('replied_email');
    prisma.messageSend.findFirst.mockResolvedValue(null);
    await runFlowBatch(NOW);
    expect(completedAt()).toBe(13);
  });
});

describe('runFlowBatch: e-post som ikke kan sendes stopper markedsføringsløpet', () => {
  beforeEach(() => {
    mockGraph(
      [
        { id: 10, type: 'start', config: {} },
        { id: 11, type: 'email', config: { subject: 'Hei', bodyHtml: '<p>Hei</p>', senderIdentityId: 1 } },
        { id: 12, type: 'action', config: { kind: 'create_task', title: 'Ring', dueDays: 1 } },
        { id: 13, type: 'end', config: {} },
      ],
      [[10, 11, null], [11, 12, null], [12, 13, null]],
    );
  });

  it.each([
    ['skipped_no_consent', 'no_consent', 'Stoppet – mangler samtykke'],
    ['skipped_suppressed', 'suppressed', 'Stoppet – står på ikke-kontakt-listen'],
  ] as const)('%s ⇒ avsluttet med synlig årsak, ingen senere steg', async (result, reason, label) => {
    vi.mocked(sendFlowEmail).mockResolvedValueOnce(result);
    await runFlowBatch(NOW);
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'exited', failReason: reason, finishedAt: NOW, currentNodeId: 11, nextRunAt: NOW },
    });
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(enrollmentStatusLabel({ status: 'exited', failReason: reason })).toBe(label);
  });

  it('tjenesteflyt: en skippet e-post stopper ikke løpet', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([
      { id: 1, flowId: 1, contactId: 7, currentNodeId: null, registrationId: null, flow: { status: 'active', isMarketing: false } },
    ]);
    vi.mocked(sendFlowEmail).mockResolvedValueOnce('skipped_suppressed');
    await runFlowBatch(NOW);
    expect(prisma.task.create).toHaveBeenCalled();
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed', nextRunAt: NOW }) }),
    );
  });
});

describe('enrollmentStatusLabel', () => {
  it('vanlige statuser', () => {
    expect(enrollmentStatusLabel({ status: 'active' })).toBe('Underveis');
    expect(enrollmentStatusLabel({ status: 'completed', failReason: null })).toBe('Ferdig');
    expect(enrollmentStatusLabel({ status: 'failed', failReason: 'send-failed' })).toBe('Stoppet (feil)');
  });
});
