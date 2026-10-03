import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma, emitEvent } = vi.hoisted(() => ({
  prisma: {
    contact: { findUnique: vi.fn() },
    suppression: { upsert: vi.fn() },
    consent: { upsert: vi.fn() },
    flow: { findUnique: vi.fn(), update: vi.fn() },
    flowEnrollment: { updateMany: vi.fn(async () => ({ count: 2 })), count: vi.fn() },
  },
  emitEvent: vi.fn(async () => {}),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/events/bus', () => ({ emitEvent }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@x.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));

import { applyUnsubscribe } from '@/lib/flows/unsubscribe';
import { PATCH } from '@/app/api/admin/crm/flows/[id]/route';

const params = { params: Promise.resolve({ id: '1' }) };
const patch = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/crm/flows/1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => vi.clearAllMocks());

describe('applyUnsubscribe', () => {
  it('exits only active enrollments in marketing flows', async () => {
    prisma.contact.findUnique.mockResolvedValue({ id: 3, email: 'Kari@X.no' });
    await expect(applyUnsubscribe(3)).resolves.toBe('ok');
    expect(prisma.flowEnrollment.updateMany).toHaveBeenCalledWith({
      where: { contactId: 3, flow: { isMarketing: true }, status: 'active' },
      data: { status: 'exited', finishedAt: expect.any(Date) },
    });
  });

  it.each(['bounce', 'complaint', 'manual', 'unsubscribe'])('beholder eksisterende sperreårsak «%s»', async (reason) => {
    const rows = new Map<string, { email: string; reason: string }>([['kari@x.no', { email: 'kari@x.no', reason }]]);
    prisma.suppression.upsert.mockImplementation(async (args: {
      where: { email: string };
      create: { email: string; reason: string };
      update: Partial<{ reason: string }>;
    }) => {
      const existing = rows.get(args.where.email);
      const next = existing ? { ...existing, ...args.update } : args.create;
      rows.set(args.where.email, next);
      return next;
    });
    prisma.contact.findUnique.mockResolvedValue({ id: 3, email: 'Kari@X.no' });
    await applyUnsubscribe(3);
    expect(rows.get('kari@x.no')?.reason).toBe(reason);
  });

  it('oppretter sperre med årsak «unsubscribe» når ingen finnes', async () => {
    prisma.contact.findUnique.mockResolvedValue({ id: 3, email: 'Kari@X.no' });
    await applyUnsubscribe(3);
    expect(prisma.suppression.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: 'kari@x.no' },
      create: { email: 'kari@x.no', reason: 'unsubscribe' },
    }));
  });

  it('touches nothing for unknown contacts', async () => {
    prisma.contact.findUnique.mockResolvedValue(null);
    await expect(applyUnsubscribe(3)).resolves.toBe('not_found');
    expect(prisma.flowEnrollment.updateMany).not.toHaveBeenCalled();
  });
});

describe('PATCH flow status → archived', () => {
  it('exits every active enrollment in the archived flow', async () => {
    prisma.flow.findUnique.mockResolvedValue({ status: 'active', anchorMode: 'contact' });
    prisma.flow.update.mockResolvedValue({ id: 1, status: 'archived' });
    const res = await PATCH(patch({ status: 'archived' }), params);
    expect(res.status).toBe(200);
    expect(prisma.flowEnrollment.updateMany).toHaveBeenCalledWith({
      where: { flowId: 1, status: 'active' },
      data: { status: 'exited', finishedAt: expect.any(Date) },
    });
    expect((await res.json()).exitedEnrollments).toBe(2);
  });

  it('archiving a draft exits the people parked while waiting for activation', async () => {
    prisma.flow.findUnique.mockResolvedValue({ status: 'draft', anchorMode: 'contact' });
    prisma.flow.update.mockResolvedValue({ id: 1, status: 'archived' });
    const res = await PATCH(patch({ status: 'archived' }), params);
    expect(res.status).toBe(200);
    // Parkerte løp har status 'active' (bare nextRunAt langt frem), så de fanges av samme avslutning.
    expect(prisma.flowEnrollment.updateMany).toHaveBeenCalledWith({
      where: { flowId: 1, status: 'active' },
      data: { status: 'exited', finishedAt: expect.any(Date) },
    });
  });

  it('leaves enrollments alone on pause', async () => {
    prisma.flow.findUnique.mockResolvedValue({ status: 'active', anchorMode: 'contact' });
    prisma.flow.update.mockResolvedValue({ id: 1, status: 'paused' });
    await PATCH(patch({ status: 'paused' }), params);
    expect(prisma.flowEnrollment.updateMany).not.toHaveBeenCalled();
  });
});
