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
type SendAdminEmail = (to: string, subject: string, html: string) => Promise<void>;
const mail = vi.hoisted(() => ({ sendAdminEmail: vi.fn<SendAdminEmail>(async () => {}) }));
vi.mock('@/lib/mail', () => mail);
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn(async () => ({ site_name: 'Bjerke', contact_email: 'post@bjerke.no' })) }));

import { PUT } from '@/app/api/admin/bookings/[id]/route';

/** Venter på den fire-and-forget e-posten i ruten. */
const flush = () => new Promise((r) => setTimeout(r, 0));

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
  it('new→confirmed på online-kurs → samme betal-e-post som skuffen, med token-lenke', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ status: 'new' });
    prisma.course.findUnique.mockResolvedValue({ name: 'Ponni', price: 500, paymentMethods: 'stripe,faktura' });
    await PUT(req({ status: 'confirmed' }), ctx);
    await flush();
    expect(mail.sendAdminEmail).toHaveBeenCalledTimes(1);
    const [to, subject, html] = mail.sendAdminEmail.mock.calls[0];
    expect(to).toBe('k@x.no');
    expect(subject).toBe('Booking godkjent — fullfør betaling for Ponni');
    expect(html).toContain('1 000 kr'); // 500 × 2
    expect(html).toContain('/betaling/booking?token=');
    expect(html).not.toContain('Avtalt tidspunkt');
  });
  it('new→confirmed på faktura-kurs → vanlig godkjenning', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ status: 'new' });
    prisma.course.findUnique.mockResolvedValue({ name: 'Ponni', price: 500, paymentMethods: 'faktura' });
    await PUT(req({ status: 'confirmed' }), ctx);
    await flush();
    expect(mail.sendAdminEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendAdminEmail.mock.calls[0][1]).toBe('Booking godkjent — Ponni');
    expect(mail.sendAdminEmail.mock.calls[0][2]).not.toContain('Betal nå');
  });
  it('confirmed→confirmed → ingen e-post', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ status: 'confirmed' });
    prisma.course.findUnique.mockResolvedValue({ name: 'Ponni', price: 500, paymentMethods: 'stripe' });
    await PUT(req({ status: 'confirmed' }), ctx);
    await flush();
    expect(mail.sendAdminEmail).not.toHaveBeenCalled();
  });
});
