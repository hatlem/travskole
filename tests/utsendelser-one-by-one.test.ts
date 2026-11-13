/** Én og én: send til én person, ta ut, flytt, og egen tekst per person. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, mocks } = vi.hoisted(() => {
  const prisma = {
    flow: { findUnique: vi.fn() },
    flowNode: { findUnique: vi.fn() },
    flowEnrollment: { count: vi.fn(), updateMany: vi.fn() },
    contact: { findUnique: vi.fn() },
    messageSend: { count: vi.fn() },
    setting: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    utsendelseRecipient: { upsert: vi.fn(), deleteMany: vi.fn() },
    flowMessageOverride: { upsert: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  return { prisma, mocks: { enrollContacts: vi.fn(), activateDraftFlow: vi.fn(), loadAudience: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/flows/enroll', () => ({ enrollContacts: mocks.enrollContacts, SEGMENT_ENROLL_CAP: 500 }));
vi.mock('@/lib/flows/activation', () => ({ activateDraftFlow: mocks.activateDraftFlow }));
vi.mock('@/lib/utsendelser/audience', () => ({ loadAudience: mocks.loadAudience }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => '') }));

import { sendOne, UtsendelseError } from '@/lib/utsendelser/actions';
import { excludeRecipient, includeRecipient, moveRecipient } from '@/lib/utsendelser/recipients';
import { removeOverride, saveOverride } from '@/lib/utsendelser/one-by-one';
import type { Utsendelse } from '@/lib/utsendelser/config';

const U: Utsendelse = {
  id: 'juletrav-2026',
  navn: 'Juletrav 2026',
  flyter: [{ flowId: 22, navn: 'Til personer' }, { flowId: 23, navn: 'Til firmaadresser' }],
  grupper: [
    { id: 'prio-1', navn: 'Prioritet 1', segmentId: 2, flowId: 22 },
    { id: 'prio-2', navn: 'Prioritet 2', segmentId: 3, flowId: 22 },
    { id: 'firma', navn: 'Firmaadresser', listId: 9, flowId: 23 },
  ],
};

const audience = (ids: number[], reachable = ids) =>
  new Map([['prio-1', { ids, reachable: new Set(reachable), excluded: [], movedIn: new Set<number>() }]]);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.setting.create.mockResolvedValue({});
  prisma.setting.deleteMany.mockResolvedValue({ count: 1 });
  prisma.flow.findUnique.mockResolvedValue({ id: 22, status: 'active', nodes: [], edges: [] });
  prisma.flowEnrollment.count.mockResolvedValue(0);
  prisma.flowEnrollment.updateMany.mockResolvedValue({ count: 0 });
  prisma.contact.findUnique.mockResolvedValue({ id: 5, source: 'import' });
  prisma.messageSend.count.mockResolvedValue(0);
  mocks.loadAudience.mockResolvedValue(audience([5, 6]));
  mocks.enrollContacts.mockResolvedValue({ enrolled: 1 });
});

describe('sendOne', () => {
  it('sender til akkurat den ene personen og slipper låsen etterpå', async () => {
    await sendOne(U, 'prio-1', 5);
    expect(mocks.enrollContacts).toHaveBeenCalledWith(22, [5]);
    expect(prisma.setting.deleteMany).toHaveBeenCalledWith({ where: { key: 'utsendelse_sender_22' } });
  });

  it('nekter når personen allerede har fått utsendelsen', async () => {
    prisma.flowEnrollment.count.mockResolvedValue(1);
    await expect(sendOne(U, 'prio-1', 5)).rejects.toThrow('allerede fått');
    expect(mocks.enrollContacts).not.toHaveBeenCalled();
  });

  it('nekter når personen ikke er i gruppen eller ikke kan få e-post', async () => {
    await expect(sendOne(U, 'prio-1', 99)).rejects.toThrow('ikke lenger i denne gruppen');
    mocks.loadAudience.mockResolvedValue(audience([5], []));
    await expect(sendOne(U, 'prio-1', 5)).rejects.toThrow('kan ikke få e-post');
    expect(mocks.enrollContacts).not.toHaveBeenCalled();
  });

  it('nekter mens en annen utsending pågår', async () => {
    const { Prisma } = await import('@prisma/client');
    prisma.setting.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }));
    prisma.setting.updateMany.mockResolvedValue({ count: 0 });
    await expect(sendOne(U, 'prio-1', 5)).rejects.toThrow('pågår');
  });
});

describe('ta ut og flytt', () => {
  it('ta ut: lagres og stopper e-postene som er på vei', async () => {
    prisma.flowEnrollment.updateMany.mockResolvedValue({ count: 1 });
    const result = await excludeRecipient(U, 5, 'hilde@bjerke.no');
    expect(prisma.utsendelseRecipient.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { utsendelseId: 'juletrav-2026', contactId: 5, groupId: null, updatedBy: 'hilde@bjerke.no' },
    }));
    expect(prisma.flowEnrollment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { flowId: { in: [22, 23] }, contactId: 5, status: 'active' },
    }));
    expect(result).toEqual({ stopped: 1 });
  });

  it('ta med igjen sletter bare «tatt ut», ikke en flytting', async () => {
    await includeRecipient(U, 5);
    expect(prisma.utsendelseRecipient.deleteMany).toHaveBeenCalledWith({ where: { utsendelseId: 'juletrav-2026', contactId: 5, groupId: null } });
  });

  it('flytt: lagrer gruppen og fjerner egne tekster fra e-poster personen ikke lenger får', async () => {
    await moveRecipient(U, 5, 'firma', 'hilde@bjerke.no');
    expect(prisma.utsendelseRecipient.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { groupId: 'firma', updatedBy: 'hilde@bjerke.no' } }));
    expect(prisma.flowMessageOverride.deleteMany).toHaveBeenCalledWith({ where: { contactId: 5, node: { flowId: { in: [22] } } } });
  });

  it('flytt nektes når personen allerede har fått e-post', async () => {
    prisma.flowEnrollment.count.mockResolvedValue(1);
    await expect(moveRecipient(U, 5, 'prio-2', 'h')).rejects.toBeInstanceOf(UtsendelseError);
    expect(prisma.utsendelseRecipient.upsert).not.toHaveBeenCalled();
  });

  it('ukjent gruppe eller systemkontakt gir 404', async () => {
    await expect(moveRecipient(U, 5, 'finnes-ikke', 'h')).rejects.toMatchObject({ status: 404 });
    prisma.contact.findUnique.mockResolvedValue({ id: 5, source: 'system' });
    await expect(excludeRecipient(U, 5, 'h')).rejects.toMatchObject({ status: 404 });
  });
});

describe('egen tekst', () => {
  beforeEach(() => {
    prisma.flowNode.findUnique.mockResolvedValue({ flowId: 22, type: 'email', flow: { status: 'active' } });
  });

  it('lagrer sanert tekst for personen', async () => {
    await saveOverride(U, { contactId: 5, nodeId: 40, subject: '  Hei Kari ', bodyHtml: '<p onclick="x()">Hei</p><script>x</script>' }, 'hilde@bjerke.no');
    expect(prisma.flowMessageOverride.upsert).toHaveBeenCalledWith({
      where: { nodeId_contactId: { nodeId: 40, contactId: 5 } },
      create: { nodeId: 40, contactId: 5, subject: 'Hei Kari', bodyHtml: '<p>Hei</p>', updatedBy: 'hilde@bjerke.no' },
      update: { subject: 'Hei Kari', bodyHtml: '<p>Hei</p>', updatedBy: 'hilde@bjerke.no' },
    });
  });

  it('nekter tom tekst, sendt e-post og e-post fra en annen utsendelse', async () => {
    await expect(saveOverride(U, { contactId: 5, nodeId: 40, subject: 'Hei', bodyHtml: '<p> </p>' }, 'h')).rejects.toThrow('tom');
    prisma.messageSend.count.mockResolvedValueOnce(1);
    await expect(saveOverride(U, { contactId: 5, nodeId: 40, subject: 'Hei', bodyHtml: '<p>x</p>' }, 'h')).rejects.toThrow('allerede sendt');
    prisma.flowNode.findUnique.mockResolvedValueOnce({ flowId: 77, type: 'email', flow: { status: 'active' } });
    await expect(removeOverride(U, 5, 40)).rejects.toMatchObject({ status: 404 });
    expect(prisma.flowMessageOverride.upsert).not.toHaveBeenCalled();
  });

  it('tilbake til fellesteksten sletter den egne teksten', async () => {
    await removeOverride(U, 5, 40);
    expect(prisma.flowMessageOverride.deleteMany).toHaveBeenCalledWith({ where: { nodeId: 40, contactId: 5 } });
  });
});
