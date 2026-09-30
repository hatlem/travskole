import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = vi.hoisted(() => ({
  course: { findMany: vi.fn() },
  registration: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  setting: { findUnique: vi.fn(async (): Promise<{ key: string; value: string } | null> => null) },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@x.no' } })) }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));
const logActivity = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/activity', () => ({ logActivity }));

import { GET as exportCourses } from '@/app/api/admin/courses/export/route';
import { GET as exportRegistrations } from '@/app/api/admin/registrations/export/route';
import { GET as exportUsers } from '@/app/api/admin/users/export/route';

const created = new Date('2026-03-01T10:00:00Z');

beforeEach(() => vi.clearAllMocks());

async function csvOf(res: Response) {
  expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return new TextDecoder('utf-8').decode(bytes).split('\n');
}

describe('admin CSV exports', () => {
  it('courses: keeps æøå and translates status', async () => {
    prisma.course.findMany.mockResolvedValue([{
      id: 1, name: 'Ponniskole høst', type: 'kurs', status: 'open', startDate: created, endDate: null,
      ageMin: 6, ageMax: 12, price: 1500, maxParticipants: 10, createdAt: created, _count: { registrations: 3 },
    }]);
    const [header, row] = await csvOf(await exportCourses());
    expect(header).toContain('Påmeldinger (aktive)');
    expect(row).toBe('1,Ponniskole høst,Kurs,Åpen,01.03.2026,,6–12,1500,10,3,01.03.2026');
  });

  it('courses: type labels come from the course_types setting (incl. arrangement)', async () => {
    prisma.setting.findUnique.mockResolvedValueOnce({ key: 'course_types', value: 'kurs|Kurs|kurs\narrangement|Arrangement|arrangementer\nfest|Firmafest|firmafester' });
    prisma.course.findMany.mockResolvedValue(
      (['arrangement', 'fest', 'ukjent'] as const).map((type, i) => ({
        id: i + 1, name: 'X', type, status: 'open', startDate: null, endDate: null,
        ageMin: null, ageMax: null, price: null, maxParticipants: null, createdAt: created, _count: { registrations: 0 },
      })),
    );
    const [, ...rows] = await csvOf(await exportCourses());
    expect(rows.map((r) => r.split(',')[2])).toEqual(['Arrangement', 'Firmafest', 'Ukjent']);
  });

  it('registrations: Norwegian headers and status labels', async () => {
    prisma.registration.findMany.mockResolvedValue([{
      id: 7, status: 'waitlist', consentActivities: true, consentMedia: false, consentRisk: true, createdAt: created,
      course: { name: 'Sommerleir' },
      child: { name: 'Åse Ødegård', birthdate: new Date('2018-05-04T00:00:00Z'), allergies: null },
      parent: { name: 'Kåre', phone: '12345678', user: { email: 'k@x.no' } },
    }]);
    const [header, row] = await csvOf(await exportRegistrations());
    expect(header).toContain('Fødselsdato');
    expect(row).toBe('7,Sommerleir,Åse Ødegård,04.05.2018,Kåre,k@x.no,12345678,,Venteliste,Ja,Nei,Ja,01.03.2026');
  });

  it('users: translated roles', async () => {
    prisma.user.findMany.mockResolvedValue([{
      id: 2, email: 'b@x.no', role: 'superadmin', createdAt: created, parent: { name: 'Bjørn', phone: null, address: null },
    }]);
    const [, row] = await csvOf(await exportUsers());
    expect(row).toBe('2,b@x.no,Bjørn,,,Superadmin,01.03.2026');
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'export', entity: 'user', details: '{"rows":1}' }));
  });
});
