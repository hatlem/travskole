/** Svar fra CRM: sendes i samme tråd, én gang, og lukker svaret og oppgaven. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { prisma, sendMailAs } = vi.hoisted(() => ({
  prisma: {
    inboundReply: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    messageSend: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(async () => ({})), delete: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 0 })) },
    senderIdentity: { findUnique: vi.fn(), findFirst: vi.fn() },
    task: { updateMany: vi.fn(async () => ({ count: 1 })) },
  },
  sendMailAs: vi.fn(async () => ({ messageId: '<ny@bjerke.no>' })),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
const firstArg = <T,>(fn: { mock: { calls: unknown[] } }, i = 0): T => (fn.mock.calls as unknown as T[][])[i][0];

vi.mock('@/lib/mail', () => ({ sendMailAs }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/flows/send', () => ({ REPLY_MAILBOX: 'registrering@bjerke.no' }));

import { sendReply, setReplyStatus } from '@/lib/replies/answer';

const REPLY = {
  id: 7, contactId: 5, repliedToSendId: 100, fromEmail: 'iq@fondsfinans.no', fromName: 'Ivar Qvist', subject: 'Julebord',
  bodyText: 'Vi er 12.', internetMessageId: '<svar@fondsfinans.no>', references: '<orig@bjerke.no>', receivedAt: new Date('2026-11-16T14:45:00Z'),
  status: 'open', answerSendId: null, taskId: 33,
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.inboundReply.findUnique.mockResolvedValue(REPLY);
  prisma.messageSend.findUnique.mockResolvedValue({ senderIdentityId: 2 });
  prisma.senderIdentity.findUnique.mockResolvedValue({ id: 2, active: true, email: 'hilde.apneseth@bjerke.no', displayName: 'Hilde Apneseth' });
  prisma.messageSend.create.mockResolvedValue({ id: 900 });
});

describe('sendReply', () => {
  it('sender fra avsenderen av e-posten, i samme tråd, med svar til fellespostboksen', async () => {
    expect(await sendReply(7, 'Hei Ivar!', 'hilde.apneseth@bjerke.no')).toEqual({ sendId: 900 });
    const mail = firstArg<Record<string, unknown>>(sendMailAs);
    expect(mail).toMatchObject({
      from: { name: 'Hilde Apneseth', address: 'hilde.apneseth@bjerke.no' },
      replyTo: 'registrering@bjerke.no',
      to: 'iq@fondsfinans.no',
      subject: 'Re: Julebord',
      headers: { 'In-Reply-To': '<svar@fondsfinans.no>', References: '<orig@bjerke.no> <svar@fondsfinans.no>' },
    });
    expect(firstArg<{ data: Record<string, unknown> }>(prisma.messageSend.create).data).toMatchObject({ dedupeKey: 'crm-reply:7', status: 'sending', toEmail: 'iq@fondsfinans.no' });
    expect(prisma.messageSend.update).toHaveBeenCalledWith({ where: { id: 900 }, data: expect.objectContaining({ status: 'sent', messageId: 'ny@bjerke.no' }) });
    expect(prisma.inboundReply.update).toHaveBeenCalledWith({
      where: { id: 7 }, data: expect.objectContaining({ status: 'answered', handledBy: 'hilde.apneseth@bjerke.no', answerSendId: 900 }),
    });
    expect(prisma.task.updateMany).toHaveBeenCalledWith({ where: { id: 33, status: 'open' }, data: { status: 'done' } });
  });

  it('sender aldri to ganger (dobbeltklikk eller allerede besvart)', async () => {
    prisma.messageSend.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    await expect(sendReply(7, 'Hei', 'h')).rejects.toMatchObject({ status: 409 });
    prisma.inboundReply.findUnique.mockResolvedValueOnce({ ...REPLY, answerSendId: 1 });
    await expect(sendReply(7, 'Hei', 'h')).rejects.toMatchObject({ status: 409 });
    expect(sendMailAs).not.toHaveBeenCalled();
  });

  it('feiler sendingen, slettes plassholderen og svaret står fortsatt åpent', async () => {
    sendMailAs.mockRejectedValueOnce(new Error('smtp'));
    await expect(sendReply(7, 'Hei', 'h')).rejects.toMatchObject({ status: 502 });
    expect(prisma.messageSend.delete).toHaveBeenCalledWith({ where: { id: 900 } });
    expect(prisma.inboundReply.update).not.toHaveBeenCalled();
  });

  it('forbindelsen brøt etter at e-posten gikk: regnes som sendt, aldri på nytt', async () => {
    sendMailAs.mockRejectedValueOnce(Object.assign(new Error('socket closed'), { mayHaveBeenDelivered: true, messageId: '<kanskje@bjerke.no>' }));
    expect(await sendReply(7, 'Takk!', 'hilde.apneseth@bjerke.no')).toEqual({ sendId: 900 });
    expect(prisma.messageSend.delete).not.toHaveBeenCalled();
    expect(prisma.messageSend.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 900 }, data: expect.objectContaining({ status: 'sent', messageId: 'kanskje@bjerke.no' }) }));
    expect(prisma.inboundReply.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'answered', answerSendId: 900 }) }));
  });

  it('sendt, men databasen svikter etterpå: ingen ny sending, og ingen feil til brukeren', async () => {
    prisma.messageSend.update.mockRejectedValueOnce(new Error('db'));
    expect(await sendReply(7, 'Hei', 'h')).toEqual({ sendId: 900 });
    expect(prisma.messageSend.delete).not.toHaveBeenCalled();
    expect(sendMailAs).toHaveBeenCalledTimes(1);
  });

  it('en gammel plassholder etter krasj kan prøves igjen', async () => {
    prisma.messageSend.create
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
      .mockResolvedValueOnce({ id: 901 });
    prisma.messageSend.deleteMany.mockResolvedValueOnce({ count: 1 });
    expect(await sendReply(7, 'Hei', 'h')).toEqual({ sendId: 901 });
  });

  it('tomt svar og ukjent avsender avvises', async () => {
    await expect(sendReply(7, '   ', 'h')).rejects.toMatchObject({ status: 400 });
    prisma.senderIdentity.findUnique.mockResolvedValueOnce({ id: 2, active: false });
    prisma.senderIdentity.findFirst.mockResolvedValueOnce(null);
    await expect(sendReply(7, 'Hei', 'ukjent@x.no')).rejects.toMatchObject({ status: 400 });
  });
});

describe('setReplyStatus', () => {
  it('«trenger ikke svar» lukker oppgaven; «angre» åpner den igjen', async () => {
    await setReplyStatus(7, 'no_reply', 'h');
    expect(prisma.task.updateMany).toHaveBeenLastCalledWith({ where: { id: 33, status: 'open' }, data: { status: 'done' } });
    await setReplyStatus(7, 'open', 'h');
    expect(prisma.inboundReply.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: { status: 'open', handledAt: null, handledBy: null } });
    expect(prisma.task.updateMany).toHaveBeenLastCalledWith({ where: { id: 33, status: 'done' }, data: { status: 'open' } });
  });

  it('et svar sendt herfra kan ikke angres', async () => {
    prisma.inboundReply.findUnique.mockResolvedValueOnce({ id: 7, taskId: 33, answerSendId: 900 });
    await expect(setReplyStatus(7, 'open', 'h')).rejects.toMatchObject({ status: 409 });
  });
});
