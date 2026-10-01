import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { bookingConfirmationNote, buildBookingApprovalEmail, formatAgreedTime } from '@/lib/bookings/approval-email-content';

const prisma = vi.hoisted(() => ({
  bookingRequest: { findUnique: vi.fn(), update: vi.fn() },
  deal: { findUnique: vi.fn() },
  note: { create: vi.fn(async () => ({})) },
}));
const sendAdminEmail = vi.hoisted(() => vi.fn(async () => {}));
const syncBookingToCrm = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/mail', () => ({ sendAdminEmail }));
vi.mock('@/lib/crm/bridge', () => ({ syncBookingToCrm }));
vi.mock('@/lib/bookings/status-event', () => ({ emitBookingStatusEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'hege@bjerke.no' } })) }));
const logActivity = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/activity', () => ({ logActivity }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn(async () => ({ site_name: 'Bjerke', contact_email: 'post@bjerke.no' })) }));
vi.mock('@/lib/payments/checkout-token', () => ({ signCheckoutToken: vi.fn(() => 'tok') }));

import { POST } from '@/app/api/admin/bookings/[id]/confirm/route';

const BOOKING = {
  id: 7, status: 'new', name: 'Kari', email: 'kari@x.no', participants: 12, preferredDate: new Date('2026-11-14T00:00:00Z'),
  paymentStatus: 'none', course: { name: 'Julebord', price: null, paymentMethods: 'faktura' },
};
const post = (body: Record<string, unknown>) =>
  POST(new NextRequest('http://x/api/admin/bookings/7/confirm', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: '7' }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.bookingRequest.findUnique.mockResolvedValue(BOOKING);
  prisma.bookingRequest.update.mockResolvedValue({ ...BOOKING, status: 'confirmed' });
  prisma.deal.findUnique.mockResolvedValue({ id: 31, contactId: 44 });
});

describe('booking approval email content', () => {
  it('formats the agreed time in Norwegian', () => {
    expect(formatAgreedTime('2026-11-14', '18:30')).toBe('lørdag 14. november 2026 kl. 18:30');
    expect(formatAgreedTime(null, '18:30')).toBe('kl. 18:30');
    expect(formatAgreedTime(null, null)).toBeNull();
  });

  it('includes agreed time and an escaped personal note; drops «Ønsket dato» when agreed', () => {
    const { html, subject } = buildBookingApprovalEmail({
      kind: 'plain', name: 'Kari', courseName: 'Julebord', participants: 12, agreedDate: '2026-11-14', agreedTime: '18:30',
      preferredDate: '2026-11-13', note: 'Velkommen <3\nVi gleder oss', amountKr: null, payUrl: null, siteName: 'Bjerke', contactEmail: 'post@bjerke.no',
    });
    expect(subject).toBe('Booking godkjent — Julebord');
    expect(html).toContain('Avtalt tidspunkt');
    expect(html).toContain('lørdag 14. november 2026 kl. 18:30');
    expect(html).toContain('Velkommen &lt;3<br>Vi gleder oss');
    expect(html).not.toContain('Ønsket dato');
  });

  it('builds a pay email with amount and button', () => {
    const { html, subject } = buildBookingApprovalEmail({
      kind: 'pay', name: 'Kari', courseName: 'Julebord', participants: 2, agreedDate: null, agreedTime: null,
      preferredDate: null, note: null, amountKr: 1500, payUrl: 'https://x/betal', siteName: 'Bjerke', contactEmail: 'post@bjerke.no',
    });
    expect(subject).toContain('fullfør betaling');
    expect(html).toContain('Betal nå');
    expect(html).toMatch(/1.500 kr/);
  });

  it('writes a CRM note only when there is something to note', () => {
    expect(bookingConfirmationNote(null, '  ')).toBeNull();
    expect(bookingConfirmationNote('kl. 12:00', 'Hei')).toBe('Avtalt tidspunkt: kl. 12:00\nPersonlig hilsen i bekreftelsen: Hei');
  });
});

describe('POST /api/admin/bookings/[id]/confirm', () => {
  it('preview: returns the email without changing anything', async () => {
    const res = await post({ mode: 'preview', date: '2026-11-14', time: '18:30', note: 'Hei' });
    const body = await res.json();
    expect(body.to).toBe('kari@x.no');
    expect(body.html).toContain('kl. 18:30');
    expect(prisma.bookingRequest.update).not.toHaveBeenCalled();
    expect(sendAdminEmail).not.toHaveBeenCalled();
  });

  it('confirm: updates status, emails the customer, notes the deal and returns CRM links', async () => {
    const res = await post({ date: '2026-11-14', time: '18:30', note: 'Hei' });
    const body = await res.json();
    expect(prisma.bookingRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'confirmed' }) }));
    expect(syncBookingToCrm).toHaveBeenCalledWith(7);
    expect(sendAdminEmail).toHaveBeenCalledWith('kari@x.no', 'Booking godkjent — Julebord', expect.stringContaining('kl. 18:30'));
    expect(prisma.note.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dealId: 31, contactId: 44, body: expect.stringContaining('Avtalt tidspunkt: lørdag 14. november 2026 kl. 18:30') }),
    });
    expect(body).toMatchObject({ emailSent: true, crm: { dealId: 31, contactId: 44 } });
  });

  it('still confirms (and says so) when the email fails', async () => {
    sendAdminEmail.mockRejectedValueOnce(new Error('smtp'));
    const body = await (await post({})).json();
    expect(body.emailSent).toBe(false);
    expect(prisma.note.create).not.toHaveBeenCalled();
  });

  it('rejects bad times and already-confirmed requests', async () => {
    expect((await post({ time: '25:00' })).status).toBe(400);
    prisma.bookingRequest.findUnique.mockResolvedValue({ ...BOOKING, status: 'confirmed' });
    expect((await post({})).status).toBe(409);
  });
});
