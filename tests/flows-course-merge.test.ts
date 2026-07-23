import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn()
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { registration: { findUnique: mockFindUnique } }
}));
vi.mock('@/lib/settings', () => ({
  getSetting: vi.fn(async () => 'post@bjerke.no')
}));

import { resolveCourseMergeContext } from '@/lib/flows/course-merge';

beforeEach(() => vi.clearAllMocks());

describe('resolveCourseMergeContext', () => {
  it('barn-kurs: fyller alle flettefelt', async () => {
    mockFindUnique.mockResolvedValue({
      child: { name: 'Ola', allergies: 'Nøtter' },
      parent: { name: 'Kari', user: { email: 'kari@x.no' } },
      course: { name: 'Ponni', startDate: new Date('2026-06-01T10:00:00Z'), endDate: new Date('2026-06-11T10:00:00Z') },
    });
    const m = await resolveCourseMergeContext(1);
    expect(m).toEqual({
      forelder_navn: 'Kari', barnets_navn: 'Ola', kurs_navn: 'Ponni',
      kurs_startdato: '01.06.2026', kurs_sluttdato: '11.06.2026',
      allergier: 'Nøtter', kontakt_epost: 'post@bjerke.no',
    });
  });
  it('voksen-kurs (uten barn): barnets_navn faller til foreldrenavn, allergier=Ingen, tom sluttdato', async () => {
    mockFindUnique.mockResolvedValue({
      child: null,
      parent: { name: 'Per', user: { email: 'per@x.no' } },
      course: { name: 'Voksenkurs', startDate: new Date('2026-06-01T10:00:00Z'), endDate: null },
    });
    const m = await resolveCourseMergeContext(2);
    expect(m).toMatchObject({ barnets_navn: 'Per', allergier: 'Ingen', kurs_sluttdato: '' });
  });
  it('manglende registrering → null', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await resolveCourseMergeContext(9)).toBeNull();
  });
});
