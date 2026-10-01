import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const prisma = vi.hoisted(() => ({
  bookingRequest: { findUnique: vi.fn(), delete: vi.fn(async () => ({ id: 5 })) },
  registration: { findUnique: vi.fn(), delete: vi.fn(async () => ({ courseId: 3, status: 'cancelled' })) },
  deal: { deleteMany: vi.fn(async () => ({ count: 1 })) },
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@x.no' } })) }));
const logActivity = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/activity', () => ({ logActivity }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));
vi.mock('@/lib/crm/bridge', () => ({ syncBookingToCrm: vi.fn(async () => true), syncRegistrationToCrm: vi.fn(async () => true) }));
vi.mock('@/lib/mail', () => ({}));
const releaseSeats = vi.hoisted(() => vi.fn(async () => null));
vi.mock('@/lib/registrations/cancel', () => ({ releaseSeats, promoteFromWaitlist: vi.fn(), emitRegistrationStatusEvent: vi.fn() }));

import { DELETE as deleteBooking } from '@/app/api/admin/bookings/[id]/route';
import { DELETE as deleteRegistration } from '@/app/api/admin/registrations/[id]/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const del = () => new NextRequest('http://x', { method: 'DELETE' });

beforeEach(() => vi.clearAllMocks());

describe('DELETE booking request', () => {
  it('removes its sales-board deal together with the request', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ paymentStatus: 'none' });
    const res = await deleteBooking(del(), ctx('5'));
    expect(res.status).toBe(200);
    expect(prisma.deal.deleteMany).toHaveBeenCalledWith({ where: { bookingRequestId: 5 } });
    expect(prisma.bookingRequest.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ details: '{"dealsRemoved":1}' }));
  });

  it('keeps paid requests and their deals', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ paymentStatus: 'paid' });
    const res = await deleteBooking(del(), ctx('5'));
    expect(res.status).toBe(409);
    expect(prisma.deal.deleteMany).not.toHaveBeenCalled();
  });
});

describe('DELETE registration', () => {
  it('removes its deal and frees the seat', async () => {
    prisma.registration.findUnique.mockResolvedValue({ paymentStatus: 'none' });
    prisma.registration.delete.mockResolvedValueOnce({ courseId: 3, status: 'confirmed' });
    const res = await deleteRegistration(del(), ctx('12'));
    expect(res.status).toBe(200);
    expect(prisma.deal.deleteMany).toHaveBeenCalledWith({ where: { registrationId: { in: [12] } } });
    expect(releaseSeats).toHaveBeenCalledWith(3);
  });

  it('refuses to delete a paid registration (accounting) and keeps the deal', async () => {
    prisma.registration.findUnique.mockResolvedValue({ paymentStatus: 'refunded' });
    const res = await deleteRegistration(del(), ctx('12'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/«Avlyst»/);
    expect(prisma.deal.deleteMany).not.toHaveBeenCalled();
    expect(prisma.registration.delete).not.toHaveBeenCalled();
  });

  it('404s for an unknown registration', async () => {
    prisma.registration.findUnique.mockResolvedValue(null);
    const res = await deleteRegistration(del(), ctx('12'));
    expect(res.status).toBe(404);
  });
});
