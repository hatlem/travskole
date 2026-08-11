import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = vi.hoisted(() => ({
  bookingRequest: { findUnique: vi.fn(), update: vi.fn() },
  course: { findUnique: vi.fn() },
  contact: { findUnique: vi.fn(async () => null) },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@x.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/crm/bridge', () => ({ syncBookingToCrm: vi.fn(async () => {}) }));
vi.mock('@/lib/events/bus', () => ({ emitEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/crm/normalize', () => ({ normalizeEmail: (e: string) => e.toLowerCase() }));
vi.mock('@/lib/site', () => ({ getBaseUrl: () => 'https://x.no' }));
const mail = vi.hoisted(() => ({ sendBookingApprovedPayEmail: vi.fn(async () => {}), sendBookingApprovedEmail: vi.fn(async () => {}) }));
vi.mock('@/lib/mail', () => mail);

import { PUT } from '@/app/api/admin/bookings/[id]/route';
import { sendBookingApprovedPayEmail } from '@/lib/mail';

// vi.mocked() gives mock.calls the real lib/mail function signature (the bare
// vi.hoisted() object above infers a zero-arg tuple, which fails tsc strict).
const mockedPayEmail = vi.mocked(sendBookingApprovedPayEmail);

const req = (body: unknown) => new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }) as unknown as Parameters<typeof PUT>[0];
const ctx = { params: Promise.resolve({ id: '5' }) };

beforeEach(() => {
  vi.clearAllMocks();
  // signCheckoutToken defaults its secret to NEXTAUTH_SECRET; neither vitest.config.ts
  // nor CI sets it, so it must be stubbed here (same pattern as tests/flows-send.test.ts).
  process.env.NEXTAUTH_SECRET = 'test-secret-for-booking-approval';
  prisma.bookingRequest.update.mockResolvedValue({ id: 5, email: 'k@x.no', name: 'Kari', courseId: 9, participants: 2, preferredDate: null, phone: '0', paymentStatus: 'none', status: 'confirmed' });
});

describe('PUT booking: approval-e-post-trigger', () => {
  it('new→confirmed på online-kurs → betal-e-post med token-lenke', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ status: 'new' });
    prisma.course.findUnique.mockResolvedValue({ name: 'Ponni', price: 500, paymentMethods: 'stripe,faktura' });
    await PUT(req({ status: 'confirmed' }), ctx);
    expect(mail.sendBookingApprovedPayEmail).toHaveBeenCalledTimes(1);
    const arg = mockedPayEmail.mock.calls[0][0];
    expect(arg.amountKr).toBe(1000); // 500 × 2
    expect(arg.payUrl).toContain('/betaling/booking?token=');
    expect(mail.sendBookingApprovedEmail).not.toHaveBeenCalled();
  });
  it('new→confirmed på faktura-kurs → plain e-post', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ status: 'new' });
    prisma.course.findUnique.mockResolvedValue({ name: 'Ponni', price: 500, paymentMethods: 'faktura' });
    await PUT(req({ status: 'confirmed' }), ctx);
    expect(mail.sendBookingApprovedEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendBookingApprovedPayEmail).not.toHaveBeenCalled();
  });
  it('confirmed→confirmed → ingen e-post', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ status: 'confirmed' });
    prisma.course.findUnique.mockResolvedValue({ name: 'Ponni', price: 500, paymentMethods: 'stripe' });
    await PUT(req({ status: 'confirmed' }), ctx);
    expect(mail.sendBookingApprovedPayEmail).not.toHaveBeenCalled();
    expect(mail.sendBookingApprovedEmail).not.toHaveBeenCalled();
  });
});
