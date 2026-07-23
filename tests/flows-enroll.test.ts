import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { prisma } = vi.hoisted(() => ({
  prisma: { flowEnrollment: { findFirst: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { enrollCourseRegistration } from '@/lib/flows/enroll';

beforeEach(() => vi.clearAllMocks());

describe('enrollCourseRegistration', () => {
  it('oppretter enrollment med kurs-anker når ingen aktiv finnes', async () => {
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);
    prisma.flowEnrollment.create.mockResolvedValue({ id: 1 });
    expect(await enrollCourseRegistration(3, 7, 9, 42)).toBe(true);
    expect(prisma.flowEnrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flowId: 3, contactId: 7, courseId: 9, registrationId: 42, status: 'active' }) }),
    );
  });
  it('hopper over når aktiv enrollment for registreringen finnes (kode-sjekk)', async () => {
    prisma.flowEnrollment.findFirst.mockResolvedValue({ id: 1 });
    expect(await enrollCourseRegistration(3, 7, 9, 42)).toBe(false);
    expect(prisma.flowEnrollment.create).not.toHaveBeenCalled();
  });
  it('svelger P2002-race som «allerede påmeldt»', async () => {
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);
    prisma.flowEnrollment.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.0.0' }));
    expect(await enrollCourseRegistration(3, 7, 9, 42)).toBe(false);
  });
});
