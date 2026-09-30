/** findCourseBySlug: direkte treff, og legacy-fallback kun blant kurs uten lagret slug. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    course: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));

import { findCourseBySlug } from '@/lib/course-lookup';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findCourseBySlug', () => {
  it('returnerer direkte treff uten fallback', async () => {
    prisma.course.findFirst.mockResolvedValue({ id: 1, slug: 'sommerkurs' });
    expect(await findCourseBySlug('kurs', 'sommerkurs')).toEqual({ id: 1, slug: 'sommerkurs' });
    expect(prisma.course.findMany).not.toHaveBeenCalled();
  });

  it('søker legacy-kurs kun blant rader uten slug, med minimal select', async () => {
    prisma.course.findFirst.mockResolvedValue(null);
    prisma.course.findMany.mockResolvedValue([
      { id: 4, name: 'Annet kurs' },
      { id: 5, name: 'Sommerkurs' },
    ]);
    prisma.course.findUnique.mockResolvedValue({ id: 5, name: 'Sommerkurs', slug: null });

    const course = await findCourseBySlug('kurs', 'sommerkurs');

    expect(prisma.course.findMany).toHaveBeenCalledWith({
      where: { type: 'kurs', OR: [{ slug: null }, { slug: '' }] },
      select: { id: true, name: true },
    });
    expect(prisma.course.findUnique).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(course).toEqual({ id: 5, name: 'Sommerkurs', slug: null });
  });

  it('gir null uten treff og for ugyldig type', async () => {
    prisma.course.findFirst.mockResolvedValue(null);
    prisma.course.findMany.mockResolvedValue([{ id: 4, name: 'Annet kurs' }]);
    expect(await findCourseBySlug('kurs', 'sommerkurs')).toBeNull();
    expect(prisma.course.findUnique).not.toHaveBeenCalled();
    expect(await findCourseBySlug('Kurs!', 'x')).toBeNull();
  });
});
