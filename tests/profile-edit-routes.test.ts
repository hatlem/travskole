/**
 * Profilretting: uendret (eldre) telefonnummer blokkerer ikke andre endringer,
 * og admin-rettingen av en påmelding validerer alt før noe skrives.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma, session } = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(async (ops: unknown[]) => ops),
    user: { findUnique: vi.fn() },
    parent: { update: vi.fn(async () => ({ name: 'Kari Nordmann', phone: '1234', address: null })), create: vi.fn() },
    child: { findFirst: vi.fn(), update: vi.fn(async () => ({})) },
    registration: { findUnique: vi.fn() },
  },
  session: { user: { email: 'kari@example.no' } },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(async () => session),
  requireAdmin: vi.fn(async () => ({ user: { email: 'admin@bjerke.no' } })),
}));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/crm/bridge', () => ({ syncRegistrationToCrm: vi.fn(async () => true) }));
vi.mock('@/lib/events/bus', () => ({ emitEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));

import { PUT as dashboardPut } from '@/app/api/dashboard/route';
import { PATCH } from '@/app/api/admin/registrations/[id]/route';

const json = (body: unknown, method: string) =>
  new NextRequest('http://x', { method, body: JSON.stringify(body) });

const legacyParent = { id: 2, name: 'Kari', phone: '1234', address: null, deletedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({ id: 1, email: 'kari@example.no', parent: legacyParent });
  prisma.registration.findUnique.mockResolvedValue({
    id: 5,
    childId: 7,
    parentId: 2,
    parent: { name: 'Kari', phone: '1234', address: null },
  });
  prisma.child.findFirst.mockResolvedValue({ id: 7, name: 'Ola', birthdate: null, allergies: null });
});

describe('PUT /api/dashboard', () => {
  it('lagrer navneendring selv om lagret telefon er ugyldig', async () => {
    const res = await dashboardPut(json({ name: 'Kari Nordmann', phone: '1234' }, 'PUT'));
    expect(res.status).toBe(200);
    expect(prisma.parent.update).toHaveBeenCalled();
  });

  it('avviser et endret, ugyldig telefonnummer', async () => {
    const res = await dashboardPut(json({ name: 'Kari', phone: '5678' }, 'PUT'));
    expect(res.status).toBe(400);
    expect(prisma.parent.update).not.toHaveBeenCalled();
  });

  it('validerer telefon for ny profil', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 1, email: 'kari@example.no', parent: null });
    const res = await dashboardPut(json({ name: 'Kari', phone: '1234' }, 'PUT'));
    expect(res.status).toBe(400);
    expect(prisma.parent.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/registrations/[id]', () => {
  const patch = (body: unknown) => PATCH(json(body, 'PATCH'), { params: Promise.resolve({ id: '5' }) });

  it('retter forelderens navn uten å stoppe på eldre telefonnummer', async () => {
    const res = await patch({ parentName: 'Kari Nordmann' });
    expect(res.status).toBe(200);
    expect(prisma.parent.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { name: 'Kari Nordmann', phone: '1234', address: null },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('skriver ingenting når forelderdelen er ugyldig', async () => {
    const res = await patch({ childName: 'Ola Nordmann', parentPhone: '5678' });
    expect(res.status).toBe(400);
    expect(prisma.child.update).not.toHaveBeenCalled();
    expect(prisma.parent.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skriver ingenting når barnedelen er ugyldig', async () => {
    const res = await patch({ childBirthdate: '2999-01-01', parentName: 'Kari Nordmann' });
    expect(res.status).toBe(400);
    expect(prisma.parent.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lagrer barn og forelder i samme transaksjon', async () => {
    const res = await patch({ childName: 'Ola Nordmann', parentPhone: '12345678' });
    expect(res.status).toBe(200);
    expect(prisma.child.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { name: 'Ola Nordmann' } });
    expect(prisma.parent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: '12345678' }) })
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
