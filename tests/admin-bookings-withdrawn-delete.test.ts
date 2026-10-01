import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = vi.hoisted(() => ({
  bookingRequest: { findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn(async () => ({})) },
  activityLog: { findMany: vi.fn() },
  deal: { deleteMany: vi.fn(async () => ({ count: 0 })), findMany: vi.fn(async () => []) },
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@x.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/crm/bridge', () => ({ syncBookingToCrm: vi.fn(async () => {}) }));
vi.mock('@/lib/events/bus', () => ({ emitEvent: vi.fn(async () => true) }));
vi.mock('@/lib/mail', () => ({ sendAdminEmail: vi.fn() }));

import { GET } from '@/app/api/admin/bookings/route';
import { DELETE } from '@/app/api/admin/bookings/[id]/route';
import { adminBookingStatusLabel, isSelfServiceCancellation } from '@/lib/bookings/withdrawn';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const del = () => new Request('http://x', { method: 'DELETE' }) as unknown as Parameters<typeof DELETE>[0];

beforeEach(() => vi.clearAllMocks());

describe('customer-withdrawn bookings', () => {
  it('recognises the self-service cancel log entry only', () => {
    expect(isSelfServiceCancellation('{"from":"new","to":"cancelled","selfService":true}')).toBe(true);
    expect(isSelfServiceCancellation('{"status":"cancelled"}')).toBe(false);
    expect(isSelfServiceCancellation('ikke json')).toBe(false);
    expect(isSelfServiceCancellation(null)).toBe(false);
  });

  it('labels a buyer-withdrawn booking «Trukket av kunde», an admin rejection «Avvist»', () => {
    expect(adminBookingStatusLabel('cancelled', true)).toBe('Trukket av kunde');
    expect(adminBookingStatusLabel('cancelled', false)).toBe('Avvist');
    expect(adminBookingStatusLabel('new', false)).toBe('Ny');
  });

  it('GET flags cancelled bookings whose latest status change was the customer', async () => {
    prisma.bookingRequest.findMany.mockResolvedValue([
      { id: 1, status: 'cancelled' },
      { id: 2, status: 'cancelled' },
      { id: 3, status: 'new' },
    ]);
    // Nyeste først: #2 ble trukket av kunden, men deretter satt av admin.
    prisma.activityLog.findMany.mockResolvedValue([
      { entityId: 2, details: '{"status":"cancelled"}' },
      { entityId: 1, details: '{"from":"new","to":"cancelled","selfService":true}' },
      { entityId: 2, details: '{"from":"new","to":"cancelled","selfService":true}' },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { entity: 'booking', action: 'status_change', entityId: { in: [1, 2] } },
    }));
    expect(body.bookings.map((b: { id: number; withdrawnByCustomer: boolean }) => [b.id, b.withdrawnByCustomer])).toEqual([
      [1, true],
      [2, false],
      [3, false],
    ]);
  });
});

describe('DELETE /api/admin/bookings/[id]', () => {
  it('deletes an unpaid booking', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ paymentStatus: 'none' });
    const res = await DELETE(del(), ctx('7'));
    expect(res.status).toBe(200);
    expect(prisma.bookingRequest.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it('refuses to delete a paid booking (bookkeeping)', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ paymentStatus: 'paid' });
    const res = await DELETE(del(), ctx('7'));
    expect(res.status).toBe(409);
    expect(prisma.bookingRequest.delete).not.toHaveBeenCalled();
  });

  it('404s for a missing booking and 400s for a bad id', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue(null);
    expect((await DELETE(del(), ctx('7'))).status).toBe(404);
    expect((await DELETE(del(), ctx('abc'))).status).toBe(400);
  });
});
