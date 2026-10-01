/**
 * PATCH /api/admin/crm/flows/[id] med sendetider: lagres i Setting-tabellen
 * (flow_send_window_<id>), kan endres mens flyten kjører, valideres med
 * norske feilmeldinger, og ryddes bort når flyten slettes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    flow: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(async () => ({})) },
    flowEnrollment: { count: vi.fn() },
    setting: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@x.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));

import { PATCH, DELETE } from '@/app/api/admin/crm/flows/[id]/route';

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
