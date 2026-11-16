/** «Har noen svart deg direkte?»: søk blant dem som har fått e-post, og stopp resten. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, emitEvent, excludeRecipient } = vi.hoisted(() => ({
  prisma: {
    flowEnrollment: { findMany: vi.fn() },
    messageSend: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    flowNode: { groupBy: vi.fn() },
  },
  emitEvent: vi.fn(async () => true),
  excludeRecipient: vi.fn(async () => ({ stopped: 1 })),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/events/bus', () => ({ emitEvent }));
vi.mock('@/lib/utsendelser/recipients', () => ({ excludeRecipient }));

import { directReplyState, markRepliedDirectly, searchSentRecipients } from '@/lib/utsendelser/direct-reply';
import type { Utsendelse } from '@/lib/utsendelser/config';

const U: Utsendelse = {
  id: 'juletrav-2026',
  navn: 'Juletrav 2026',
  flyter: [{ flowId: 22, navn: 'Personer' }, { flowId: 23, navn: 'Funksjonsadresser' }],
  grupper: [{ id: 'prio-1', navn: 'Prioritet 1', segmentId: 2, flowId: 22 }],
};

const contact = { name: 'Kari Nordmann', email: 'kari@firma.no', organization: { name: 'Firma AS' } };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.flowNode.groupBy.mockResolvedValue([{ flowId: 22, _count: { _all: 3 } }, { flowId: 23, _count: { _all: 3 } }]);
});

describe('directReplyState', () => {
  it('svar vinner over alt annet', () => expect(directReplyState(['active'], true)).toBe('svarte'));
  it('aktiv betyr at flere e-poster kommer', () => expect(directReplyState(['exited', 'active'], false)).toBe('pagar'));
  it('ferdig bare når alle løp er fullført', () => {
    expect(directReplyState(['completed'], false)).toBe('ferdig');
    expect(directReplyState(['completed', 'exited'], false)).toBe('stoppet');
  });
});

describe('searchSentRecipients', () => {
  it('søker ikke på under to tegn', async () => {
    expect(await searchSentRecipients(U, ' k ')).toEqual([]);
    expect(prisma.flowEnrollment.findMany).not.toHaveBeenCalled();
  });

  it('søker bare i utsendelsens flyter, på navn, e-post og bedrift', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([]);
    await searchSentRecipients(U, 'kari');
    const where = prisma.flowEnrollment.findMany.mock.calls[0][0].where;
    expect(where.flowId).toEqual({ in: [22, 23] });
    expect(where.contact.OR).toHaveLength(3);
  });

  it('teller e-poster personen har fått, og om de får flere', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([{ id: 9, flowId: 22, contactId: 5, status: 'active', contact }]);
    prisma.messageSend.findMany.mockResolvedValue([
      { enrollmentId: 9, nodeId: 281, repliedAt: null },
      { enrollmentId: 9, nodeId: 283, repliedAt: null },
    ]);
    expect(await searchSentRecipients(U, 'kari')).toEqual([
      { contactId: 5, name: 'Kari Nordmann', email: 'kari@firma.no', org: 'Firma AS', received: 2, total: 3, state: 'pagar' },
    ]);
  });
});

describe('markRepliedDirectly', () => {
  it('stopper resten og merker siste e-post som besvart, uten egen svar-oppgave', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([{ id: 9 }]);
    prisma.messageSend.findFirst.mockResolvedValue({ id: 77, enrollmentId: 9, repliedAt: null });
    prisma.messageSend.updateMany.mockResolvedValue({ count: 1 });

    expect(await markRepliedDirectly(U, 5, 'hilde@bjerke.no')).toEqual({ stopped: 1 });
    expect(excludeRecipient).toHaveBeenCalledWith(U, 5, 'hilde@bjerke.no');
    expect(prisma.messageSend.updateMany).toHaveBeenCalledWith({ where: { id: 77, repliedAt: null }, data: { repliedAt: expect.any(Date) } });
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'email.replied', contactId: 5, dedupeKey: 'reply:77' }));
  });

  it('teller ikke svaret på nytt når systemet alt har sett det', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([{ id: 9 }]);
    prisma.messageSend.findFirst.mockResolvedValue({ id: 77, enrollmentId: 9, repliedAt: new Date() });
    await markRepliedDirectly(U, 5, 'h');
    expect(prisma.messageSend.updateMany).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(excludeRecipient).toHaveBeenCalled();
  });

  it('nekter når personen ikke har fått noe fra utsendelsen', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([]);
    await expect(markRepliedDirectly(U, 5, 'h')).rejects.toMatchObject({ status: 404 });
    expect(excludeRecipient).not.toHaveBeenCalled();
  });
});
