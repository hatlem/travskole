/** Det en ansatt kan endre selv: ny utsendelse, avsender, sendetid, ventetid, e-poster og grupper. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, store } = vi.hoisted(() => {
  const tx = {
    flow: { create: vi.fn() },
    flowNode: { create: vi.fn(), update: vi.fn() },
    flowEdge: { createMany: vi.fn(), delete: vi.fn() },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as unknown[]))),
      tx,
      senderIdentity: { findUnique: vi.fn() },
      contactList: { findUnique: vi.fn() },
      segment: { findUnique: vi.fn() },
      flowEnrollment: { count: vi.fn() },
      flow: { findUnique: vi.fn(), delete: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
      flowNode: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), update: vi.fn((a: unknown) => a), deleteMany: vi.fn((a: unknown) => a) },
      flowEdge: { findMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn((a: unknown) => a), create: vi.fn((a: unknown) => a) },
      setting: { findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    },
    store: { saved: null as unknown },
  };
});
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/flows/runner', () => ({ wakeSendWindowParked: vi.fn(async () => 0) }));
const { saveOverride, getState } = vi.hoisted(() => ({ saveOverride: vi.fn(), getState: vi.fn() }));
vi.mock('@/lib/flows/send-window-store', () => ({ saveFlowSendWindowOverride: saveOverride, getFlowSendWindowState: getState }));

import {
  addGroup, appendEmail, archiveUtsendelse, createUtsendelse, removeEmail, removeGroup, renameGroup, setWaitBefore, updateSettings,
} from '@/lib/utsendelser/edit';
import { slugify, type Utsendelse } from '@/lib/utsendelser/config';

const U: Utsendelse = {
  id: 'juletrav-2026',
  navn: 'Juletrav 2026',
  flyter: [{ flowId: 22, navn: 'Til personer' }],
  grupper: [{ id: 'prio-1', navn: 'Prioritet 1', segmentId: 2, flowId: 22 }],
};

const savedConfig = (): Utsendelse[] => JSON.parse((prisma.setting.upsert.mock.calls.at(-1)![0] as { update: { value: string } }).update.value);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.setting.findUnique.mockResolvedValue({ value: JSON.stringify([U]) });
  prisma.senderIdentity.findUnique.mockResolvedValue({ active: true });
  prisma.contactList.findUnique.mockResolvedValue({ id: 5 });
  prisma.segment.findUnique.mockResolvedValue({ id: 2 });
  prisma.flowEnrollment.count.mockResolvedValue(0);
  getState.mockResolvedValue({ global: null, override: { mode: 'default' }, effective: null });
  prisma.flow.findUnique.mockResolvedValue({ status: 'draft' });
  prisma.setting.create.mockResolvedValue({});
  prisma.setting.deleteMany.mockResolvedValue({ count: 1 });
  store.saved = null;
});

describe('saveUtsendelse', () => {
  it('nekter å lagre noe som ikke kan leses tilbake (f.eks. id «ny»)', async () => {
    const { saveUtsendelse } = await import('@/lib/utsendelser/config');
    await expect(saveUtsendelse({ ...U, id: 'ny' })).rejects.toThrow();
    await expect(saveUtsendelse({ ...U, grupper: [{ id: 'x', navn: '', segmentId: 2, flowId: 22 }] })).rejects.toThrow();
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });
});

describe('slugify', () => {
  it('lager lesbar, ledig id', () => {
    expect(slugify('Påskeløp 2027!', [])).toBe('paskelop-2027');
    expect(slugify('Juletrav 2026', ['juletrav-2026', 'juletrav-2026-2'])).toBe('juletrav-2026-3');
    expect(slugify('Ny', ['ny'])).toBe('ny-2');
  });
});

describe('createUtsendelse', () => {
  it('lager flyt med én e-post, hverdager 08–16 og grupper fra lister og segmenter', async () => {
    prisma.tx.flow.create.mockResolvedValue({ id: 40 });
    prisma.tx.flowNode.create.mockImplementation(async ({ data }: { data: { type: string } }) => ({ id: { start: 1, email: 2, end: 3 }[data.type] }));

    const u = await createUtsendelse({
      navn: 'Påskeløp 2027',
      senderIdentityId: 2,
      grupper: [{ navn: 'Kunder', listId: 5 }, { navn: 'Bedrifter', segmentId: 2 }],
    });

    expect(prisma.tx.flow.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isMarketing: true, anchorMode: 'contact' }) }));
    const emailCreate = prisma.tx.flowNode.create.mock.calls.find((c) => c[0].data.type === 'email')![0];
    expect(JSON.parse(emailCreate.data.config)).toMatchObject({ senderIdentityId: 2 });
    expect(prisma.tx.flowEdge.createMany).toHaveBeenCalledWith({ data: [{ flowId: 40, fromNodeId: 1, toNodeId: 2 }, { flowId: 40, fromNodeId: 2, toNodeId: 3 }] });
    expect(saveOverride).toHaveBeenCalledWith(40, { mode: 'custom', window: expect.objectContaining({ startHour: 8, endHour: 16, days: ['man', 'tir', 'ons', 'tor', 'fre'] }) });
    expect(u).toMatchObject({ id: 'paskelop-2027', flyter: [{ flowId: 40 }] });
    expect(u.grupper).toEqual([
      { id: 'kunder', navn: 'Kunder', flowId: 40, listId: 5 },
      { id: 'bedrifter', navn: 'Bedrifter', flowId: 40, segmentId: 2 },
    ]);
    expect(savedConfig().map((x) => x.id)).toEqual(['juletrav-2026', 'paskelop-2027']);
  });

  it('krever navn og aktiv avsender', async () => {
    await expect(createUtsendelse({ navn: '  ', senderIdentityId: 2, grupper: [] })).rejects.toMatchObject({ status: 400 });
    prisma.senderIdentity.findUnique.mockResolvedValue({ active: false });
    await expect(createUtsendelse({ navn: 'X', senderIdentityId: 9, grupper: [] })).rejects.toMatchObject({ status: 400 });
    expect(prisma.tx.flow.create).not.toHaveBeenCalled();
  });
});

describe('updateSettings', () => {
  it('bytter avsender på alle e-postene og beholder resten av innholdet', async () => {
    prisma.flowNode.findMany.mockResolvedValue([{ id: 7, config: JSON.stringify({ subject: 'Hei', bodyHtml: '<p>x</p>', senderIdentityId: 1 }) }]);
    await updateSettings(U, { senderIdentityId: 2 });
    expect(JSON.parse((prisma.flowNode.update.mock.calls[0][0] as { data: { config: string } }).data.config)).toEqual({ subject: 'Hei', bodyHtml: '<p>x</p>', senderIdentityId: 2 });
  });

  it('lagrer sendetid for alle flytene og avviser ugyldig tid', async () => {
    await updateSettings(U, { sendetid: { start: '09:00', end: '15:00', days: ['man', 'fre'] } });
    expect(saveOverride).toHaveBeenCalledWith(22, { mode: 'custom', window: expect.objectContaining({ startHour: 9, endHour: 15, days: ['man', 'fre'] }) });
    await expect(updateSettings(U, { sendetid: { start: '16:00', end: '08:00', days: ['man'] } })).rejects.toMatchObject({ status: 400 });
  });

  it('endrer navn i oppsettet', async () => {
    await updateSettings(U, { navn: 'Juletrav' });
    expect(savedConfig()[0].navn).toBe('Juletrav');
  });
});

describe('setWaitBefore', () => {
  it('endrer ventetiden før e-posten', async () => {
    prisma.flowEdge.findMany.mockResolvedValue([{ fromNodeId: 5 }]);
    prisma.flowNode.findMany.mockResolvedValue([{ id: 5, config: JSON.stringify({ days: 13 }) }]);
    await setWaitBefore(U, 22, 6, 11);
    expect(prisma.flowNode.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { config: JSON.stringify({ days: 11, hours: 0 }) } });
  });

  it('første e-post har ingen ventetid; ugyldige dager avvises', async () => {
    prisma.flowEdge.findMany.mockResolvedValue([{ fromNodeId: 1 }]);
    prisma.flowNode.findMany.mockResolvedValue([]);
    await expect(setWaitBefore(U, 22, 2, 3)).rejects.toMatchObject({ status: 400 });
    await expect(setWaitBefore(U, 22, 6, 0)).rejects.toMatchObject({ status: 400 });
    await expect(setWaitBefore(U, 99, 6, 3)).rejects.toMatchObject({ status: 404 });
  });
});

describe('appendEmail / removeEmail', () => {
  it('legger til ventetid + e-post før slutt, med samme avsender', async () => {
    prisma.flowNode.findMany
      .mockResolvedValueOnce([{ id: 9, posX: 0, posY: 480 }])
      .mockResolvedValueOnce([{ config: JSON.stringify({ senderIdentityId: 2 }) }]);
    prisma.flowEdge.findMany.mockResolvedValue([{ id: 50, fromNodeId: 8, toNodeId: 9, branch: null }]);
    prisma.tx.flowNode.create.mockImplementation(async ({ data }: { data: { type: string } }) => ({ id: data.type === 'wait' ? 60 : 61 }));

    await appendEmail(U, 22, 5);

    expect(JSON.parse(prisma.tx.flowNode.create.mock.calls[0][0].data.config)).toEqual({ days: 5, hours: 0 });
    expect(JSON.parse(prisma.tx.flowNode.create.mock.calls[1][0].data.config)).toMatchObject({ senderIdentityId: 2 });
    expect(prisma.tx.flowEdge.delete).toHaveBeenCalledWith({ where: { id: 50 } });
    expect(prisma.tx.flowEdge.createMany).toHaveBeenCalledWith({
      data: [{ flowId: 22, fromNodeId: 8, toNodeId: 60 }, { flowId: 22, fromNodeId: 60, toNodeId: 61 }, { flowId: 22, fromNodeId: 61, toNodeId: 9 }],
    });
    expect(prisma.setting.deleteMany).toHaveBeenCalledWith({ where: { key: 'utsendelse_sender_22' } });
  });

  it('forgrenet flyt (to slutter eller ja/nei-kobling) endres ikke her', async () => {
    prisma.flowNode.findMany.mockResolvedValueOnce([{ id: 9 }, { id: 10 }]);
    await expect(appendEmail(U, 22, 5)).rejects.toMatchObject({ status: 409 });
    prisma.flowNode.findMany.mockResolvedValueOnce([{ id: 9, posX: 0, posY: 0 }]);
    prisma.flowEdge.findMany.mockResolvedValue([{ id: 50, fromNodeId: 8, toNodeId: 9, branch: 'ja' }]);
    await expect(appendEmail(U, 22, 5)).rejects.toMatchObject({ status: 409 });
    expect(prisma.tx.flowEdge.delete).not.toHaveBeenCalled();
  });

  it('venter ikke på en pågående utsending: gir beskjed og endrer ingenting', async () => {
    const { Prisma } = await import('@prisma/client');
    prisma.setting.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    prisma.setting.updateMany.mockResolvedValue({ count: 0 });
    await expect(appendEmail(U, 22, 5)).rejects.toThrow(/pågår/);
    expect(prisma.flowEnrollment.count).not.toHaveBeenCalled();
  });

  it('arkivert utsendelse kan ikke endres', async () => {
    prisma.flow.findUnique.mockResolvedValue({ status: 'archived' });
    await expect(appendEmail(U, 22, 5)).rejects.toThrow(/arkivert/);
    await expect(setWaitBefore(U, 22, 6, 3)).rejects.toThrow(/arkivert/);
  });

  it('nekter å legge til eller fjerne etter at noen er sendt til', async () => {
    prisma.flowEnrollment.count.mockResolvedValue(3);
    await expect(appendEmail(U, 22, 5)).rejects.toThrow(/før du har sendt/);
    await expect(removeEmail(U, 22, 4)).rejects.toThrow(/før du har sendt/);
  });

  // start(1) → e1(2) → wait(3) → e2(4) → wait(5) → e3(6) → end(7)
  const chain = () => {
    const ids = [1, 2, 3, 4, 5, 6, 7];
    prisma.flowEdge.findMany.mockResolvedValue(ids.slice(0, -1).map((id, i) => ({ fromNodeId: id, toNodeId: ids[i + 1], branch: null })));
    prisma.flowNode.findMany.mockResolvedValue(
      ['start', 'email', 'wait', 'email', 'wait', 'email', 'end'].map((type, i) => ({ id: i + 1, type })),
    );
    prisma.flowNode.count.mockResolvedValue(3);
  };

  it('fjerner en e-post i midten sammen med ventetiden før den', async () => {
    chain();
    prisma.flowNode.findUnique.mockResolvedValue({ id: 4, flowId: 22, type: 'email' });
    await removeEmail(U, 22, 4);
    expect(prisma.flowNode.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [4, 3] } } });
    expect(prisma.flowEdge.create).toHaveBeenCalledWith({ data: { flowId: 22, fromNodeId: 2, toNodeId: 5 } });
  });

  it('fjerner første e-post sammen med ventetiden etter den', async () => {
    chain();
    prisma.flowNode.findUnique.mockResolvedValue({ id: 2, flowId: 22, type: 'email' });
    await removeEmail(U, 22, 2);
    expect(prisma.flowNode.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2, 3] } } });
    expect(prisma.flowEdge.create).toHaveBeenCalledWith({ data: { flowId: 22, fromNodeId: 1, toNodeId: 4 } });
  });

  it('siste gjenværende e-post kan ikke fjernes', async () => {
    prisma.flowNode.findUnique.mockResolvedValue({ id: 2, flowId: 22, type: 'email' });
    prisma.flowNode.count.mockResolvedValue(1);
    await expect(removeEmail(U, 22, 2)).rejects.toMatchObject({ status: 400 });
  });
});

describe('grupper', () => {
  it('legger til, gir nytt navn og fjerner', async () => {
    const added = await addGroup(U, { navn: 'Kunder', listId: 5 });
    expect(added.grupper.at(-1)).toEqual({ id: 'kunder', navn: 'Kunder', flowId: 22, listId: 5 });

    const renamed = await renameGroup(U, 'prio-1', 'Viktigste');
    expect(renamed.grupper[0].navn).toBe('Viktigste');

    const removed = await removeGroup(U, 'prio-1');
    expect(removed.grupper).toEqual([]);
  });

  it('avviser ukjent liste og flyt fra en annen utsendelse', async () => {
    prisma.contactList.findUnique.mockResolvedValue(null);
    await expect(addGroup(U, { navn: 'X', listId: 9 })).rejects.toMatchObject({ status: 404 });
    prisma.contactList.findUnique.mockResolvedValue({ id: 5 });
    await expect(addGroup(U, { navn: 'X', listId: 5, flowId: 99 })).rejects.toMatchObject({ status: 404 });
    await expect(addGroup(U, { navn: 'X' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('archiveUtsendelse', () => {
  it('arkiverer flytene og fjerner utsendelsen fra lista når ingen venter', async () => {
    prisma.flowEnrollment.count.mockResolvedValue(0);
    await archiveUtsendelse(U);
    expect(prisma.flow.updateMany).toHaveBeenCalledWith({ where: { id: { in: [22] }, status: { not: 'template' } }, data: { status: 'archived' } });
    expect(savedConfig()).toEqual([]);
  });

  it('nekter mens noen venter på flere e-poster, og slipper låsen', async () => {
    prisma.flowEnrollment.count.mockResolvedValue(12);
    await expect(archiveUtsendelse(U)).rejects.toThrow(/12 mottakere venter/);
    expect(prisma.flow.updateMany).not.toHaveBeenCalled();
    expect(prisma.setting.deleteMany).toHaveBeenCalledWith({ where: { key: 'utsendelse_sender_22' } });
  });

  it('venter ikke på en pågående utsending', async () => {
    const { Prisma } = await import('@prisma/client');
    prisma.setting.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    prisma.setting.updateMany.mockResolvedValue({ count: 0 });
    await expect(archiveUtsendelse(U)).rejects.toThrow(/pågår/);
    expect(prisma.flow.updateMany).not.toHaveBeenCalled();
  });
});
