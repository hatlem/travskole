/**
 * PATCH /api/admin/crm/flows/[id] med sendetider: lagres i Setting-tabellen
 * (flow_send_window_<id>), kan endres mens flyten kjører, valideres med
 * norske feilmeldinger, og ryddes bort når flyten slettes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    flow: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(async () => ({})) },
    flowEnrollment: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    flowNode: { findMany: vi.fn() },
    setting: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@x.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/flows/enroll', () => ({ enrollContacts: vi.fn(), enrollList: vi.fn(), enrollSegment: vi.fn() }));

import { PATCH, DELETE } from '@/app/api/admin/crm/flows/[id]/route';
import { GET as listEnrollments } from '@/app/api/admin/crm/flows/[id]/enrollments/route';
import { DEFAULT_SEND_WINDOW, sendDeferral } from '@/lib/flows/send-window';

const params = { params: Promise.resolve({ id: '9' }) };
const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/admin/crm/flows/9', {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.flow.update.mockResolvedValue({ id: 9, name: 'Kursinfo', status: 'active' });
});

describe('PATCH sendWindow', () => {
  it('«når som helst» lagres som egen rad — også mens flyten er aktiv', async () => {
    const res = await PATCH(req('PATCH', { sendWindow: { mode: 'anytime' } }), params);
    expect(res.status).toBe(200);
    expect(prisma.flow.findUnique).not.toHaveBeenCalled(); // ingen innstillingslås
    expect(prisma.setting.upsert).toHaveBeenCalledWith({
      where: { key: 'flow_send_window_9' },
      update: { value: 'anytime' },
      create: { key: 'flow_send_window_9', value: 'anytime' },
    });
    expect((await res.json()).sendWindow).toEqual({ mode: 'anytime' });
  });

  it('egne tider lagres i fast format', async () => {
    const res = await PATCH(
      req('PATCH', { sendWindow: { mode: 'custom', start: '9:00', end: '15:30', days: ['søn', 'lør'] } }),
      params,
    );
    expect(res.status).toBe(200);
    expect(prisma.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: '09:00-15:30 lør,søn' } }),
    );
    expect((await res.json()).sendWindow).toEqual({ mode: 'custom', start: '09:00', end: '15:30', days: ['lør', 'søn'] });
  });

  it('«bruk standard» sletter overstyringen', async () => {
    const res = await PATCH(req('PATCH', { sendWindow: { mode: 'default' } }), params);
    expect(res.status).toBe(200);
    expect(prisma.setting.deleteMany).toHaveBeenCalledWith({ where: { key: 'flow_send_window_9' } });
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it('ugyldige tider avvises med norsk feilmelding og lagres ikke', async () => {
    const res = await PATCH(
      req('PATCH', { sendWindow: { mode: 'custom', start: '22:00', end: '06:00', days: ['man'] } }),
      params,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/etter starttid/);
    expect(prisma.flow.update).not.toHaveBeenCalled();
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it('ingen dager valgt avvises', async () => {
    const res = await PATCH(req('PATCH', { sendWindow: { mode: 'custom', start: '08:00', end: '20:00', days: [] } }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Velg minst én dag');
  });

  it('ukjent flyt gir 404 og lagrer ingen sendetid', async () => {
    const { Prisma } = await import('@prisma/client');
    prisma.flow.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('nope', { code: 'P2025', clientVersion: 'test' }),
    );
    const res = await PATCH(req('PATCH', { sendWindow: { mode: 'anytime' } }), params);
    expect(res.status).toBe(404);
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it('uten sendWindow i body røres ikke sendetiden', async () => {
    await PATCH(req('PATCH', { name: 'Nytt navn' }), params);
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
    expect(prisma.setting.deleteMany).not.toHaveBeenCalled();
  });
});

describe('PATCH sendWindow vekker løp parkert til forrige sendetid', () => {
  const NIGHT = new Date('2026-10-01T22:00:00Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NIGHT);
    prisma.flowNode.findMany.mockResolvedValue([{ id: 12 }]);
    prisma.flowEnrollment.updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.useRealTimers());

  it('ny sendetid vekker bare løp som venter på det gamle vinduet', async () => {
    prisma.setting.findMany.mockResolvedValue([]); // standard 08–20 alle dager
    prisma.flowEnrollment.findMany.mockResolvedValue([
      { id: 1, nextRunAt: sendDeferral(NIGHT, DEFAULT_SEND_WINDOW, 1) },
      { id: 2, nextRunAt: new Date('2026-10-04T09:13:27.512Z') }, // vent-steg foran e-posten
    ]);

    const res = await PATCH(req('PATCH', { sendWindow: { mode: 'anytime' } }), params);

    expect(res.status).toBe(200);
    expect((await res.json()).wokenEnrollments).toBe(1);
    const horizon = new Date(NIGHT.getTime() + 10 * 60_000);
    expect(prisma.flowEnrollment.findMany).toHaveBeenCalledWith({
      where: { flowId: 9, status: 'active', currentNodeId: { in: [12] }, nextRunAt: { gt: horizon } },
      select: { id: true, nextRunAt: true },
    });
    expect(prisma.flowEnrollment.updateMany).toHaveBeenCalledWith({
      where: { flowId: 9, status: 'active', currentNodeId: { in: [12] }, nextRunAt: { gt: horizon }, id: { in: [1] } },
      data: { nextRunAt: NIGHT },
    });
  });

  it('samme effektive sendetid vekker ingen', async () => {
    prisma.setting.findMany.mockResolvedValue([]);
    const res = await PATCH(req('PATCH', { sendWindow: { mode: 'custom', start: '08:00', end: '20:00', days: ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'] } }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).wokenEnrollments).toBe(0);
    expect(prisma.flowEnrollment.updateMany).not.toHaveBeenCalled();
  });

  it('fra «når som helst» finnes ingen parkerte løp å vekke', async () => {
    prisma.setting.findMany.mockResolvedValue([{ key: 'flow_send_window_9', value: 'anytime' }]);
    await PATCH(req('PATCH', { sendWindow: { mode: 'default' } }), params);
    expect(prisma.flowEnrollment.findMany).not.toHaveBeenCalled();
    expect(prisma.flowEnrollment.updateMany).not.toHaveBeenCalled();
  });

  it('feil ved vekking stopper ikke lagringen', async () => {
    prisma.setting.findMany.mockResolvedValue([]);
    prisma.flowEnrollment.findMany.mockRejectedValue(new Error('db'));
    const res = await PATCH(req('PATCH', { sendWindow: { mode: 'anytime' } }), params);
    expect(res.status).toBe(200);
    expect(prisma.setting.upsert).toHaveBeenCalled();
    expect((await res.json()).wokenEnrollments).toBe(0);
  });
});

describe('DELETE rydder sendetiden', () => {
  it('sletter flytens overstyring', async () => {
    prisma.flow.findUnique.mockResolvedValue({ status: 'draft' });
    const res = await DELETE(req('DELETE'), params);
    expect(res.status).toBe(200);
    expect(prisma.setting.deleteMany).toHaveBeenCalledWith({ where: { key: 'flow_send_window_9' } });
  });

  it('feil ved opprydding stopper ikke slettingen', async () => {
    prisma.flow.findUnique.mockResolvedValue({ status: 'archived' });
    prisma.setting.deleteMany.mockRejectedValue(new Error('db'));
    const res = await DELETE(req('DELETE'), params);
    expect(res.status).toBe(200);
  });
});

describe('GET enrollments viser hvem som venter på sendetid', () => {
  const NIGHT = new Date('2026-10-01T22:00:00Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NIGHT);
  });
  afterEach(() => vi.useRealTimers());

  it('markerer parkerte e-post-løp, ikke sovende vent-noder', async () => {
    prisma.flow.findUnique.mockResolvedValue({ id: 9 });
    prisma.flowEnrollment.findMany.mockResolvedValue([
      { id: 1, status: 'active', currentNodeId: 12, nextRunAt: sendDeferral(NIGHT, DEFAULT_SEND_WINDOW, 1), contact: { id: 1, name: 'A' } },
      { id: 2, status: 'active', currentNodeId: 12, nextRunAt: new Date('2026-10-04T09:13:27.512Z'), contact: { id: 2, name: 'B' } },
    ]);
    prisma.flowEnrollment.count.mockResolvedValue(2);
    prisma.flowNode.findMany.mockResolvedValue([{ id: 12 }]);
    prisma.setting.findMany.mockResolvedValue([]);

    const res = await listEnrollments(new NextRequest('http://localhost/api/admin/crm/flows/9/enrollments'), params);
    const body = await res.json();
    expect(prisma.flowNode.findMany).toHaveBeenCalledWith({ where: { flowId: 9, type: 'email' }, select: { id: true } });
    expect(body.enrollments.map((e: { waitingForSendWindow: boolean }) => e.waitingForSendWindow)).toEqual([true, false]);
  });

  it('flyt med «når som helst» har ingen som venter på sendetid', async () => {
    prisma.flow.findUnique.mockResolvedValue({ id: 9 });
    prisma.flowEnrollment.findMany.mockResolvedValue([
      { id: 1, status: 'active', currentNodeId: 12, nextRunAt: sendDeferral(NIGHT, DEFAULT_SEND_WINDOW, 1), contact: { id: 1, name: 'A' } },
    ]);
    prisma.flowEnrollment.count.mockResolvedValue(1);
    prisma.flowNode.findMany.mockResolvedValue([{ id: 12 }]);
    prisma.setting.findMany.mockResolvedValue([{ key: 'flow_send_window_9', value: 'anytime' }]);

    const body = await (await listEnrollments(new NextRequest('http://localhost/api/admin/crm/flows/9/enrollments'), params)).json();
    expect(body.enrollments[0].waitingForSendWindow).toBe(false);
  });
});
