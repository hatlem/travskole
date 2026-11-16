/** Lagring av svar: én rad per melding, riktig flyt, Outlook-svar og svar fra før lagringen fantes. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    inboundReply: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(async () => ({ id: 1 })), update: vi.fn(async () => ({})) },
    messageSend: { findUnique: vi.fn(), findFirst: vi.fn() },
    flowEnrollment: { findUnique: vi.fn() },
    task: { findFirst: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
const firstArg = <T,>(fn: { mock: { calls: unknown[] } }, i = 0): T => (fn.mock.calls as unknown as T[][])[i][0];


import { backfillReply, markAnsweredFromMailbox, storeInboundReply } from '@/lib/replies/store';

const input = {
  contactId: 5, repliedToSendId: 100, fromEmail: ' IQ@Fondsfinans.no ', fromName: 'Ivar', subject: 'SV: Julebord',
  body: 'Vi er 12.\n\nFra: Hilde', internetMessageId: '<a@b>', references: null, receivedAt: new Date('2026-11-16T14:45:00Z'), taskId: 33,
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.inboundReply.findUnique.mockResolvedValue(null);
});

describe('storeInboundReply', () => {
  it('lagrer det nye i svaret og flyten fra e-posten det svarte på', async () => {
    prisma.messageSend.findUnique.mockResolvedValue({ enrollmentId: 9 });
    prisma.flowEnrollment.findUnique.mockResolvedValue({ flowId: 22 });
    await storeInboundReply(input);
    expect(firstArg<{ data: Record<string, unknown> }>(prisma.inboundReply.create).data).toMatchObject({
      contactId: 5, flowId: 22, fromEmail: 'iq@fondsfinans.no', bodyText: 'Vi er 12.', taskId: 33,
    });
  });

  it('svar på vårt svar arver flyten fra samtalen', async () => {
    prisma.messageSend.findUnique.mockResolvedValue({ enrollmentId: null });
    prisma.inboundReply.findFirst.mockResolvedValue({ flowId: 23 });
    await storeInboundReply(input);
    expect(prisma.inboundReply.findFirst).toHaveBeenCalledWith({ where: { answerSendId: 100 }, select: { flowId: true } });
    expect(firstArg<{ data: Record<string, unknown> }>(prisma.inboundReply.create).data.flowId).toBe(23);
  });

  it('samme melding lagres bare én gang', async () => {
    prisma.inboundReply.findUnique.mockResolvedValue({ id: 4, taskId: 33 });
    expect(await storeInboundReply(input)).toBe(4);
    expect(prisma.inboundReply.create).not.toHaveBeenCalled();
  });
});

describe('markAnsweredFromMailbox', () => {
  it('svar skrevet i Outlook merker svaret som besvart og lukker oppgaven', async () => {
    prisma.inboundReply.findMany.mockResolvedValue([{ id: 4, taskId: 33 }]);
    expect(await markAnsweredFromMailbox(['<a@b>'], 'registrering@bjerke.no', new Date())).toBe(1);
    expect(firstArg<{ where: { internetMessageId: { in: string[] } } }>(prisma.inboundReply.findMany).where.internetMessageId.in).toEqual(expect.arrayContaining(['<a@b>', 'a@b']));
    expect(firstArg<{ data: Record<string, unknown> }>(prisma.inboundReply.update).data).toMatchObject({ status: 'answered', handledBy: 'registrering@bjerke.no (Outlook)' });
    expect(prisma.task.updateMany).toHaveBeenCalled();
  });
  it('ingen ID-er: ingenting skjer', async () => {
    expect(await markAnsweredFromMailbox([], 'x', new Date())).toBe(0);
    expect(prisma.inboundReply.findMany).not.toHaveBeenCalled();
  });
});

describe('backfillReply', () => {
  it('lagrer et gammelt svar og kobler det til den åpne svar-oppgaven', async () => {
    prisma.messageSend.findFirst.mockResolvedValue({ id: 100, contactId: 5, subject: 'Julebord' });
    prisma.messageSend.findUnique.mockResolvedValue({ enrollmentId: null });
    prisma.inboundReply.findFirst.mockResolvedValue(null);
    prisma.task.findFirst.mockResolvedValue({ id: 33 });
    const details = {
      subject: input.subject, fromEmail: 'iq@fondsfinans.no', fromName: input.fromName, body: input.body,
      internetMessageId: input.internetMessageId, references: input.references, receivedAt: input.receivedAt,
    };
    expect(await backfillReply('orig@bjerke.no', details)).toBe(true);
    expect(firstArg<{ data: Record<string, unknown> }>(prisma.inboundReply.create).data).toMatchObject({ contactId: 5, repliedToSendId: 100, taskId: 33 });
  });
  it('allerede lagret: hopper over', async () => {
    prisma.inboundReply.findUnique.mockResolvedValue({ id: 4 });
    expect(await backfillReply('x', { ...input, fromEmail: 'a@b' })).toBe(false);
  });
});
