import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = vi.hoisted(() => ({
  course: { findMany: vi.fn(), findUnique: vi.fn() },
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
import { NextRequest } from 'next/server';

const exportReq = (query = '') => new NextRequest(`http://x/api/admin/registrations/export${query}`);

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
    expect(row).toBe('1;Ponniskole høst;Kurs;Åpen;01.03.2026;;6–12;1500;10;3;01.03.2026');
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
    expect(rows.map((r) => r.split(';')[2])).toEqual(['Arrangement', 'Firmafest', 'Ukjent']);
  });

  it('registrations: Norwegian headers and status labels', async () => {
    prisma.registration.findMany.mockResolvedValue([{
      id: 7, status: 'waitlist', paymentStatus: 'none', paymentProvider: null,
      consentActivities: true, consentMedia: false, consentRisk: true, createdAt: created,
      course: { name: 'Sommerleir', price: 1500, paymentMethods: 'faktura' },
      child: { name: 'Åse Ødegård', birthdate: new Date('2018-05-04T00:00:00Z'), allergies: 'Nøtter' },
      parent: { name: 'Kåre', phone: '12345678', user: { email: 'k@x.no' } },
    }]);
    const [header, row] = await csvOf(await exportRegistrations(exportReq()));
    expect(header).toBe(
      'ID;Kurs;Deltaker;Fødselsdato;Allergier og hensyn;Foresatt;E-post;Telefon;Status;Betalt;Betalingsmåte;Beløp (kr);Samtykke aktiviteter;Samtykke bilder/video;Samtykke risiko;Påmeldt',
    );
    expect(row).toBe('7;Sommerleir;Åse Ødegård;04.05.2018;Nøtter;Kåre;k@x.no;123 45 678;Venteliste;Nei;Faktura;1500;Ja;Nei;Ja;01.03.2026');
  });

  it('registrations: payment columns for online payments and refunds', async () => {
    const base = {
      status: 'confirmed', consentActivities: false, consentMedia: false, consentRisk: true, createdAt: created,
      course: { name: 'Leir', price: 2490.5, paymentMethods: 'faktura,stripe,vipps' },
      child: null, parent: { name: 'Kari', phone: '+4790000001', user: { email: 'kari@x.no' } },
    };
    prisma.registration.findMany.mockResolvedValue([
      { ...base, id: 1, paymentStatus: 'paid', paymentProvider: 'vipps' },
      { ...base, id: 2, paymentStatus: 'refunded', paymentProvider: 'stripe' },
      { ...base, id: 3, paymentStatus: 'none', paymentProvider: null },
    ]);
    const [, ...rows] = await csvOf(await exportRegistrations(exportReq()));
    const cols = rows.map((r) => r.split(';'));
    expect(cols.map((c) => [c[2], c[7], c[9], c[10], c[11]])).toEqual([
      ['Kari (voksen)', '900 00 001', 'Ja', 'Vipps', '2490,5'],
      ['Kari (voksen)', '900 00 001', 'Refundert', 'Kort', '2490,5'],
      ['Kari (voksen)', '900 00 001', 'Nei', '', '2490,5'],
    ]);
  });

  it('registrations: ?courseId= exports only that course, named after it', async () => {
    prisma.course.findUnique.mockResolvedValue({ name: "Ponniskole høst" });
    prisma.registration.findMany.mockResolvedValue([]);
    const res = await exportRegistrations(exportReq('?courseId=9'));
    expect(prisma.registration.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ courseId: 9 }),
    }));
    expect(res.headers.get('Content-Disposition')).toMatch(/filename="deltakere-ponniskole-host-\d{4}-\d{2}-\d{2}\.csv"/);
  });

  it('registrations: 404 for an unknown course', async () => {
    prisma.course.findUnique.mockResolvedValue(null);
    const res = await exportRegistrations(exportReq('?courseId=404'));
    expect(res.status).toBe(404);
  });

  it('users: translated roles', async () => {
    prisma.user.findMany.mockResolvedValue([{
      id: 2, email: 'b@x.no', role: 'superadmin', createdAt: created, parent: { name: 'Bjørn', phone: null, address: null },
    }]);
    const [, row] = await csvOf(await exportUsers());
    expect(row).toBe('2;b@x.no;Bjørn;;;Superadmin;01.03.2026');
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'export', entity: 'user', details: '{"rows":1}' }));
  });

  it('users: Excel-ready with Norwegian headers and phone numbers Excel keeps', async () => {
    prisma.user.findMany.mockResolvedValue([{
      id: 3, email: 'k@x.no', role: 'parent', createdAt: created,
      parent: { name: 'Kari', phone: '+4790000001', address: 'Storgata 1; 0155 Oslo' },
    }]);
    const [header, row] = await csvOf(await exportUsers());
    expect(header).toBe('ID;E-post;Navn;Telefon;Adresse;Rolle;Registrert');
    expect(row).toBe('3;k@x.no;Kari;900 00 001;"Storgata 1; 0155 Oslo";Forelder;01.03.2026');
  });
});
