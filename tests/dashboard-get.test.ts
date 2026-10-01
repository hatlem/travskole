import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    bookingRequest: { findMany: vi.fn() },
    activityLog: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: '7', email: 'kari@x.no' } })) }));

import { GET } from '@/app/api/dashboard/route';

const future = new Date(Date.now() + 30 * 86_400_000);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({
    id: 7,
    email: 'kari@x.no',
    role: 'parent',
    passwordHash: null,
    parent: {
      id: 1,
      name: 'Kari',
      phone: '91234567',
      address: null,
      deletedAt: null,
      children: [],
      registrations: [
        { id: 10, status: 'cancelled', paymentStatus: 'none', createdAt: new Date(), child: { name: 'Ola' }, course: { name: 'Ponniskole', type: 'kurs', startDate: future, endDate: null, price: 1500, paymentMethods: 'faktura' } },
        { id: 11, status: 'cancelled', paymentStatus: 'none', createdAt: new Date(), child: null, course: { name: 'Kveldskurs', type: 'kurs', startDate: future, endDate: null, price: 0, paymentMethods: 'faktura' } },
      ],
    },
  });
  prisma.bookingRequest.findMany.mockResolvedValue([
    { id: 20, status: 'confirmed', paymentStatus: 'none', participants: 2, preferredDate: null, createdAt: new Date(), course: { name: 'Dobbeltsulky', price: 750, paymentMethods: 'vipps' } },
    { id: 21, status: 'cancelled', paymentStatus: 'none', participants: 1, preferredDate: null, createdAt: new Date(), course: { name: 'Dobbeltsulky', price: 750, paymentMethods: 'vipps' } },
  ]);
  prisma.activityLog.findMany.mockImplementation(async ({ where }: { where: { entity: string } }) =>
    where.entity === 'registration'
      ? [{ entityId: 10, details: JSON.stringify({ from: 'pending', to: 'cancelled', selfService: true }) }]
      : [{ entityId: 21, details: JSON.stringify({ from: 'new', to: 'cancelled', selfService: true }) }]
  );
});

describe('GET /api/dashboard', () => {
  it('tells buyer cancellations apart from ours', async () => {
    const body = await (await GET()).json();
    const byId = Object.fromEntries(body.registrations.map((r: { id: number }) => [r.id, r]));
    expect(byId[10].cancelledBySelf).toBe(true);
    expect(byId[11].cancelledBySelf).toBe(false);
    expect(byId[11].participantName).toBe('Kari');
  });

  it('includes the buyer’s requests with payment options', async () => {
    const body = await (await GET()).json();
    expect(body.bookings).toHaveLength(2);
    const [confirmed, withdrawn] = body.bookings;
    expect(confirmed).toMatchObject({ id: 20, amountKr: 1500, requiresPayment: true, providers: ['vipps'], cancellable: true });
    expect(withdrawn).toMatchObject({ id: 21, withdrawnBySelf: true, providers: [], cancellable: false });
  });

  it('still answers when the requests lookup fails', async () => {
    prisma.bookingRequest.findMany.mockRejectedValueOnce(new Error('db'));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).bookings).toEqual([]);
  });
});
