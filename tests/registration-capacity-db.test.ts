import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = vi.hoisted(() => ({
  registration: { count: vi.fn() },
  course: { update: vi.fn(), findMany: vi.fn(async () => []) },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@bjerke.no' } })) }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));

import { markCourseFullIfAtCapacity, occupiedRegistrationsCount } from '@/lib/registrations/capacity';
import { GET as listCourses } from '@/app/api/admin/courses/route';
import { GET as exportCourses } from '@/app/api/admin/courses/export/route';

const OCCUPYING = { status: { in: ['pending', 'confirmed'] } };

beforeEach(() => vi.clearAllMocks());

describe('markCourseFullIfAtCapacity', () => {
  it('marks an open course full when place-occupying registrations reach the max', async () => {
    prisma.registration.count.mockResolvedValue(10);
    await markCourseFullIfAtCapacity({ id: 9, status: 'open', maxParticipants: 10 });
    expect(prisma.registration.count).toHaveBeenCalledWith({ where: { courseId: 9, ...OCCUPYING } });
    expect(prisma.course.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { status: 'full' } });
  });

  it('leaves the course open below capacity, and ignores closed/unlimited courses', async () => {
    prisma.registration.count.mockResolvedValue(9);
    await markCourseFullIfAtCapacity({ id: 9, status: 'open', maxParticipants: 10 });
    await markCourseFullIfAtCapacity({ id: 9, status: 'closed', maxParticipants: 10 });
    await markCourseFullIfAtCapacity({ id: 9, status: 'open', maxParticipants: null });
    expect(prisma.course.update).not.toHaveBeenCalled();
  });
});

describe('admin course counts exclude cancelled and waitlisted registrations', () => {
  it('uses the occupied-places filter in the course list and CSV export', async () => {
    await listCourses();
    await exportCourses();
    for (const call of prisma.course.findMany.mock.calls as unknown as Array<[{ include: unknown }]>) {
      expect(call[0].include).toEqual(occupiedRegistrationsCount);
    }
    expect(occupiedRegistrationsCount._count.select.registrations.where).toEqual(OCCUPYING);
  });
});
