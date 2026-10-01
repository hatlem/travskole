import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, bridge, emitEvent, cancel, mail } = vi.hoisted(() => ({
  prisma: {
    bookingRequest: { findFirst: vi.fn(), update: vi.fn() },
    registration: { findFirst: vi.fn(), update: vi.fn() },
    contact: { findUnique: vi.fn(async () => ({ id: 42 })) },
  },
  bridge: { syncBookingToCrm: vi.fn(async () => true), syncRegistrationToCrm: vi.fn(async () => true) },
  emitEvent: vi.fn(async () => {}),
  cancel: { emitRegistrationStatusEvent: vi.fn(async () => {}), promoteFromWaitlist: vi.fn(async () => {}) },
  mail: { sendCancellationConfirmation: vi.fn(async () => {}) },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: '7', email: 'Kari@X.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/crm/bridge', () => bridge);
vi.mock('@/lib/events/bus', () => ({ emitEvent }));
vi.mock('@/lib/registrations/cancel', () => cancel);
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));
vi.mock('@/lib/mail', () => mail);

import { POST as cancelBooking } from '@/app/api/dashboard/bookings/[id]/cancel/route';
import { POST as cancelRegistration } from '@/app/api/dashboard/registrations/[id]/cancel/route';

type Req = Parameters<typeof cancelBooking>[0];
const req = new Request('http://x', { method: 'POST' }) as unknown as Req;
const ctx = { params: Promise.resolve({ id: '5' }) };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/dashboard/bookings/[id]/cancel', () => {
  it('syncs the booking to CRM and emits booking.status_changed', async () => {
    prisma.bookingRequest.findFirst.mockResolvedValue({ id: 5, status: 'new', paymentStatus: 'none', email: 'kari@x.no' });
    const res = await cancelBooking(req, ctx);
    await flush();

    expect(res.status).toBe(200);
    expect(bridge.syncBookingToCrm).toHaveBeenCalledWith(5);
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'booking.status_changed',
      contactId: 42,
      meta: { bookingRequestId: 5, status: 'cancelled' },
    }));
  });

  it('emails a withdrawal confirmation to the buyer', async () => {
    prisma.bookingRequest.findFirst.mockResolvedValue({
      id: 5, status: 'new', paymentStatus: 'none', email: 'kari@x.no', name: 'Kari', course: { name: 'Dobbeltsulky' },
    });
    const res = await cancelBooking(req, ctx);

    expect(res.status).toBe(200);
    expect(mail.sendCancellationConfirmation).toHaveBeenCalledWith('kari@x.no', expect.objectContaining({
      kind: 'booking', name: 'Kari', courseName: 'Dobbeltsulky',
    }));
  });

  it('does not email when the withdrawal is refused', async () => {
    prisma.bookingRequest.findFirst.mockResolvedValue({ id: 5, status: 'cancelled', paymentStatus: 'none', email: 'kari@x.no' });
    await cancelBooking(req, ctx);
    expect(mail.sendCancellationConfirmation).not.toHaveBeenCalled();
  });

  it('does nothing when the booking is already cancelled', async () => {
    prisma.bookingRequest.findFirst.mockResolvedValue({ id: 5, status: 'cancelled', paymentStatus: 'none', email: 'kari@x.no' });
    const res = await cancelBooking(req, ctx);
    await flush();

    expect(res.status).toBe(409);
    expect(bridge.syncBookingToCrm).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('still emits the event when the CRM sync fails', async () => {
    prisma.bookingRequest.findFirst.mockResolvedValue({ id: 5, status: 'new', paymentStatus: 'none', email: 'kari@x.no' });
    bridge.syncBookingToCrm.mockRejectedValueOnce(new Error('db'));
    const res = await cancelBooking(req, ctx);
    await flush();

    expect(res.status).toBe(200);
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/dashboard/registrations/[id]/cancel', () => {
  it('syncs the registration to CRM, emits registration.cancelled and promotes the waitlist', async () => {
    prisma.registration.findFirst.mockResolvedValue({
      id: 5, status: 'pending', paymentStatus: 'none', courseId: 9,
      course: { name: 'Ponniskole', startDate: new Date(Date.now() + 86_400_000), endDate: null },
      child: { name: 'Ola' },
      parent: { name: 'Kari', user: { email: 'kari@x.no' } },
    });
    const res = await cancelRegistration(req, ctx);
    await flush();

    expect(res.status).toBe(200);
    expect(bridge.syncRegistrationToCrm).toHaveBeenCalledWith(5);
    expect(cancel.emitRegistrationStatusEvent).toHaveBeenCalledWith(5, 9, 'cancelled');
    expect(cancel.promoteFromWaitlist).toHaveBeenCalledWith(5);
    expect(mail.sendCancellationConfirmation).toHaveBeenCalledWith('kari@x.no', expect.objectContaining({
      kind: 'registration', name: 'Kari', courseName: 'Ponniskole', participant: 'Ola',
    }));
  });

  it('keeps the cancellation when the confirmation email fails', async () => {
    prisma.registration.findFirst.mockResolvedValue({
      id: 5, status: 'pending', paymentStatus: 'none', courseId: 9,
      course: { name: 'Ponniskole', startDate: null, endDate: null },
      child: null,
      parent: { name: 'Kari', user: { email: 'kari@x.no' } },
    });
    mail.sendCancellationConfirmation.mockRejectedValueOnce(new Error('smtp'));
    const res = await cancelRegistration(req, ctx);

    expect(res.status).toBe(200);
    expect(prisma.registration.update).toHaveBeenCalled();
  });
});
