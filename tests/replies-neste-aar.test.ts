/** «Spar til neste år»: riktig sesong, liste, oppgave, angre og påminnelser som går én gang. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, settings, sendAdminEmail, getUtsendelser, getUtsendelse, createUtsendelse, updateEmailStep } = vi.hoisted(() => {
  const settings = new Map<string, string>();
  return {
    settings,
    getUtsendelse: vi.fn(async (id: string) => (id === 'julebord-2027' ? { id, navn: 'Julebord 2027 – de som hadde bestilt i fjor' } : null)),
    createUtsendelse: vi.fn(async () => ({ id: 'julebord-2027', navn: 'Julebord 2027 – de som hadde bestilt i fjor', flyter: [{ flowId: 50 }], grupper: [] })),
    updateEmailStep: vi.fn(async () => {}),
    sendAdminEmail: vi.fn(async () => {}),
    getUtsendelser: vi.fn(async () => [] as { grupper: { listId?: number }[]; flyter: { flowId: number }[] }[]),
    prisma: {
      inboundReply: { findUnique: vi.fn(), update: vi.fn(async () => ({})), count: vi.fn(async () => 0) },
      contactList: { findUnique: vi.fn(async () => ({ id: 7 })), findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 7 })) },
      contactListMembership: { createMany: vi.fn(async () => ({ count: 1 })), deleteMany: vi.fn(async () => ({ count: 1 })), count: vi.fn(async () => 3) },
      messageSend: { findUnique: vi.fn(async () => ({ senderIdentityId: 3, senderIdentity: { email: 'Hilde@bjerke.no' } })) },
      senderIdentity: { findFirst: vi.fn(async () => null) },
      flowNode: { findFirst: vi.fn(async () => ({ id: 77 })) },
      flowEnrollment: { count: vi.fn(async () => 0) },
      user: { findFirst: vi.fn(async () => ({ id: 42 })) },
      task: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 99 })), updateMany: vi.fn(async () => ({ count: 1 })) },
      setting: {
        upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: string } }) => { settings.set(where.key, create.value); return {}; }),
        // Engangsnøkler: lages bare én gang (P2002 ellers).
        create: vi.fn(async ({ data }: { data: { key: string; value: string } }) => {
          if (settings.has(data.key)) {
            const { Prisma } = await import('@prisma/client');
            throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
          }
          settings.set(data.key, data.value);
          return {};
        }),
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (settings.has(where.key) ? { updatedAt: new Date() } : null)),
        findMany: vi.fn(async ({ where }: { where: { key: { startsWith: string } } }) => [...settings.keys()].filter((k) => k.startsWith(where.key.startsWith)).map((key) => ({ key }))),
      },
    },
  };
});
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async (key: string) => settings.get(key) ?? '') }));
vi.mock('@/lib/mail', () => ({ sendAdminEmail, sendMailAs: vi.fn() }));
vi.mock('@/lib/site', () => ({ getBaseUrl: () => 'https://registrering.bjerke.no' }));
vi.mock('@/lib/utsendelser/config', () => ({ getUtsendelser, getUtsendelse }));
vi.mock('@/lib/utsendelser/edit', () => ({ createUtsendelse }));
vi.mock('@/lib/utsendelser/actions', () => ({ updateEmailStep, PLACEHOLDER_MARK: 'Skriv teksten her.' }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));

import {
  buildReminderEmail, nextSeasonYear, nextYearSummary, reminderDates, removeFromNextYear, saveForNextYear, sendDueReminders,
} from '@/lib/replies/neste-aar';

const NOV = new Date('2026-11-17T10:00:00Z');
const reply = { id: 1, contactId: 5, status: 'open', taskId: 33, savedListId: null, repliedToSendId: 100 };

beforeEach(() => {
  vi.clearAllMocks();
  settings.clear();
  prisma.inboundReply.findUnique.mockResolvedValue(reply);
});

describe('sesong', () => {
  it('svar om høsten gjelder neste år, svar om våren samme år', () => {
    expect(nextSeasonYear(NOV)).toBe(2027);
    expect(nextSeasonYear(new Date('2027-03-01T12:00:00Z'))).toBe(2027);
    expect(nextSeasonYear(new Date('2027-07-01T12:00:00Z'))).toBe(2028);
  });
  it('påminnelser 16. august og 1. september kl. 08 norsk tid', () => {
    expect(reminderDates(2027)).toEqual(['2027-08-16T06:00:00.000Z', '2027-09-01T06:00:00.000Z']);
  });
});

describe('saveForNextYear', () => {
  it('lager «Julebord 2027», legger kontakten i lista, lukker svaret og lager én oppgave til avsenderen', async () => {
    const result = await saveForNextYear(1, 'hilde@bjerke.no', NOV);
    expect(result).toEqual({ navn: 'Julebord 2027' });
    expect(prisma.contactList.create).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'Julebord 2027' } }));
    expect(prisma.contactListMembership.createMany).toHaveBeenCalledWith({ data: [{ listId: 7, contactId: 5 }], skipDuplicates: true });
    expect(prisma.inboundReply.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { savedListId: 7, savedAt: NOV, savedBy: 'hilde@bjerke.no' } });
    expect(prisma.inboundReply.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'no_reply' }) }));
    expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assigneeId: 42, dueAt: new Date('2027-08-16T06:00:00.000Z') }),
    }));
    expect(JSON.parse(settings.get('neste_aar_julebord_2027')!)).toMatchObject({ listId: 7, aar: 2027, taskId: 99, utsendelseId: 'julebord-2027' });
  });

  it('lager utkast til neste års utsendelse fra samme avsender, med tekst som må fullføres før start', async () => {
    await saveForNextYear(1, 'Claude', NOV);
    expect(createUtsendelse).toHaveBeenCalledWith({
      navn: 'Julebord 2027 – de som hadde bestilt i fjor', senderIdentityId: 3, grupper: [{ navn: 'Julebord 2027', listId: 7 }],
    });
    const step = (updateEmailStep.mock.calls as unknown as [unknown, { nodeId: number; bodyHtml: string }][])[0][1];
    expect(step.nodeId).toBe(77);
    expect(step.bodyHtml).toContain('Skriv teksten her.');
    expect(step.bodyHtml).toContain('{{fornavn}}');
    await saveForNextYear(1, 'Claude', NOV);
    expect(createUtsendelse).toHaveBeenCalledTimes(1);
  });

  it('bruker samme liste og oppgave neste gang', async () => {
    await saveForNextYear(1, 'Claude', NOV);
    prisma.inboundReply.findUnique.mockResolvedValue({ ...reply, id: 2, contactId: 6, status: 'answered' });
    await saveForNextYear(2, 'Claude', NOV);
    expect(prisma.contactList.create).toHaveBeenCalledTimes(1);
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
    // Et svar som allerede er besvart, får beholde statusen.
    expect(prisma.inboundReply.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 }, data: expect.objectContaining({ status: 'no_reply' }) }));
  });

  it('gjør ingenting når svaret allerede er spart', async () => {
    await saveForNextYear(1, 'Claude', NOV);
    vi.clearAllMocks();
    prisma.inboundReply.findUnique.mockResolvedValue({ ...reply, savedListId: 7 });
    await saveForNextYear(1, 'Claude', NOV);
    expect(prisma.contactListMembership.createMany).not.toHaveBeenCalled();
  });
});

describe('removeFromNextYear', () => {
  it('tar kontakten ut og åpner svaret igjen når det var lagringen som lukket det', async () => {
    prisma.inboundReply.findUnique.mockResolvedValue({ ...reply, status: 'no_reply', savedListId: 7, savedAt: NOV, handledAt: NOV });
    await removeFromNextYear(1, 'hilde@bjerke.no');
    expect(prisma.contactListMembership.deleteMany).toHaveBeenCalledWith({ where: { listId: 7, contactId: 5 } });
    expect(prisma.inboundReply.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'open' }) }));
  });

  it('beholder kontakten i lista når et annet svar fra dem også er spart, og rører ikke et svar som var besvart', async () => {
    prisma.inboundReply.count.mockResolvedValue(1);
    prisma.inboundReply.findUnique.mockResolvedValue({ ...reply, status: 'answered', savedListId: 7, savedAt: NOV, handledAt: new Date('2026-11-16T10:00:00Z') });
    await removeFromNextYear(1, 'hilde@bjerke.no');
    expect(prisma.contactListMembership.deleteMany).not.toHaveBeenCalled();
    expect(prisma.inboundReply.update).toHaveBeenCalledTimes(1);
  });
});

describe('påminnelser', () => {
  beforeEach(async () => {
    await saveForNextYear(1, 'hilde@bjerke.no', NOV);
    prisma.task.findUnique.mockResolvedValue({ assignee: { email: 'hilde@bjerke.no' } } as never);
    vi.clearAllMocks();
  });

  it('sender ingenting før datoen', async () => {
    expect(await sendDueReminders(new Date('2027-08-01T06:00:00Z'))).toEqual({ sent: 0 });
    expect(sendAdminEmail).not.toHaveBeenCalled();
  });

  it('sender første påminnelse én gang, med lenke som fyller ut utsendelsen', async () => {
    const aug = new Date('2027-08-16T07:00:00Z');
    expect(await sendDueReminders(aug)).toEqual({ sent: 1 });
    expect(await sendDueReminders(aug)).toEqual({ sent: 0 });
    expect(sendAdminEmail).toHaveBeenCalledTimes(1);
    const [to, subject, html] = (sendAdminEmail.mock.calls as unknown as [string, string, string][])[0];
    expect(to).toBe('hilde@bjerke.no');
    expect(subject).toContain('3 bedrifter');
    expect(html).toContain('/admin/utsendelser/julebord-2027');
    expect(html).toContain('Skriv inn dato, pris');
  });

  it('hopper over den andre når utsendelsen til lista er startet', async () => {
    getUtsendelser.mockResolvedValue([{ grupper: [{ listId: 7 }], flyter: [{ flowId: 50 }] }] as never);
    prisma.flowEnrollment.count.mockResolvedValue(12);
    expect(await sendDueReminders(new Date('2027-09-02T07:00:00Z'))).toEqual({ sent: 1 });
    expect((sendAdminEmail.mock.calls as unknown as [string, string][])[0][1]).toMatch(/^Tid for/);
  });
});

describe('oversikt og e-post', () => {
  it('uten noen spart: neste sesongs navn og 0', async () => {
    prisma.contactList.findUnique.mockResolvedValue(null as never);
    expect(await nextYearSummary(NOV)).toEqual({ navn: 'Julebord 2027', listId: null, antall: 0, paminnelse: '2027-08-16T06:00:00.000Z', utsendelse: null });
  });
  it('escaper navn i e-posten', () => {
    expect(buildReminderEmail({ navn: '<b>', antall: 1, url: 'https://x/?a=1&b=2', andre: true, utkast: false }).html).toContain('&lt;b&gt;');
  });
});

describe('flere sesonger og samtidighet', () => {
  beforeEach(() => {
    prisma.contactList.findUnique.mockImplementation((async ({ where }: { where: { id: number } }) => ({ id: where.id })) as never);
  });

  it('svar som spares i juli 2027 lager «Julebord 2028» uten å ta påminnelsene for 2027', async () => {
    await saveForNextYear(1, 'Claude', NOV);
    prisma.contactList.create.mockResolvedValueOnce({ id: 8 } as never);
    await saveForNextYear(1, 'Claude', new Date('2027-07-10T10:00:00Z'));
    expect(JSON.parse(settings.get('neste_aar_julebord_2028')!)).toMatchObject({ aar: 2028, listId: 8 });
    vi.clearAllMocks();
    expect(await sendDueReminders(new Date('2027-08-16T07:00:00Z'))).toEqual({ sent: 1 });
  });

  it('svar med spørsmål spares, men blir liggende under «Må svares»', async () => {
    await saveForNextYear(1, 'Claude', NOV, { closeOpen: false });
    expect(prisma.contactListMembership.createMany).toHaveBeenCalled();
    expect(prisma.inboundReply.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'no_reply' }) }));
  });

  it('to lagringer samtidig lager én liste, én oppgave og ett utkast', async () => {
    prisma.inboundReply.findUnique.mockImplementation((async ({ where }: { where: { id: number } }) => ({ ...reply, id: where.id, contactId: where.id + 10 })) as never);
    await Promise.all([saveForNextYear(1, 'Claude', NOV), saveForNextYear(2, 'hilde@bjerke.no', NOV)]);
    expect(prisma.contactList.create).toHaveBeenCalledTimes(1);
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
    expect(createUtsendelse).toHaveBeenCalledTimes(1);
    expect(prisma.contactListMembership.createMany).toHaveBeenCalledTimes(2);
  });
});

