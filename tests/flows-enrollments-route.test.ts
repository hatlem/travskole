import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    flow: { findUnique: vi.fn() },
    segment: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock('@/lib/flows/enroll', () => ({
  enrollContacts: vi.fn(),
  enrollList: vi.fn(),
  enrollSegment: vi.fn(),
}));

import { POST } from '@/app/api/admin/crm/flows/[id]/enrollments/route';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { enrollContacts, enrollList, enrollSegment } from '@/lib/flows/enroll';

const SUMMARY = { enrolled: 2, skippedActive: 1, skippedSuppressed: 0, skippedNoConsent: 0, skippedMissing: 0, capped: 0 };

function call(body: unknown, id = '5') {
  const req = new NextRequest(`http://localhost/api/admin/crm/flows/${id}/enrollments`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ user: { email: 'admin@bjerke.no' } } as Awaited<ReturnType<typeof requireAdmin>>);
  prisma.flow.findUnique.mockResolvedValue({ id: 5, status: 'active', anchorMode: 'contact' });
  vi.mocked(enrollList).mockResolvedValue(SUMMARY);
});

describe('POST /api/admin/crm/flows/[id]/enrollments med listId', () => {
  it('melder inn hele listen og returnerer oppsummeringen', async () => {
    const res = await call({ listId: 3 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUMMARY);
    expect(enrollList).toHaveBeenCalledWith(5, 3, expect.objectContaining({ collect: [] }));
    expect(enrollContacts).not.toHaveBeenCalled();
    expect(enrollSegment).not.toHaveBeenCalled();
    expect(vi.mocked(logActivity).mock.calls[0][0]).toMatchObject({ action: 'enroll_list', entityId: 5 });
  });

  it('ukjent liste ⇒ 404', async () => {
    vi.mocked(enrollList).mockResolvedValue(null);
    expect((await call({ listId: 99 })).status).toBe(404);
  });

  it('listId sammen med segmentId avvises', async () => {
    expect((await call({ listId: 3, segmentId: 1 })).status).toBe(400);
    expect(enrollList).not.toHaveBeenCalled();
  });

  it('kurs-forankret flyt kan ikke fylles fra en liste', async () => {
    prisma.flow.findUnique.mockResolvedValue({ id: 5, status: 'active', anchorMode: 'course' });
    expect((await call({ listId: 3 })).status).toBe(409);
    expect(enrollList).not.toHaveBeenCalled();
  });

  it('krever admin', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    expect((await call({ listId: 3 })).status).toBe(401);
  });
});
