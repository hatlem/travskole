import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma, mail } = vi.hoisted(() => ({
  prisma: {
    registration: { findUnique: vi.fn(), count: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
    course: { findUnique: vi.fn(), update: vi.fn() },
  },
  mail: { sendWaitlistPromotionEmail: vi.fn(async () => {}) },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/mail', () => mail);
vi.mock('@/lib/events/bus', () => ({ emitEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@x.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/crm/bridge', () => ({ syncRegistrationToCrm: vi.fn(async () => true) }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));

import { promoteFromWaitlist } from '@/lib/registrations/cancel';
import { DELETE } from '@/app/api/admin/registrations/[id]/route';

const waitlisted = (id: number) => ({
  id,
  parent: { name: 'Kari', user: { email: `k${id}@x.no` } },
  child: { name: `Barn ${id}` },
});

function counts(occupied: number, waiting: number) {
  prisma.registration.count.mockImplementation(async ({ where }: { where: { status: unknown } }) =>
    where.status === 'waitlist' ? waiting : occupied,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.registration.findUnique.mockResolvedValue({ courseId: 9 });
  prisma.course.findUnique.mockResolvedValue({ id: 9, name: 'Kursadmin', status: 'full', maxParticipants: 1 });
});

describe('promoteFromWaitlist', () => {
  it('reopens the course when the only seat is cancelled and nobody waits', async () => {
    counts(0, 0);
    await promoteFromWaitlist(5);
    expect(prisma.registration.update).not.toHaveBeenCalled();
    expect(prisma.course.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { status: 'open' } });
  });

  it('promotes the first waitlisted into the freed seat and keeps the course full', async () => {
    counts(0, 2);
    prisma.registration.findMany.mockResolvedValue([waitlisted(11)]);
    await promoteFromWaitlist(5);
    expect(prisma.registration.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
    expect(prisma.registration.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { status: 'pending' } });
    expect(mail.sendWaitlistPromotionEmail).toHaveBeenCalledTimes(1);
    expect(prisma.course.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/registrations/[id]', () => {
  const del = () => DELETE(new NextRequest('http://x', { method: 'DELETE' }), { params: Promise.resolve({ id: '5' }) });

  it('frees the seat of a deleted place-occupying registration', async () => {
    prisma.registration.delete.mockResolvedValue({ courseId: 9, status: 'confirmed' });
    counts(0, 0);
    expect((await del()).status).toBe(200);
    expect(prisma.course.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { status: 'open' } });
  });

  it('does not touch the course when a waitlisted registration is deleted', async () => {
    prisma.registration.delete.mockResolvedValue({ courseId: 9, status: 'waitlist' });
    await del();
    expect(prisma.course.findUnique).not.toHaveBeenCalled();
  });
});
