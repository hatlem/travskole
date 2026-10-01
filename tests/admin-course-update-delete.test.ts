import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma, mail } = vi.hoisted(() => ({
  prisma: {
    course: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(async () => ({ id: 9 })) },
    registration: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    bookingRequest: { count: vi.fn(async () => 0) },
    deal: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
  mail: { sendWaitlistPromotionEmail: vi.fn(async () => {}) },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/mail', () => mail);
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@bjerke.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));

import { PUT, PATCH, DELETE } from '@/app/api/admin/courses/[id]/route';

const params = { params: Promise.resolve({ id: '9' }) };
const putReq = (body: unknown) =>
  new NextRequest('http://x/api/admin/courses/9', { method: 'PUT', body: JSON.stringify(body) });
const deleteReq = () => new NextRequest('http://x/api/admin/courses/9', { method: 'DELETE' });

const BODY = { name: 'Ponnikurs', type: 'kurs', status: 'open', startDate: '2026-06-15', maxParticipants: 5 };

function stored(status: string, maxParticipants: number | null) {
  prisma.course.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 9, ...data }));
  prisma.course.findUnique.mockResolvedValue({ id: 9, name: 'Ponnikurs', status, maxParticipants });
}

function counts(occupied: number, waiting: number) {
  prisma.registration.count.mockImplementation(async ({ where }: { where: { status: unknown } }) =>
    where.status === 'waitlist' ? waiting : occupied,
  );
}

const statusUpdates = () =>
  (prisma.course.update.mock.calls as unknown as Array<[{ data: { status?: string; name?: string } }]>)
    .filter(([arg]) => arg.data.name === undefined)
    .map(([arg]) => arg.data.status);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.registration.updateMany.mockResolvedValue({ count: 1 });
});

describe('PUT /api/admin/courses/[id] — capacity status', () => {
  it('marks an open course full when max is lowered to the occupied count', async () => {
    stored('open', 5);
    counts(5, 0);
    const res = await PUT(putReq(BODY), params);
    expect(statusUpdates()).toEqual(['full']);
    expect((await res.json()).course.status).toBe('full');
  });

  it('reopens a full course when max is raised and nobody waits', async () => {
    stored('full', 8);
    counts(5, 0);
    const res = await PUT(putReq({ ...BODY, status: 'full', maxParticipants: 8 }), params);
    expect(statusUpdates()).toEqual(['open']);
    expect((await res.json()).course.status).toBe('open');
  });

  it('promotes the waitlist into the new seats when max is raised', async () => {
    stored('full', 7);
    counts(5, 3);
    prisma.registration.findMany.mockResolvedValue([
      { id: 11, parent: { name: 'Kari', user: { email: 'k@x.no' } }, child: { name: 'Ola' } },
      { id: 12, parent: { name: 'Per', user: { email: 'p@x.no' } }, child: null },
    ]);
    const res = await PUT(putReq({ ...BODY, status: 'full', maxParticipants: 7 }), params);
    expect(prisma.registration.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(prisma.registration.updateMany).toHaveBeenCalledTimes(2);
    expect(mail.sendWaitlistPromotionEmail).toHaveBeenCalledTimes(2);
    expect(statusUpdates()).toEqual([]);
    expect((await res.json()).course.status).toBe('full');
  });

  it('never overrides an admin-set closed status', async () => {
    stored('closed', 2);
    counts(5, 0);
    const res = await PUT(putReq({ ...BODY, status: 'closed', maxParticipants: 2 }), params);
    expect(statusUpdates()).toEqual([]);
    expect((await res.json()).course.status).toBe('closed');
  });

  it('keeps a draft a draft whatever the capacity', async () => {
    stored('draft', 2);
    counts(0, 3);
    const res = await PUT(putReq({ ...BODY, status: 'draft', maxParticipants: 2 }), params);
    expect(statusUpdates()).toEqual([]);
    expect((await res.json()).course.status).toBe('draft');
  });

  it('refuses to turn a course with registrations back into a draft', async () => {
    stored('open', 5);
    counts(2, 0);
    const res = await PUT(putReq({ ...BODY, status: 'draft' }), params);
    expect(res.status).toBe(409);
    expect(prisma.course.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/courses/[id]', () => {
  beforeEach(() => prisma.course.findUnique.mockResolvedValue({ id: 9 }));

  it('refuses with 409 when registrations have settled payments', async () => {
    prisma.registration.count.mockResolvedValue(2);
    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/2 påmeldinger har betalt.*«Stengt»/);
    expect(prisma.registration.count).toHaveBeenCalledWith({
      where: { courseId: 9, paymentStatus: { in: ['paid', 'partially_refunded', 'refunded'] } },
    });
    expect(prisma.course.delete).not.toHaveBeenCalled();
  });

  it('deletes a course without settled payments', async () => {
    prisma.registration.count.mockResolvedValue(0);
    prisma.registration.findMany.mockResolvedValue([]);
    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(200);
    expect(prisma.course.delete).toHaveBeenCalledWith({ where: { id: 9 } });
  });

  it('removes the sales-board deals of the course registrations in the same transaction', async () => {
    prisma.registration.count.mockResolvedValue(0);
    prisma.registration.findMany.mockResolvedValue([{ id: 31 }, { id: 32 }]);
    prisma.deal.deleteMany.mockResolvedValueOnce({ count: 2 });
    const res = await DELETE(deleteReq(), params);
    expect(prisma.deal.deleteMany).toHaveBeenCalledWith({ where: { registrationId: { in: [31, 32] } } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect((await res.json()).dealsRemoved).toBe(2);
  });

  it('never touches deals when the delete is refused', async () => {
    prisma.registration.count.mockResolvedValue(1);
    await DELETE(deleteReq(), params);
    expect(prisma.deal.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown course', async () => {
    prisma.course.findUnique.mockResolvedValue(null);
    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(404);
    expect(prisma.course.delete).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/courses/[id] — publish', () => {
  const patchReq = (body: unknown) =>
    new NextRequest('http://x/api/admin/courses/9', { method: 'PATCH', body: JSON.stringify(body) });

  it('opens a draft course and settles capacity', async () => {
    prisma.course.findUnique
      .mockResolvedValueOnce({ id: 9, name: 'Ponnikurs', status: 'draft', maxParticipants: 5 })
      .mockResolvedValue({ id: 9, name: 'Ponnikurs', status: 'open', maxParticipants: 5 });
    prisma.course.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 9, ...data }));
    counts(0, 0);
    const res = await PATCH(patchReq({ status: 'open' }), params);
    expect(res.status).toBe(200);
    expect(prisma.course.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { status: 'open' } });
    expect((await res.json()).course.status).toBe('open');
  });

  it('refuses to unpublish a course that has booking requests', async () => {
    stored('open', null);
    counts(0, 0);
    prisma.bookingRequest.count.mockResolvedValueOnce(1);
    const res = await PATCH(patchReq({ status: 'draft' }), params);
    expect(res.status).toBe(409);
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('rejects unknown statuses', async () => {
    const res = await PATCH(patchReq({ status: 'archived' }), params);
    expect(res.status).toBe(400);
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('404s for an unknown course', async () => {
    prisma.course.findUnique.mockResolvedValue(null);
    const res = await PATCH(patchReq({ status: 'open' }), params);
    expect(res.status).toBe(404);
  });
});
