import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    segment: { findMany: vi.fn() },
    contactList: { update: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock('@/lib/crm/list-membership', () => ({ addContactsToList: vi.fn(), removeContactsFromList: vi.fn() }));
vi.mock('@/lib/crm/segment-members', () => ({
  SEGMENT_CONVERT_CAP: 2000,
  segmentsForContactId: vi.fn(),
  segmentMemberCounts: vi.fn(),
  convertSegmentToList: vi.fn(),
}));

import { GET as getContactSegments } from '@/app/api/admin/crm/contacts/[id]/segments/route';
import { POST as convert } from '@/app/api/admin/crm/segments/[id]/convert/route';
import { GET as listSegments } from '@/app/api/admin/crm/segments/route';
import { PATCH as renameList } from '@/app/api/admin/crm/lists/[id]/route';
import { requireAdmin } from '@/lib/auth';
import { convertSegmentToList, segmentMemberCounts, segmentsForContactId } from '@/lib/crm/segment-members';

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ user: { email: 'admin@bjerke.no' } } as Awaited<ReturnType<typeof requireAdmin>>);
});

describe('GET /api/admin/crm/contacts/[id]/segments', () => {
  it('gir kontaktens segmenter med begrunnelse', async () => {
    const segments = [{ id: 1, name: 'VIP', reasons: ['Har stikkordet «vip»'] }];
    vi.mocked(segmentsForContactId).mockResolvedValue(segments);
    const res = await getContactSegments(req('/api/admin/crm/contacts/5/segments'), params('5'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ segments });
    expect(segmentsForContactId).toHaveBeenCalledWith(5);
  });

  it('ukjent kontakt ⇒ 404, ugyldig id ⇒ 400, uten admin ⇒ 401', async () => {
    vi.mocked(segmentsForContactId).mockResolvedValue(null);
    expect((await getContactSegments(req('/x'), params('5'))).status).toBe(404);
    expect((await getContactSegments(req('/x'), params('abc'))).status).toBe(400);
    vi.mocked(requireAdmin).mockResolvedValue(null);
    expect((await getContactSegments(req('/x'), params('5'))).status).toBe(401);
  });
});

describe('POST /api/admin/crm/segments/[id]/convert', () => {
  it('lager liste med admin som aktør', async () => {
    vi.mocked(convertSegmentToList).mockResolvedValue({ ok: true, list: { id: 7, name: 'VIP (liste)' }, added: 3 });
    const res = await convert(req('/x', 'POST', {}), params('2'));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ list: { id: 7, name: 'VIP (liste)' }, added: 3 });
    expect(convertSegmentToList).toHaveBeenCalledWith(2, { name: undefined, actorEmail: 'admin@bjerke.no' });
  });

  it('godtar tom body og eget navn', async () => {
    vi.mocked(convertSegmentToList).mockResolvedValue({ ok: true, list: { id: 7, name: 'Sommerfest' }, added: 0 });
    expect((await convert(req('/x', 'POST'), params('2'))).status).toBe(201);
    await convert(req('/x', 'POST', { name: 'Sommerfest' }), params('2'));
    expect(convertSegmentToList).toHaveBeenLastCalledWith(2, { name: 'Sommerfest', actorEmail: 'admin@bjerke.no' });
  });

  it('ukjent segment ⇒ 404, for stort ⇒ 400', async () => {
    vi.mocked(convertSegmentToList).mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    expect((await convert(req('/x', 'POST', {}), params('2'))).status).toBe(404);
    vi.mocked(convertSegmentToList).mockResolvedValueOnce({ ok: false, reason: 'too_many', count: 2500 });
    const res = await convert(req('/x', 'POST', {}), params('2'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('2500');
  });

  it('validerer input og krever admin', async () => {
    expect((await convert(req('/x', 'POST', { name: 'x'.repeat(201) }), params('2'))).status).toBe(400);
    expect((await convert(req('/x', 'POST', {}), params('x'))).status).toBe(400);
    vi.mocked(requireAdmin).mockResolvedValue(null);
    expect((await convert(req('/x', 'POST', {}), params('2'))).status).toBe(401);
    expect(convertSegmentToList).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/crm/segments', () => {
  const SEGMENTS = [{ id: 1, name: 'VIP', rules: '{"all":[]}' }];

  it('uten counts beregnes ingen medlemmer', async () => {
    prisma.segment.findMany.mockResolvedValue(SEGMENTS);
    const res = await listSegments(req('/api/admin/crm/segments'));
    expect(await res.json()).toEqual({ segments: SEGMENTS });
    expect(segmentMemberCounts).not.toHaveBeenCalled();
  });

  it('med counts=1 får hvert segment memberCount', async () => {
    prisma.segment.findMany.mockResolvedValue(SEGMENTS);
    vi.mocked(segmentMemberCounts).mockResolvedValue({ 1: 4 });
    const res = await listSegments(req('/api/admin/crm/segments?counts=1'));
    expect(await res.json()).toEqual({ segments: [{ ...SEGMENTS[0], memberCount: 4 }] });
  });
});

describe('PATCH /api/admin/crm/lists/[id]', () => {
  it('gir listen nytt navn', async () => {
    prisma.contactList.update.mockResolvedValue({ id: 3, name: 'Sommerfest' });
    const res = await renameList(req('/x', 'PATCH', { name: '  Sommerfest ' }), params('3'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ list: { id: 3, name: 'Sommerfest' } });
    expect(prisma.contactList.update).toHaveBeenCalledWith({
      where: { id: 3 }, data: { name: 'Sommerfest' }, select: { id: true, name: true },
    });
  });

  it('tomt navn ⇒ 400, ukjent liste ⇒ 404', async () => {
    expect((await renameList(req('/x', 'PATCH', { name: '  ' }), params('3'))).status).toBe(400);
    prisma.contactList.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('nope', { code: 'P2025', clientVersion: 'test' }),
    );
    expect((await renameList(req('/x', 'PATCH', { name: 'Ny' }), params('3'))).status).toBe(404);
  });
});
